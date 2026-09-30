#!/usr/bin/env node
/**
 * P3b 第 2 步的**生产侧** DDL：`authId` 从全局唯一 → 租户内唯一（外加 Customer 的号码索引）。
 *
 * 为什么需要单独一个脚本：这几条是 `DROP INDEX`，被
 * `scripts/sync-prod-schema.mjs` 判为破坏性 DDL 而**拒绝自动执行**（有意如此）。
 * 但"拒绝自动"不等于"让人手敲 SQL" —— 手敲的 SQL 没有演练、没有前置校验、没有复验。
 * 所以这里把同一件事做成：**默认只演练**、先跑数据前置检查、幂等、事务内执行、执行后复验。
 *
 * 用法：
 *   node scripts/apply-prod-authid-tenant-scope.mjs                       # 演练（默认，不写库）
 *   node scripts/apply-prod-authid-tenant-scope.mjs --apply --backup-taken
 *
 * 顺序很重要：**必须在合并 PR 之前执行**。否则 Vercel 构建期的 schema 同步会看到
 * DROP INDEX 而 exit 1，部署被卡住（生产仍跑旧版本，不是事故，但会白跑一轮）。
 *
 * 连接：`DST_DATABASE_URL`（本仓库既有约定，见 .env），缺省退回 `DIRECT_URL`。
 * 本机 Prisma client 是 SQLite 生成的，连不上 PG —— 所以这里一律用原生 pg。
 */
import { Client } from "pg";

const APPLY = process.argv.includes("--apply");
const BACKUP_TAKEN = process.argv.includes("--backup-taken");

const url = process.env.DST_DATABASE_URL || process.env.DIRECT_URL;
if (!url) {
  console.error("缺少 DST_DATABASE_URL / DIRECT_URL —— 见 .env");
  process.exit(2);
}
if (APPLY && !BACKUP_TAKEN) {
  console.error("拒绝执行：破坏性 DDL 必须先做备份，确认后加 --backup-taken（备份方式见 docs/backups/）。");
  process.exit(2);
}

/** 目标索引集合。`drop` 里的必须先确认**不是**别的东西在用。 */
const PLAN = [
  { sql: `DROP INDEX IF EXISTS "Customer_authId_key"`, what: "去掉 Customer.authId 的全局唯一" },
  { sql: `DROP INDEX IF EXISTS "User_authId_key"`, what: "去掉 User.authId 的全局唯一" },
  { sql: `CREATE INDEX IF NOT EXISTS "Customer_organisationId_phone_idx" ON "Customer"("organisationId","phone")`, what: "租户内手机匹配走索引" },
  { sql: `CREATE UNIQUE INDEX IF NOT EXISTS "Customer_organisationId_authId_key" ON "Customer"("organisationId","authId")`, what: "Customer.authId 改为租户内唯一" },
  { sql: `CREATE UNIQUE INDEX IF NOT EXISTS "User_organisationId_authId_key" ON "User"("organisationId","authId")`, what: "User.authId 改为租户内唯一" },
];

/** 唯一索引的前置条件：现有数据里不能已经有重复 (organisationId, authId)。 */
const DUPLICATE_CHECKS = [
  { table: "User", sql: `select count(*)::int as n from (select "organisationId","authId" from "User" where "authId" is not null group by 1,2 having count(*) > 1) t` },
  { table: "Customer", sql: `select count(*)::int as n from (select "organisationId","authId" from "Customer" where "authId" is not null group by 1,2 having count(*) > 1) t` },
];

const EXPECTED = ["Customer_organisationId_authId_key", "Customer_organisationId_phone_idx", "User_organisationId_authId_key"];
const FORBIDDEN = ["Customer_authId_key", "User_authId_key"];

async function indexNames(c) {
  const r = await c.query(
    `select indexname from pg_indexes where tablename in ('User','Customer') and indexname = any($1) order by indexname`,
    [[...EXPECTED, ...FORBIDDEN]],
  );
  return r.rows.map((x) => x.indexname);
}

const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

console.log("[p3b-ddl] 目标库:", url.replace(/:[^:@]+@/, ":***@").slice(0, 70));
const before = await indexNames(c);
console.log("[p3b-ddl] 现有相关索引:", before.length ? before.join(", ") : "(无)");

const done = EXPECTED.every((i) => before.includes(i)) && FORBIDDEN.every((i) => !before.includes(i));
if (done) {
  console.log("[p3b-ddl] ✅ 已经是目标状态，无需改动。");
  await c.end();
  process.exit(0);
}

// 前置检查：重复键会让 CREATE UNIQUE INDEX 直接失败（宁可在演练阶段就说清楚）
let dupTotal = 0;
for (const { table, sql } of DUPLICATE_CHECKS) {
  const { rows } = await c.query(sql);
  const n = rows[0].n;
  dupTotal += n;
  console.log(`[p3b-ddl] 重复 (organisationId, authId) 检查 · ${table}: ${n}`);
}
if (dupTotal > 0) {
  console.error("[p3b-ddl] ❌ 存在重复键，唯一索引会建不上 —— 先人工合并这几条记录，再回来跑。");
  await c.end();
  process.exit(1);
}

// 影响面（只是让人知道动的是什么量级）
for (const t of ["User", "Customer"]) {
  const { rows } = await c.query(`select count(*)::int as total, count("authId")::int as with_auth from "${t}"`);
  console.log(`[p3b-ddl] ${t}: ${rows[0].total} 行，其中 ${rows[0].with_auth} 行有 authId`);
}

console.log("\n[p3b-ddl] 将要执行：");
for (const s of PLAN) console.log("  · " + s.what + "\n    " + s.sql);

if (!APPLY) {
  console.log("\n[p3b-ddl] （演练模式：什么也没写。确认无误后加 --apply --backup-taken）");
  await c.end();
  process.exit(0);
}

await c.query("BEGIN");
try {
  for (const s of PLAN) await c.query(s.sql);
  await c.query("COMMIT");
  console.log("\n[p3b-ddl] 已提交。");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("\n[p3b-ddl] ❌ 执行失败，已回滚：", e.message);
  await c.end();
  process.exit(1);
}

// 复验：不接受"执行没报错"当成功
const after = await indexNames(c);
const missing = EXPECTED.filter((i) => !after.includes(i));
const leftover = FORBIDDEN.filter((i) => after.includes(i));
console.log("[p3b-ddl] 复验 · 现有:", after.join(", ") || "(无)");
if (missing.length || leftover.length) {
  console.error("[p3b-ddl] ❌ 复验不通过 —— 缺:", missing.join(","), " 仍存在:", leftover.join(","));
  await c.end();
  process.exit(1);
}
console.log("[p3b-ddl] ✅ 复验通过：authId 已是租户内唯一，旧全局唯一索引已移除。");
await c.end();
