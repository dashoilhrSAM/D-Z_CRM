#!/usr/bin/env node
/**
 * P1a 生产 DDL：租户列 + 租户内唯一键（**必须手工执行，不能等构建**）
 *
 * 为什么单独成脚本
 * ----------------
 * `vercel.json` 的构建会跑 `scripts/sync-prod-schema.mjs`，它**遇到 DROP 就 exit 1**
 * （2026-09-15 生产事故后刻意收紧的保护：宁可不部署，也不要"没验证过"的部署打挂站点）。
 * 而本轮要把 8 个全局唯一索引换成复合唯一索引 —— 那必然包含 DROP INDEX。
 * 也就是说：**不先手工执行本脚本，下一次 push main 会构建失败。**
 *
 * 为什么可以直接换（数据安全性）
 * ------------------------------
 * **全局唯一严格强于租户内唯一**：任何满足 `plate` 全局唯一的行集，必然满足
 * `(organisationId, plate)` 唯一。所以"先建复合键、再删全局键"在任何数据上都不可能冲突。
 * 顺序刻意是**先建后删**：中途两个键并存只是更严格，不会出现"两个键都没有"的窗口。
 *
 * 分两阶段（--phase），因为中间要插一次数据回填：
 *   node --env-file=.env scripts/apply-p1a-production.mjs --check                 # 只报告（默认）
 *   node --env-file=.env scripts/apply-p1a-production.mjs --apply --phase=columns # ① 加列（纯加法）
 *   DATABASE_URL="$DST_DATABASE_URL" pnpm exec tsx scripts/backfill-tenant-columns.ts --apply  # ② 回填
 *   node --env-file=.env scripts/apply-p1a-production.mjs --apply --phase=uniques # ③ 换唯一键
 *
 * 全部语句幂等（IF NOT EXISTS / IF EXISTS），可重复执行。
 *
 * 回滚：唯一键是"先建后删"，回滚只需把复合键删掉、把全局键建回来（见文件末尾注释）；
 *      新加的列与数据都保留（它们是加法，不影响旧代码运行）。
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const phaseArg = process.argv.find((a) => a.startsWith("--phase="));
const PHASE = phaseArg ? phaseArg.slice("--phase=".length) : "all";

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
const url = env.P1A_DATABASE_URL || env.DRIFT_CHECK_URL || env.DIRECT_URL || env.DST_DATABASE_URL || env.DATABASE_URL;
if (!url || url.startsWith("file:")) {
  console.error("需要 Postgres 连接串（P1A_DATABASE_URL / DRIFT_CHECK_URL / DIRECT_URL / DST_DATABASE_URL）。");
  process.exit(1);
}

/** 要加列的租户模型（可空 —— 回填后再收紧为 NOT NULL，留到 P1b）。 */
const TENANT_TABLES = ["Motorcycle", "ServiceJob", "Invoice", "ChecklistTemplate"];

/** 全局唯一索引 → 复合唯一索引。 */
const UNIQUE_SWAP = [
  ["Motorcycle", "plate", "Motorcycle_organisationId_plate_key"],
  ["ServiceJob", "jobNumber", "ServiceJob_organisationId_jobNumber_key"],
  ["Invoice", "invoiceNumber", "Invoice_organisationId_invoiceNumber_key"],
  ["Product", "sku", "Product_organisationId_sku_key"],
  ["PromoProduct", "sku", "PromoProduct_organisationId_sku_key"],
  ["Lead", "leadNumber", "Lead_organisationId_leadNumber_key"],
  ["LoyaltyAccount", "membershipId", "LoyaltyAccount_organisationId_membershipId_key"],
  ["User", "email", "User_organisationId_email_key"],
];

const ORG_COLUMNS = [
  [`"slug" TEXT`, "Organisation_slug_key"],
  [`"status" TEXT NOT NULL DEFAULT 'ACTIVE'`, null],
  [`"plan" TEXT NOT NULL DEFAULT 'STANDARD'`, null],
  [`"trialEndsAt" TIMESTAMP(3)`, null],
];

const stmts = [];

if (PHASE === "all" || PHASE === "columns") {
  for (const t of TENANT_TABLES) {
    stmts.push({ sql: `ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "organisationId" TEXT`, why: `加租户列 ${t}` });
    stmts.push({
      sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${t}_organisationId_fkey') THEN
              ALTER TABLE "${t}" ADD CONSTRAINT "${t}_organisationId_fkey" FOREIGN KEY ("organisationId")
              REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$`,
      why: `加外键 ${t}.organisationId → Organisation`,
    });
    stmts.push({ sql: `CREATE INDEX IF NOT EXISTS "${t}_organisationId_idx" ON "${t}"("organisationId")`, why: `加索引 ${t}.organisationId` });
  }
  for (const [col, uniq] of ORG_COLUMNS) {
    stmts.push({ sql: `ALTER TABLE "Organisation" ADD COLUMN IF NOT EXISTS ${col}`, why: `加运营字段 Organisation.${col.split(" ")[0]}` });
    if (uniq) stmts.push({ sql: `CREATE UNIQUE INDEX IF NOT EXISTS "${uniq}" ON "Organisation"("${col.split(" ")[0].replace(/"/g, "")}")`, why: `slug 唯一索引` });
  }
}

if (PHASE === "all" || PHASE === "uniques") {
  for (const [table, col, composite] of UNIQUE_SWAP) {
    // **先建后删**：中途两个键并存只是更严格，不会有"两个都没有"的窗口
    stmts.push({ sql: `CREATE UNIQUE INDEX IF NOT EXISTS "${composite}" ON "${table}"("organisationId", "${col}")`, why: `建复合唯一键 ${table}(${col})` });
    stmts.push({ sql: `DROP INDEX IF EXISTS "${table}_${col}_key"`, why: `删全局唯一键 ${table}.${col}` });
  }
}

/**
 * P1b：三处缺失的租户关系 + InvoiceCounter 改「按租户 + 年份」。
 *
 * 顺序刻意是**先清空再改主键**：InvoiceCounter 是纯派生数据（唯一读法是
 * "有 (org, year) 行就用它的值，没有就从该租户当年已发发票的最大号重新起步"），
 * 删行不丢任何业务事实；反过来把历史的全局计数器行硬套给某一家店才会把号段弄错。
 */
function p1bStatements() {
  const out = [];
  out.push({ sql: `DELETE FROM "InvoiceCounter"`, why: "清空全局发票计数器（纯派生数据，下次取号自动从本租户当年最大号接上）" });
  out.push({ sql: `ALTER TABLE "InvoiceCounter" ADD COLUMN IF NOT EXISTS "organisationId" TEXT`, why: "加 InvoiceCounter.organisationId" });
  out.push({ sql: `ALTER TABLE "InvoiceCounter" ALTER COLUMN "organisationId" SET NOT NULL`, why: "收紧为 NOT NULL（此刻表已空）" });
  out.push({ sql: `ALTER TABLE "InvoiceCounter" DROP CONSTRAINT IF EXISTS "InvoiceCounter_pkey"`, why: "去掉旧的 year 主键" });
  out.push({ sql: `ALTER TABLE "InvoiceCounter" ADD CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("organisationId", "year")`, why: "改成 [organisationId, year] 复合主键" });
  const fks = [
    ["InvoiceCounter", "organisationId", "Organisation", "id", "RESTRICT"],
    ["ServicePackage", "branchId", "Branch", "id", "SET NULL"],
    ["Attendance", "branchId", "Branch", "id", "SET NULL"],
    ["AttendanceCorrection", "punchId", "AttendancePunch", "id", "CASCADE"],
  ];
  for (const [table, col, refTable, refCol, onDelete] of fks) {
    const name = table + "_" + col + "_fkey";
    out.push({
      sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
              ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${col}")
              REFERENCES "${refTable}"("${refCol}") ON DELETE ${onDelete} ON UPDATE CASCADE; END IF; END $$`,
      why: `加外键 ${table}.${col} → ${refTable}（补上缺失的租户路径）`,
    });
  }
  return out;
}

if (PHASE === "p1b") stmts.push(...p1bStatements());

/**
 * P3a：把既有的 User.authId / Customer.authId 收进 AuthLink（纯数据，幂等）。
 * 用原生 SQL 而不是回填脚本：本机生成的 Prisma client 是 SQLite 的，连不上生产 PG。
 */
if (PHASE === "authlink") {
  stmts.push({
    sql: `INSERT INTO "AuthLink" ("id","authId","organisationId","kind","userId","customerId","createdAt")
          SELECT 'al_staff_' || u."id", u."authId", u."organisationId", 'STAFF', u."id", NULL, now()
          FROM "User" u WHERE u."authId" IS NOT NULL
          ON CONFLICT ("authId","organisationId") DO UPDATE SET "kind"='STAFF', "userId"=EXCLUDED."userId"`,
    why: "AuthLink ← User.authId（员工）",
  });
  stmts.push({
    sql: `INSERT INTO "AuthLink" ("id","authId","organisationId","kind","userId","customerId","createdAt")
          SELECT 'al_cust_' || c."id", c."authId", c."organisationId", 'CUSTOMER', NULL, c."id", now()
          FROM "Customer" c WHERE c."authId" IS NOT NULL
          ON CONFLICT ("authId","organisationId") DO UPDATE SET "kind"='CUSTOMER', "customerId"=EXCLUDED."customerId"`,
    why: "AuthLink ← Customer.authId（客户）",
  });
}

/**
 * 回填阶段刻意**不用 `@/lib/db` 的 Prisma 客户端**：本机生成的 client 是 SQLite 的，
 * 连不上生产 PG（同样的问题在 scripts/set-branch-geofence.ts:12-16 有记录）。
 * 这里直接用原生 SQL —— 四条 UPDATE + slug，比通用回填脚本更短也更可核对。
 */
const BACKFILL = [
  {
    why: "Motorcycle.organisationId ← customer.organisationId",
    pending: `select count(*)::int n from "Motorcycle" where "organisationId" is null`,
    sql: `UPDATE "Motorcycle" m SET "organisationId" = c."organisationId" FROM "Customer" c WHERE m."customerId" = c."id" AND m."organisationId" IS NULL`,
  },
  {
    why: "ServiceJob.organisationId ← branch.organisationId",
    pending: `select count(*)::int n from "ServiceJob" where "organisationId" is null`,
    sql: `UPDATE "ServiceJob" j SET "organisationId" = b."organisationId" FROM "Branch" b WHERE j."branchId" = b."id" AND j."organisationId" IS NULL`,
  },
  {
    why: "Invoice.organisationId ← branch.organisationId",
    pending: `select count(*)::int n from "Invoice" where "organisationId" is null`,
    sql: `UPDATE "Invoice" i SET "organisationId" = b."organisationId" FROM "Branch" b WHERE i."branchId" = b."id" AND i."organisationId" IS NULL`,
  },
  {
    why: "ChecklistTemplate.organisationId ← 工单最多的那家店（无关系路径，必须指定）",
    pending: `select count(*)::int n from "ChecklistTemplate" where "organisationId" is null`,
    sql: `UPDATE "ChecklistTemplate" SET "organisationId" = (
            SELECT b."organisationId" FROM "Branch" b JOIN "ServiceJob" j ON j."branchId" = b."id"
            GROUP BY b."organisationId" ORDER BY count(*) DESC LIMIT 1)
          WHERE "organisationId" IS NULL`,
  },
];

const slugify = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workshop";

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
await client.connect();
console.log("阶段:", PHASE, "| 模式:", APPLY ? "APPLY" : "只报告（--check）");

/* ---------- 回填阶段：跑数据，不跑 DDL ---------- */
if (PHASE === "backfill") {
  const q = async (sql, params) => (await client.query(sql, params)).rows;
  for (const b of BACKFILL) {
    if (!APPLY) {
      const n = await q(b.pending);
      console.log("  将回填 · " + b.why + "（待处理 " + n[0].n + " 行）");
      continue;
    }
    console.log("  执行 · " + b.why);
    await client.query(b.sql);
  }
  // slug：逐个组织生成，避免重名
  const orgs = await q(`select "id","name","slug" from "Organisation" order by "createdAt"`);
  const taken = new Set(orgs.map((o) => o.slug).filter(Boolean));
  for (const o of orgs) {
    if (o.slug) continue;
    let candidate = slugify(o.name);
    let n = 2;
    while (taken.has(candidate)) candidate = slugify(o.name) + "-" + n++;
    taken.add(candidate);
    console.log("  " + (APPLY ? "执行" : "将执行") + " · slug " + o.name + " → " + candidate);
    if (APPLY) await client.query(`UPDATE "Organisation" SET "slug" = $1 WHERE "id" = $2`, [candidate, o.id]);
  }
  if (APPLY) {
    console.log("\n--- 复核：残留 NULL 必须为 0（复合唯一键对 NULL 行不生效）---");
    const r = await q(`select
      (select count(*) from "Motorcycle" where "organisationId" is null) moto,
      (select count(*) from "ServiceJob" where "organisationId" is null) job,
      (select count(*) from "Invoice" where "organisationId" is null) inv,
      (select count(*) from "ChecklistTemplate" where "organisationId" is null) tpl,
      (select count(*) from "Organisation" where "slug" is null) slug`);
    console.log("  " + JSON.stringify(r[0]));
    const bad = Object.values(r[0]).reduce((a, b) => a + Number(b), 0);
    if (bad > 0) {
      console.error("\n❌ 仍有 " + bad + " 行没有租户值 —— 先查清归属，不要置默认值了事。");
      process.exitCode = 1;
    } else {
      console.log("\n✅ 生产回填完成。");
    }
  } else {
    console.log("\n（只报告模式：加 --apply 执行）");
  }
  await client.end();
  process.exit(process.exitCode ?? 0);
}

console.log("语句数:", stmts.length, "\n");

for (const s of stmts) {
  console.log("  " + (APPLY ? "执行" : "将执行") + " · " + s.why);
  if (APPLY) await client.query(s.sql);
}

if (APPLY) {
  console.log("\n--- 复核 ---");
  const q = async (sql) => (await client.query(sql)).rows;
  for (const [table, col, composite] of UNIQUE_SWAP) {
    const comp = await q(`select count(*)::int n from pg_indexes where schemaname='public' and indexname='${composite}'`);
    const old = await q(`select count(*)::int n from pg_indexes where schemaname='public' and indexname='${table}_${col}_key'`);
    const flag = comp[0].n === 1 && old[0].n === 0 ? "✓" : "✗";
    console.log(`  ${flag} ${table}.${col}: 复合键=${comp[0].n} 旧全局键=${old[0].n}`);
  }
  for (const t of TENANT_TABLES) {
    const r = await q(`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='${t}' and column_name='organisationId'`);
    console.log(`  ${r[0].n ? "✓" : "✗"} ${t}.organisationId`);
  }
  const org = await q(`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='Organisation' and column_name in ('slug','status','plan','trialEndsAt')`);
  console.log(`  ${org[0].n === 4 ? "✓" : "✗"} Organisation 运营字段 ${org[0].n}/4`);
} else {
  console.log("\n（只报告模式：加 --apply 执行）");
}

await client.end();
