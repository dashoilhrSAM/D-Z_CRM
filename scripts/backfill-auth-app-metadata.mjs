#!/usr/bin/env node
/**
 * P3b 第 6 步的**回填**：把业务 claims 写进 Supabase 的 `app_metadata`。
 *
 * 背景：claims 过去写在 `user_metadata`（**用户自己就能改**），而 P0 已经把数据库侧的
 * `app_jwt_claim()` 改成只认 `app_metadata` —— 于是 PostgREST/RLS 面对合法用户也是一律拒绝
 * （有意留下的 fail-closed）。代码侧已改成登录时写 app_metadata（`injectBizClaims`），
 * 但**存量账号要等各自下次登录**才迁移完。这个脚本把它一次补齐。
 *
 * 两条设计决定：
 *  ① **claims 从数据库推导，不复制 user_metadata**：user_metadata 是用户可写的，
 *     把它的内容搬进"权威"的 app_metadata 等于把伪造值洗白（`role: "OWNER"` 也能搬进去）。
 *     真相在业务库里：`User`（员工）/ `Customer`（骑手）+ `AuthLink`。
 *  ② **默认演练**：只打印将要写什么；`--apply` 才写。
 *
 * 用法：
 *   node scripts/backfill-auth-app-metadata.mjs            # 演练（只读）
 *   node scripts/backfill-auth-app-metadata.mjs --apply
 *
 * 环境：NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY（.env 里已有），
 *      数据库连接用 DST_DATABASE_URL / DIRECT_URL（本机 Prisma client 是 SQLite 的，连不上 PG）。
 */
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");

// .env 不是自动加载的（脚本可能从任意 cwd 跑），这里显式读一次
try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  console.warn("[backfill-claims] 没读到 .env（继续用已有环境变量）");
}

const dbUrl = process.env.DST_DATABASE_URL || process.env.DIRECT_URL;
const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dbUrl || !supaUrl || !serviceKey) {
  console.error("缺少 DST_DATABASE_URL/DIRECT_URL 或 Supabase URL/service key —— 见 .env");
  process.exit(2);
}

const pg = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await pg.connect();
const admin = createClient(supaUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

// —— 1) 从业务库推导 claims（真相在这里，不在 user_metadata）——
const { rows: staffRows } = await pg.query(
  `select "authId", "organisationId", "branchId", "role", "id" from "User" where "authId" is not null`,
);
const { rows: riderRows } = await pg.query(
  `select "authId", "organisationId", "branchId", "id" from "Customer" where "authId" is not null`,
);
/** authId → 该写进 app_metadata 的 claims */
const wanted = new Map();
for (const r of staffRows) {
  wanted.set(r.authId, { orgId: r.organisationId, branchId: r.branchId ?? "", role: r.role, userId: r.id, customerId: "" });
}
for (const r of riderRows) {
  wanted.set(r.authId, { orgId: r.organisationId, branchId: r.branchId ?? "", role: "CUSTOMER", userId: "", customerId: r.id });
}
console.log("[backfill-claims] 业务库里带 authId 的账号:", wanted.size, `（员工 ${staffRows.length} + 骑手 ${riderRows.length}）`);

// —— 2) 列出 Supabase auth 用户 ——
const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (error) {
  console.error("[backfill-claims] listUsers 失败:", error.message);
  await pg.end();
  process.exit(1);
}
const authUsers = data.users;
console.log("[backfill-claims] Supabase auth 用户:", authUsers.length);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let ok = 0;
let todo = [];
const orphans = [];
for (const u of authUsers) {
  const claims = wanted.get(u.id);
  if (!claims) {
    orphans.push(u.email ?? u.phone ?? u.id);
    continue;
  }
  const current = {
    orgId: u.app_metadata?.orgId ?? "",
    branchId: u.app_metadata?.branchId ?? "",
    role: u.app_metadata?.role ?? "",
    userId: u.app_metadata?.userId ?? "",
    customerId: u.app_metadata?.customerId ?? "",
  };
  if (same(current, claims)) ok++;
  else {
    // ⚠️ 合并而不是覆盖：app_metadata 里还有 Supabase 自己的键（provider/providers 等），
    // 不能因为我们要写 5 个业务键就把它们抹掉。显式读出来再合并，不依赖服务端的合并语义。
    const merged = { ...(u.app_metadata ?? {}), ...claims };
    todo.push({ id: u.id, email: u.email ?? u.phone ?? u.id, claims, merged, hadProviders: Array.isArray(u.app_metadata?.providers) });
  }
}

console.log("[backfill-claims] app_metadata 已正确:", ok, "｜待写:", todo.length);
if (orphans.length) {
  console.log("[backfill-claims] ⚠️ 有 auth 账号在业务库里没有对应身份（", orphans.length, "个）:", orphans.slice(0, 8).join(", "));
  console.log("  这些账号登录会被拒（No D&Z account linked）—— 属于数据问题，不在本脚本职责内，但值得知道。");
}
for (const t of todo.slice(0, 10)) console.log("  · " + t.email + " → " + JSON.stringify(t.claims));
console.log("[backfill-claims] （写入时会把现有 app_metadata 一起带上 —— provider/providers 等不会被抹掉）");

if (!todo.length) {
  console.log("[backfill-claims] ✅ 无需改动。");
  await pg.end();
  process.exit(0);
}
if (!APPLY) {
  console.log("\n[backfill-claims] （演练模式：什么也没写。确认无误后加 --apply）");
  await pg.end();
  process.exit(0);
}

// —— 3) 写入（逐条，失败不静默）——
let done = 0;
const failed = [];
for (const t of todo) {
  const { error: upErr } = await admin.auth.admin.updateUserById(t.id, { app_metadata: t.merged });
  if (upErr) failed.push(t.email + ": " + upErr.message);
  else done++;
}
console.log("[backfill-claims] 已写:", done, "｜失败:", failed.length);
for (const f of failed.slice(0, 5)) console.error("  ✗ " + f);

// —— 4) 复验：不接受"没报错"当成功 ——
const { data: after } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
let still = 0;
for (const u of after.users) {
  const claims = wanted.get(u.id);
  if (!claims) continue;
  const current = {
    orgId: u.app_metadata?.orgId ?? "",
    branchId: u.app_metadata?.branchId ?? "",
    role: u.app_metadata?.role ?? "",
    userId: u.app_metadata?.userId ?? "",
    customerId: u.app_metadata?.customerId ?? "",
  };
  if (!same(current, claims)) still++;
}
const lostProvider = after.users.filter((u) => wanted.has(u.id) && !u.app_metadata?.provider).length;
console.log("[backfill-claims] 复验：仍不正确", still, "个 ｜ provider 丢失", lostProvider, "个");
if (lostProvider > 0) {
  console.error("[backfill-claims] ❌ 有账号的 app_metadata.provider 被写没了 —— 这不该发生，请立刻人工核对");
  await pg.end();
  process.exit(1);
}
await pg.end();
process.exit(failed.length || still ? 1 : 0);
