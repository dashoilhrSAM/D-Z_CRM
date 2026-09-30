#!/usr/bin/env tsx
/**
 * RLS 策略生成器：为全部 Prisma 模型生成 Supabase Row Level Security 策略。
 * 输出 docs/rls-policies.sql（可重复执行：DROP POLICY IF EXISTS + CREATE）。
 */
import { Prisma } from "@prisma/client";
import * as fs from "node:fs";

const ADMINS = ["SUPER_ADMIN", "OWNER", "HEAD_OFFICE_ADMIN"];
const models = Prisma.dmmf.datamodel.models;
const byName = new Map(models.map(m => [m.name, m]));
const has = (m: string, f: string) => byName.get(m)?.fields.some(x => x.name === f) ?? false;
const fkRel = (m: string) => (byName.get(m)?.fields ?? []).filter(f => f.kind === "object" && (f as any).relationFromFields?.length);
const relName = (f: any) => f.type;

interface Link { from: string; fk: string; ref: string; to: string }

/** BFS 从表 t 到 Organisation 的完整 FK 链（t 出发 → Organisation） */
function orgChain(t: string): Link[] | null {
  if (has(t, "organisationId")) return null;
  const q: { table: string; chain: Link[] }[] = [{ table: t, chain: [] }];
  const seen = new Set([t]);
  while (q.length) {
    const cur = q.shift()!;
    for (const f of fkRel(cur.table)) {
      const next = relName(f);
      const fkCols = (f as any).relationFromFields as string[];
      const refCols = (f as any).relationToFields as string[];
      const link: Link = { from: cur.table, fk: fkCols[0], ref: refCols[0], to: next };
      if (next === "Organisation") return [...cur.chain, link];
      if (!seen.has(next)) { seen.add(next); q.push({ table: next, chain: [...cur.chain, link] }); }
    }
  }
  return null;
}

/** 生成 org 过滤表达式：直接列或 EXISTS JOIN 链 */
function orgExpr(t: string): string {
  if (has(t, "organisationId")) return `"${t}"."organisationId" = app_current_org_id()`;
  const chain = orgChain(t);
  if (!chain) return "true";
  // chain: [{from:t, fk, ref, to:L1}, {from:L1, fk, ref, to:L2}, ..., {from:Lk, fk, ref, to:Organisation}]
  // 注意：不能把最外层表 t 自身 JOIN 进子查询（策略引用自身表 → RLS 无限递归）。
  // JOIN 只包含 Organisation + 中间表（chain[1..] 的 from），t 经 head FK 作 WHERE 条件。
  const head = chain[0];
  const joins: string[] = [];
  joins.push(`"Organisation" o`);
  for (let i = chain.length - 1; i >= 1; i--) {
    const l = chain[i];
    const target = i === chain.length - 1 ? "o" : `"${chain[i + 1].from}"`;
    joins.push(`"${l.from}" ON "${l.from}"."${l.fk}" = ${target}."${l.ref}"`);
  }
  // 最外层条件：t 表经 chain[0] 的 FK 引用 chain[0].to（该表已在 JOIN 中）
  const where = `"${t}"."${head.fk}" = "${head.to}"."${head.ref}"`;
  return `EXISTS (SELECT 1 FROM ${joins.join(" JOIN ")} WHERE ${where})`;
}

function gen(): string {
  const out: string[] = [];
  out.push("-- D&Z Platform — RLS 策略（Supabase）");
  out.push("-- 生成：scripts/gen-rls-policies.ts · 身份来源 request.jwt.claims");
  out.push("-- 可重复执行：所有策略 DROP IF EXISTS");
  out.push("");
  out.push("-- ============ helper 函数 ============");
  // 2026-09-30（P0）只认 app_metadata：user_metadata 登录用户自己就能改（updateUser({data})），
  // 而策略把里面的 orgId 当租户身份 —— 等于用户可以自选租户。app_metadata 只有 service role 能写。
  // 刻意不回退 user_metadata：留回退等于没修。代价是 P3 把 injectBizClaims 改写到 app_metadata 之前，
  // PostgREST 面一律拒绝 —— 应用不走 PostgREST，零影响，宁可 fail-closed。
  out.push("CREATE OR REPLACE FUNCTION app_jwt_claim(name text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb->'app_metadata'->>name, ''), NULLIF(current_setting('request.jwt.claims', true)::jsonb->>name, ''), '') $$;");
  out.push("CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT app_jwt_claim('orgId') $$;");
  out.push("CREATE OR REPLACE FUNCTION app_current_branch_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT app_jwt_claim('branchId') $$;");
  out.push("CREATE OR REPLACE FUNCTION app_current_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT app_jwt_claim('role') $$;");
  out.push("CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT app_jwt_claim('userId') $$;");
  out.push("CREATE OR REPLACE FUNCTION app_current_customer_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT app_jwt_claim('customerId') $$;");
  // 2026-09-30（P0）fail-closed：原来只看角色，**没有 org claim 时 role 是空串**，
  // 于是 "" <> 'CUSTOMER' 恒为真 —— "没登录 = 员工"。现在要求必须带非空 org claim。
  out.push("CREATE OR REPLACE FUNCTION app_is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT app_current_org_id() <> '' AND app_current_role() IN ('" + ADMINS.join("','") + "') $$;");
    out.push("CREATE OR REPLACE FUNCTION app_is_staff() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT app_current_org_id() <> '' AND app_current_role() NOT IN ('', 'CUSTOMER') $$;");
  out.push("");
  out.push("-- ============ 表策略 ============");
  for (const m of models) {
    const t = m.name;
    out.push("-- " + t);
    out.push(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;`);
    const org = orgExpr(t);
    // 员工分支过滤：admin 跳过；无 branch claim 或行 branchId 为空视为全分支
    let branch = "";
    if (has(t, "branchId")) {
      // 2026-09-30（P0）：删掉 `app_current_branch_id() = ''` 这一项 —— 无 claim 时它恒为真，
      // 等于"没有分行就算全部分行"，分行过滤整体失效。缺 claim 应视为看不到任何行（fail-closed）。
      branch = ` AND (app_is_admin() OR "${t}"."branchId" IS NULL OR "${t}"."branchId" = app_current_branch_id())`;
    }
    // rider 自见：有 customerId 的表按 customerId；Customer 自身表按 id（无 customerId 列）
    let cust = "";
    if (has(t, "customerId")) {
      cust = ` AND (app_is_staff() OR "${t}"."customerId" = app_current_customer_id())`;
    } else if (t === "Customer") {
      cust = ` AND (app_is_staff() OR "${t}"."id" = app_current_customer_id())`;
    }
    let mech = "";
    if (has(t, "mechanicId")) {
      mech = ` AND (NOT (app_current_role() = 'MECHANIC') OR "${t}"."mechanicId" = app_current_user_id())`;
    }
    // org 是硬隔离（admin 也必须限定 org），branch/customer/mechanic 仅对非 admin 生效
    const usingExpr = `(${org}${branch}${cust}${mech})`;
    const effExpr = t === "Organisation" ? `("${t}"."id" = app_current_org_id())` : usingExpr;
    out.push(`DROP POLICY IF EXISTS tenant_isolation_${t.toLowerCase()} ON "${t}";`);
    out.push(`CREATE POLICY tenant_isolation_${t.toLowerCase()} ON "${t}" FOR ALL USING (${effExpr}) WITH CHECK (${effExpr});`);
    out.push("");
  }
  return out.join("\n");
}

const sql = gen();
fs.writeFileSync("docs/rls-policies.sql", sql);
console.log("written docs/rls-policies.sql", sql.split("\n").length, "lines");
