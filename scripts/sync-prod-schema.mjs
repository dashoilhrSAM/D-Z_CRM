#!/usr/bin/env node
/**
 * Production schema sync + drift guard.
 *
 * WHY THIS EXISTS
 * ---------------
 * prisma/migrations is SQLite-dialect and can never be replayed against the production
 * Postgres, so schema changes reached production only when a human remembered to run
 * hand-written DDL. Four outages came from forgetting (ServiceJobPhoto, Quotation,
 * commissionRules, and the 2026-09-10 marketing columns). Because Prisma selects every
 * scalar column, one missing column does not break one feature — it breaks every query
 * on that model, i.e. the whole site.
 *
 * WHAT IT DOES
 * ------------
 *   production (VERCEL_ENV=production) -> inspect, apply additive changes, verify
 *   preview / local                    -> inspect only, never mutate
 *
 * SAFETY
 * ------
 * - Destructive statements (DROP / TRUNCATE) are never applied. The script prints them
 *   and exits non-zero so a human decides. prisma db push is also invoked WITHOUT
 *   --accept-data-loss, so it refuses on its own as a second line of defence.
 * - Only the database this build actually uses is touched (DATABASE_URL). A developer
 *   machine with a sqlite DATABASE_URL skips entirely — it can never reach production
 *   by accident. Use DRIFT_CHECK_URL to inspect a specific database on purpose.
 * - Additive changes are backward compatible with the code that is still live, so
 *   applying them before the new build goes out is safe.
 * - If the database is unreachable the script warns and lets the build continue; a
 *   network blip must not block a release.
 *
 * USAGE
 *   node scripts/sync-prod-schema.mjs           # sync on production, check elsewhere
 *   node scripts/sync-prod-schema.mjs --check   # read-only, exit 1 on drift
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA = "prisma/schema.pg.prisma";
const DESTRUCTIVE = /\b(DROP|TRUNCATE)\b/i;

const PG_TYPES = {
  String: "TEXT", Int: "INTEGER", Boolean: "BOOLEAN", DateTime: "TIMESTAMP(3)",
  Float: "DOUBLE PRECISION", Json: "JSONB", Decimal: "DECIMAL(65,30)", BigInt: "BIGINT", Bytes: "BYTEA",
};

/** Minimal Prisma schema reader: table -> [{ column, type, optional, ddlDefault }] */
export function parseSchema(src) {
  const enums = new Set([...src.matchAll(/enum\s+(\w+)\s*\{/g)].map((m) => m[1]));
  const models = {};

  for (const block of src.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const body = block[2];
    const tableMap = body.match(/@@map\("([^"]+)"\)/);
    const table = tableMap ? tableMap[1] : block[1];

    const fields = [];
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      // type must consume the whole name greedily: a lazy quantifier stops after one
      // character and swallows the rest into `rest`.
      const m = line.match(/^(\w+)\s+([\w.]+)(\[\])?(\?)?(.*)$/);
      if (!m) continue;
      const [, field, baseType, isList, isOptional, rest] = m;
      if (isList) continue;                                      // list field: no column
      if (rest.includes("@relation")) continue;                  // relation, not a scalar
      if (rest.includes("@ignore")) continue;                    // unmanaged: exists only in the DB
      if (!PG_TYPES[baseType] && !enums.has(baseType)) continue;

      const mapped = rest.match(/@map\("([^"]+)"\)/);
      let ddlDefault = null;
      const def = rest.match(/@default\(([^)]+)\)/);
      if (def) {
        const token = def[1].trim();
        if (token === "now()") ddlDefault = "CURRENT_TIMESTAMP";
        else if (token === "true" || token === "false") ddlDefault = token;
        else if (/^".*"$/.test(token)) ddlDefault = "'" + token.slice(1, -1).replace(/'/g, "''") + "'";
        else if (/^-?\d+(\.\d+)?$/.test(token)) ddlDefault = token;
      }
      fields.push({ column: mapped ? mapped[1] : field, type: PG_TYPES[baseType] ?? "TEXT", optional: Boolean(isOptional), ddlDefault });
    }
    models[table] = fields;
  }
  return models;
}

/** Idempotent DDL that would close a gap (used for the message we print). */
export function ddlFor(missing, models) {
  const stmts = [];
  const notes = [];
  for (const key of missing) {
    const [table, column] = key.split(".");
    const field = (models[table] ?? []).find((f) => f.column === column);
    if (!field) continue;
    if (!field.optional && field.ddlDefault === null) {
      stmts.push(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${field.type};`);
      notes.push(`  -- TODO: backfill "${table}"."${column}" then: ALTER TABLE "${table}" ALTER COLUMN "${column}" SET NOT NULL;`);
    } else {
      const suffix = !field.optional && field.ddlDefault !== null ? ` NOT NULL DEFAULT ${field.ddlDefault}` : "";
      stmts.push(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${field.type}${suffix};`);
    }
  }
  return { stmts, notes };
}

function prismaBin() {
  const local = path.join(process.cwd(), "node_modules/.bin/prisma");
  return existsSync(local) ? local : "prisma";
}

/**
 * Every prisma call is bounded.
 *
 * WHY THIS IS NOT OPTIONAL: this script runs inside the Vercel build. An unbounded call
 * against a database that never answers does not fail — it hangs, and the build is killed
 * by the platform after 45 minutes. That is not hypothetical: it is exactly what happened,
 * twice, on a project whose builds normally take 90 seconds. A bounded command turns an
 * unbounded outage into a visible, explainable result.
 */
const COMMAND_TIMEOUT_MS = Number(process.env.SCHEMA_SYNC_TIMEOUT_MS ?? 120000);

/**
 * Thrown when a prisma command exceeded its budget, as opposed to failing on its own.
 * The two are handled differently: a timeout is an infrastructure problem we retry or
 * skip, while a real error is something a human needs to read.
 */
export class PrismaTimeout extends Error {
  constructor(seconds) {
    super("prisma did not respond within " + seconds + "s");
    this.name = "PrismaTimeout";
    this.seconds = seconds;
  }
}

function runPrisma(args, env, timeoutMs = COMMAND_TIMEOUT_MS) {
  try {
    return execFileSync(prismaBin(), args, {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (e) {
    // execFileSync signals a timeout through the signal it sent, not a readable message.
    if (e.signal === "SIGKILL" || e.killed === true || /ETIMEDOUT/.test(String(e.code))) {
      throw new PrismaTimeout(Math.round(timeoutMs / 1000));
    }
    throw e;
  }
}

/** Milliseconds since a start time, for the per-step timings in the log. */
function elapsed(startedAt) {
  return ((Date.now() - startedAt) / 1000).toFixed(1) + "s";
}

/**
 * 把连接串（连同其中的密码）从任何准备打印的文本里抹掉。
 *
 * 2026-09-23：这里曾经只打印 e.message 的第一行 —— "Command failed: …prisma migrate diff …"，
 * 真正的 Prisma 错误（P1000 密码错 / P1001 主机不可达 / FATAL ENOTFOUND 区域不对）全被吞掉，
 * 于是一次"连不上"变成了一条查不出原因的日志，只能靠人肉猜。
 * 现在 stderr 尾部照样打，但连接串一律脱敏。
 */
export function redactSecrets(text, url) {
  let out = String(text ?? "");
  if (url) out = out.split(url).join("[REDACTED]");
  // 兜底：任何残留的 postgres 连接串整体抹掉（含密码与主机）
  out = out.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "[REDACTED]");
  return out;
}

/** SQL that would take the database from its current state to the schema. */
export function diffSql(url) {
  return runPrisma(
    ["migrate", "diff", "--from-url", url, "--to-schema-datamodel", SCHEMA, "--script"],
    { DATABASE_URL: url },
  )
    .split("\n")
    .filter((l) => !/^\s*(warn|For more information|--\s*$)/.test(l))
    .filter((l) => l.trim() && !l.trim().startsWith("--"))
    .join("\n")
    .trim();
}

/**
 * A connection that migrations can actually use.
 *
 * Prisma's migrate commands need a real session; a Supabase connection pooler (port
 * 6543, or pgbouncer=true) does not provide one and the command waits rather than
 * failing. That is the most likely reason the build hung. So a direct URL wins when one
 * is configured, and a pooled-looking URL gets a loud warning instead of a silent hang.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveUrl(env = process.env) {
  const explicit = env.DRIFT_CHECK_URL;
  if (explicit) return { url: explicit, source: "DRIFT_CHECK_URL" };

  const direct = env.DIRECT_URL;
  if (direct) return { url: direct, source: "DIRECT_URL" };

  const primary = env.DATABASE_URL ?? "";
  if (!primary || primary.startsWith("file:")) return { url: "", source: "none (sqlite or unset)" };
  return { url: primary, source: "DATABASE_URL" };
}

/**
 * True when a connection string is a **transaction** pooler — the shape that makes
 * Prisma's migrate commands hang, because they need a real session and a transaction
 * pooler may hand each statement a different connection.
 *
 * WHY THE BLANKET `pooler.supabase.com` TEST IS GONE (2026-09-17)
 * --------------------------------------------------------------
 * It used to be one of the three patterns, which made the warning below fire on the
 * Supavisor **session** pooler too — and then tell the reader to switch to the "direct"
 * Supabase url. For this project that advice is exactly backwards:
 *
 *     db.<ref>.supabase.co   →  AAAA only, NO A record (IPv6-only)
 *     Vercel build machines  →  IPv4 egress only
 *
 * so the direct host is unreachable from the build, while the session pooler
 * (`<region>.pooler.supabase.com:5432`, user `postgres.<ref>`) works: measured
 * `migrate diff` exit 0 and a CREATE/DROP probe both succeeded through it.
 * Warning people away from the only address that works is worse than not warning.
 *
 * @param {string} url
 */
export function isTransactionPooler(url) {
  return /:6543\b/.test(url) || /pgbouncer=true/.test(url);
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const isProduction = process.env.VERCEL_ENV === "production";
  const startedAt = Date.now();

  const { url, source } = resolveUrl();
  if (!url) {
    console.log("[schema-sync] no postgres url — skipping (" + source + ")");
    return;
  }
  console.log("[schema-sync] database from " + source + " | timeout " + Math.round(COMMAND_TIMEOUT_MS / 1000) + "s per command");

  if (isTransactionPooler(url) && !process.env.DRIFT_CHECK_URL) {
    console.warn("[schema-sync] WARNING: this looks like a TRANSACTION pooler (port 6543 / pgbouncer=true).");
    console.warn("[schema-sync] Prisma migrate commands need a real session and will hang on one.");
    console.warn("[schema-sync] Use the Supavisor SESSION pooler instead — same host, port 5432,");
    console.warn("[schema-sync] user postgres.<project-ref>:");
    console.warn("[schema-sync]   postgresql://postgres.<ref>:<password>@<region>.pooler.supabase.com:5432/postgres");
    console.warn("[schema-sync] (Do NOT switch to db.<ref>.supabase.co — that host is IPv6-only and");
    console.warn("[schema-sync] unreachable from Vercel builds.)");
  }

  let sql;
  const inspectStarted = Date.now();
  try {
    sql = diffSql(url);
    console.log("[schema-sync] inspected in " + elapsed(inspectStarted));
  } catch (e) {
    const why = e instanceof PrismaTimeout
      ? "inspection timed out after " + e.seconds + "s"
      : "could not inspect the database (" + String(e.message).split("\n")[0] + ")";
    // 打印底层 Prisma 错误的尾部：没有这几行，"连不上"就无法区分密码错 / 主机不可达 / 区域不对。
    const detail = redactSecrets(e.stderr ?? "", url)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.toLowerCase().startsWith("warn") && !l.includes("prisma-config"));
    if (detail.length > 0) {
      console.error("[schema-sync] prisma said:");
      for (const l of detail.slice(-6)) console.error("[schema-sync]   " + l);
    }
    if (isProduction && !checkOnly) {
      // 2026-09-15 生产事故后收紧：以前这里一律 fail-open（"连不上就不检查，让构建继续"），
      // 结果 owner 合并了带 schema 变更的分支后，构建**成功**、站点**全挂**——
      // 因为 Prisma 默认 SELECT 全部标量列，缺一列就不是某个功能坏，而是整个站点 500。
      // 现在：生产环境下"无法验证"= 构建失败。失败的部署会保留上一个能用的版本，
      // 而"没验证过的部署"会把站点直接打下去——两害相权，取前者。
      // 本地/预览仍然 fail-open：那里连不上数据库不该拦住任何人。
      console.error("[schema-sync] " + why + ".");
      console.error("[schema-sync] In production this fails the build on purpose: we could not verify that");
      console.error("[schema-sync] the database matches the schema, and Prisma selects every scalar column —");
      console.error("[schema-sync] one missing column takes the whole site down, not just the new feature.");
      // 这段提示必须指向**真的能连上**的那个地址。2026-09-17 实测：Supabase 的直连主机只有 AAAA、
      // 没有 A 记录，而 Vercel 构建出站只有 IPv4 —— 所以"改用直连地址"这条建议恰恰是把构建弄挂的原因。
      console.error("[schema-sync] Fix the connection and redeploy. The previous deployment stays live meanwhile.");
      console.error("[schema-sync] On Vercel, DIRECT_URL must be the Supavisor SESSION pooler:");
      console.error("[schema-sync]   postgresql://postgres.<project-ref>:<password>@<region>.pooler.supabase.com:5432/postgres");
      console.error("[schema-sync] Do NOT use db.<project-ref>.supabase.co — that host has no A record (IPv6-only)");
      console.error("[schema-sync] and Vercel builds only have IPv4 egress.");
      process.exit(1);
    }
    console.log("[schema-sync] " + why + " — skipping the check (build continues, schema NOT verified)");
    return;
  }

  if (!sql) {
    console.log("[schema-sync] schema and database agree — nothing to do");
    return;
  }

  console.log("[schema-sync] pending changes:\n" + sql.split("\n").map((l) => "  " + l).join("\n"));

  // Never apply a destructive change automatically.
  const destructive = sql.split("\n").filter((l) => DESTRUCTIVE.test(l));
  if (destructive.length > 0) {
    console.error("");
    console.error("================================================================");
    console.error(" DESTRUCTIVE SCHEMA CHANGE — refusing to apply automatically");
    console.error("================================================================");
    console.error("");
    console.error("These statements would drop data and were NOT applied:");
    for (const l of destructive) console.error("  " + l);
    console.error("");
    console.error("Decide deliberately, then either adjust the schema or apply the DDL by hand.");
    console.error("================================================================");
    process.exit(1);
  }

  if (checkOnly || !isProduction) {
    console.log("[schema-sync] additive changes pending; not applied here (" +
      (checkOnly ? "--check" : "VERCEL_ENV=" + (process.env.VERCEL_ENV ?? "unset")) + "). Production applies them.");
    return;
  }

  console.log("[schema-sync] applying additive changes to production…");
  const applyStarted = Date.now();
  try {
    // Deliberately no --accept-data-loss: let prisma refuse if it sees anything risky.
    runPrisma(["db", "push", "--schema", SCHEMA, "--skip-generate"], { DATABASE_URL: url, DIRECT_URL: url });
    console.log("[schema-sync] applied in " + elapsed(applyStarted));
  } catch (e) {
    if (e instanceof PrismaTimeout) {
      // Fail CLOSED on apply: a half-applied push is worse than a build that stops.
      // The point of the timeout is that this takes two minutes to say so, not 45.
      console.error("[schema-sync] applying changes timed out after " + e.seconds + "s.");
      console.error("[schema-sync] The database may be partially updated. Nothing destructive is ever");
      console.error("[schema-sync] applied by this script, so re-running is safe. Check that DIRECT_URL is a");
      console.error("[schema-sync] direct (non-pooled) connection and run: node scripts/sync-prod-schema.mjs");
      process.exit(1);
    }
    const raw = String(e.stderr ?? e.message);
    console.error("[schema-sync] db push failed: " + raw.split("\n").slice(0, 20).join("\n"));
    // 2026-09-23 事故：P0b 给 ServiceType 加了 @@unique([organisationId, code])，于是每一次生产构建
    // 都在这里失败（42、43 两个 PR 的部署全红），而**本地构建完全正常** —— 因为本地连不上生产库、
    // 根本走不到 push。prisma 无法证明"已有数据里没有重复"，就把加唯一约束当成潜在数据丢失。
    // 这个提示让人一眼知道该干什么，而不是把 --accept-data-loss 加上去蒙过去。
    if (/--accept-data-loss/.test(raw)) {
      console.error("");
      console.error("[schema-sync] That message means prisma found a change it cannot prove safe — most often a");
      console.error("[schema-sync] UNIQUE constraint (or a required column) being added to a table that already has");
      console.error("[schema-sync] rows, because it cannot know whether the existing data satisfies it.");
      console.error("[schema-sync] This script deliberately does NOT pass --accept-data-loss. Decide deliberately:");
      console.error("[schema-sync]   1. verify the data, e.g.  SELECT organisationId, code, count(*) FROM \"ServiceType\"");
      console.error("[schema-sync]      GROUP BY 1,2 HAVING count(*) > 1;   (NULLs count as distinct, so NULL rows are fine)");
      console.error("[schema-sync]   2. create that one index by hand (idempotent DDL), then re-run this script — it will");
      console.error("[schema-sync]      then apply the remaining additive changes and verify the result.");
      console.error("[schema-sync] See docs/changes/2026-09-23-schema-sync-data-loss-warning.md");
    }
    process.exit(1);
  }

  const after = diffSql(url);
  if (after) {
    console.error("[schema-sync] schema still differs after sync:\n" + after);
    process.exit(1);
  }
  console.log("[schema-sync] production schema is now in sync (total " + elapsed(startedAt) + ")");
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error("[schema-sync] unexpected error:", e);
    process.exit(1);
  });
}
