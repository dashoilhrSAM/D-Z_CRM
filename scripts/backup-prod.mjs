#!/usr/bin/env node
/**
 * 生产库备份（data-only dump + 索引清单）。
 *
 * 为什么需要它：仓库里 `docs/backups/prod-backup-2026-09-02T08-59-07-884Z.sql` 那份备份
 * 是当时**手写**脚本吐出来的，脚本没留下来 —— 于是"要备份"这件事变成了每次现编。
 * 破坏性 DDL（如 P3b 第 2 步的 DROP INDEX）按规矩必须先备份，所以这份脚本值得固化。
 *
 * 产出（都在 docs/backups/）：
 *   prod-backup-<ISO>.sql          —— 每张表先 DELETE 再逐行 INSERT（与历史备份同格式）
 *   prod-backup-<ISO>-indexes.txt  —— 全部索引清单（回滚时要知道原来有哪些）
 *
 * 用法：
 *   node scripts/backup-prod.mjs            # 备份
 *   node scripts/backup-prod.mjs --verify   # 只做只读核对（不写文件）
 *
 * ⚠️ 本机没有 pg_dump/psql（macOS 自带的是 libpq 的客户端都没有），
 *    所以这里用原生 pg 自己吐 SQL —— 也正因为如此，**恢复前请先在一个临时库上试一遍**。
 */
import { Client } from "pg";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";

const VERIFY_ONLY = process.argv.includes("--verify");
const url = process.env.DST_DATABASE_URL || process.env.DIRECT_URL;
if (!url) {
  console.error("缺少 DST_DATABASE_URL / DIRECT_URL —— 见 .env");
  process.exit(2);
}

/** JS 值 → SQL 字面量。与历史备份的写法保持一致（时间戳带 ::timestamptz 等）。 */
function literal(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (v instanceof Date) return "'" + v.toISOString() + "'::timestamptz";
  if (Buffer.isBuffer(v)) return "'\\x" + v.toString("hex") + "'::bytea";
  if (typeof v === "object") {
    // json / jsonb / 数组：先序列化成 JSON 文本，再当字符串转义
    return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";
  }
  return "'" + String(v).replace(/'/g, "''") + "'";
}

const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const safe = url.replace(/:[^:@]+@/, ":***@").slice(0, 70);
console.log("[backup] 目标库:", safe);

// 表清单（只备 public；本项目所有业务表都在 public）
const { rows: tables } = await c.query(
  `select tablename from pg_tables where schemaname = 'public' order by tablename`,
);
const { rows: indexes } = await c.query(
  `select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by tablename, indexname`,
);
console.log("[backup] 表:", tables.length, "· 索引:", indexes.length);

const lines = [];
lines.push("-- D&Z production backup " + new Date().toISOString());
lines.push("-- 库: " + safe);
lines.push("-- 用途：破坏性 DDL 前的人工安全网。格式：每表先 DELETE 再 INSERT（与历史备份一致）。");
lines.push("-- ⚠️ 恢复前请在临时库上先试一遍；本文件由 scripts/backup-prod.mjs 生成。");
lines.push("");

const summary = [];
let totalRows = 0;
for (const { tablename } of tables) {
  const t0 = Date.now();
  const { rows } = await c.query(`select * from "${tablename}"`);
  totalRows += rows.length;
  summary.push({ table: tablename, rows: rows.length, ms: Date.now() - t0 });
  if (VERIFY_ONLY) continue;
  lines.push(`-- ${tablename} (${rows.length} rows)`);
  lines.push(`DELETE FROM "${tablename}";`);
  if (rows.length) {
    const cols = Object.keys(rows[0]);
    const colList = cols.map((k) => `"${k}"`).join(", ");
    for (const r of rows) {
      lines.push(`INSERT INTO "${tablename}" (${colList}) VALUES (${cols.map((k) => literal(r[k])).join(", ")});`);
    }
  }
  lines.push("");
}

console.log("[backup] 共读取", totalRows, "行");
const biggest = summary.slice().sort((a, b) => b.rows - a.rows).slice(0, 6);
for (const s of biggest) console.log("  · " + s.table.padEnd(28) + String(s.rows).padStart(6) + " 行");

if (VERIFY_ONLY) {
  console.log("[backup] （--verify：只读核对，未写文件）");
  await c.end();
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = path.resolve("docs/backups");
mkdirSync(dir, { recursive: true });
const sqlPath = path.join(dir, `prod-backup-${stamp}.sql`);
const idxPath = path.join(dir, `prod-backup-${stamp}-indexes.txt`);
writeFileSync(sqlPath, lines.join("\n"), "utf8");
writeFileSync(idxPath, indexes.map((i) => `${i.tablename} :: ${i.indexname}\n  ${i.indexdef}`).join("\n") + "\n", "utf8");

// 复验：不接受"写完了"当成功 —— 回读文件、核对每张表都有 DELETE 与对应 INSERT 数
const written = statSync(sqlPath).size;
console.log("[backup] 已写入:", sqlPath, (written / 1024 / 1024).toFixed(2) + " MB");
console.log("[backup] 索引清单:", idxPath);
if (written < 1024) {
  console.error("[backup] ❌ 备份文件过小，不可信");
  await c.end();
  process.exit(1);
}
const text = (await import("node:fs")).readFileSync(sqlPath, "utf8");
const missingDelete = tables.filter((t) => !text.includes(`DELETE FROM "${t.tablename}";`));
const countMismatch = summary
  .filter((s) => s.rows > 0 && (text.match(new RegExp(`INSERT INTO "${s.table}" `, "g")) ?? []).length !== s.rows)
  .map((s) => s.table);
if (missingDelete.length || countMismatch.length) {
  console.error("[backup] ❌ 复验不通过 —— 缺 DELETE:", missingDelete.map((t) => t.tablename).join(",") || "无", "· INSERT 数不符:", countMismatch.join(",") || "无");
  await c.end();
  process.exit(1);
}
console.log("[backup] ✅ 复验通过：", tables.length, "张表全部有 DELETE，且 INSERT 条数与实际行数一致");
await c.end();
