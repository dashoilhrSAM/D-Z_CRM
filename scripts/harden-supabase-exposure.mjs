#!/usr/bin/env node
/**
 * Supabase 匿名暴露面收敛（P0 安全止血）
 * =====================================
 * 为什么需要它（2026-09-30 多租户审计实测）：
 *
 *   只拿 `.env` 里那个**随浏览器分发的公开 anon key**、不登录，`GET /rest/v1/<表>?limit=0`
 *   就能读到：
 *     AttendancePunch 7 行（考勤自拍 + GPS）、Quotation 11 行、StaffPayout 5 行（薪资）、
 *     Document 1 行、ChecklistItem 10 行。
 *   两个原因叠加：
 *     ① 22 张表**根本没开 RLS**（`docs/rls-policies.sql` 只覆盖 61/83 张，
 *        因为生成器读的是生成后 client 的 DMMF，且最后一次运行是 2026-09-01）；
 *     ② anon 角色对这些表持有 SELECT 授权（Supabase 默认 `GRANT ALL ... TO anon`）。
 *
 * 本脚本做两件事，都是**可逆、可重复执行**的：
 *   1) REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon
 *      —— 应用**从不**通过 PostgREST 读业务数据（数据全走 Prisma；Supabase client 只用于
 *         auth.* 与 admin API；唯一例外是 Storage，它用 service_role，不受影响）。
 *         所以撤销 anon 的表授权对应用零影响，却直接关掉整个匿名数据面。
 *   2) ALTER TABLE ... ENABLE ROW LEVEL SECURITY（仅对尚未开启的表）
 *      —— 开 RLS 但**不建策略** = 对 anon/authenticated 默认拒绝（fail-closed）。
 *         应用连接角色是 postgres（rolbypassrls=true），不受影响。
 *         真正的策略重写（修 36 条同义反复）属于 P2，不在此脚本范围内。
 *
 * 用法
 *   node --env-file=.env scripts/harden-supabase-exposure.mjs            # 只读检查（默认）
 *   node --env-file=.env scripts/harden-supabase-exposure.mjs --apply    # 执行
 *
 * 回滚
 *   GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;                    -- Supabase 默认授权
 *   ALTER TABLE "<table>" DISABLE ROW LEVEL SECURITY;                    -- 逐表
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";

const APPLY = process.argv.includes("--apply");

function envFile(path = ".env") {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
        }),
    );
  } catch {
    return {};
  }
}

const env = { ...envFile(), ...process.env };
const url = env.DRIFT_CHECK_URL || env.DIRECT_URL || env.DST_DATABASE_URL || env.DATABASE_URL;
if (!url || url.startsWith("file:")) {
  console.error("需要一个 Postgres 连接串（DRIFT_CHECK_URL / DIRECT_URL / DST_DATABASE_URL / DATABASE_URL）。");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 });
await client.connect();
const q = async (sql) => (await client.query(sql)).rows;

/* ---------- 1. 现状 ---------- */
const who = (await q("select current_user, rolbypassrls from pg_roles where rolname = current_user"))[0];
console.log("连接角色:", who.current_user, "| rolbypassrls:", who.rolbypassrls, APPLY ? "| 模式: APPLY" : "| 模式: 只读检查");

const noRls = await q(
  `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`,
);
const anonSelect = await q(
  `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and has_table_privilege('anon', c.oid, 'SELECT') order by 1`,
);
console.log("\n未开启 RLS 的表:", noRls.length, noRls.length ? "→ " + noRls.map((r) => r.relname).join(", ") : "");
console.log("anon 有 SELECT 的表:", anonSelect.length);

/* ---------- 2. 执行 ---------- */
if (APPLY) {
  console.log("\n--- 执行 ---");
  await client.query("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon");
  console.log("✔ REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon");
  // 关键：Supabase 对 postgres 角色设了 default privileges，**新建的表会自动带上 anon 授权**。
  // 只 REVOKE 现有表 = 下次迁移建表又漏一遍（本项目已有 57 个迁移，建表很频繁）。
  await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon");
  console.log("✔ ALTER DEFAULT PRIVILEGES ... REVOKE ALL ON TABLES FROM anon（未来新建表不再自动授权）");
  for (const { relname } of noRls) {
    await client.query(`ALTER TABLE "${relname}" ENABLE ROW LEVEL SECURITY`);
  }
  console.log("✔ ENABLE ROW LEVEL SECURITY ×", noRls.length);
}

/* ---------- 3. 复核 ---------- */
const anonSelectAfter = await q(
  `select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('anon', c.oid, 'SELECT')`,
);
const noRlsAfter = await q(
  `select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
);
console.log("\n--- 复核 ---");
console.log("anon 仍有 SELECT 的表:", anonSelectAfter[0].n);
console.log("仍未开 RLS 的表:", noRlsAfter[0].n);

await client.end();

/* ---------- 4. 从公网实测（用公开 anon key，只取计数不取行） ---------- */
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (base && key) {
  console.log("\n--- 公网实测（anon key，limit=0 只取计数）---");
  const tables = ["AttendancePunch", "StaffPayout", "Quotation", "Document", "ChecklistItem", "Customer", "Invoice"];
  for (const t of tables) {
    const r = await fetch(`${base}/rest/v1/${t}?select=id&limit=0`, {
      headers: { apikey: key, Authorization: "Bearer " + key, Prefer: "count=exact", Range: "0-0" },
    });
    const range = r.headers.get("content-range") ?? "-";
    console.log("  " + t.padEnd(16), "HTTP", r.status, "| anon 可见:", range);
  }
}
