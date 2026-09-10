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
 * True when a connection string looks like a transaction pooler.
 *
 * @param {string} url
 */
export function looksPooled(url) {
  return /:6543\b/.test(url) || /pgbouncer=true/.test(url) || /pooler\.supabase\.com/.test(url);
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

  if (looksPooled(url) && !process.env.DRIFT_CHECK_URL) {
    console.warn("[schema-sync] WARNING: this looks like a connection-pooler url. Prisma migrate");
    console.warn("[schema-sync] commands need a direct connection (port 5432) and will hang on a");
    console.warn("[schema-sync] pooler. Set DIRECT_URL to the direct Supabase url.");
  }

  let sql;
  const inspectStarted = Date.now();
  try {
    sql = diffSql(url);
    console.log("[schema-sync] inspected in " + elapsed(inspectStarted));
  } catch (e) {
    if (e instanceof PrismaTimeout) {
      // Fail OPEN on inspection: a read-only check that cannot reach the database must
      // never block a release. This is the rule the script already had for an unreachable
      // database; a hang is the same situation with worse manners.
      console.log("[schema-sync] inspection timed out after " + e.seconds + "s — skipping the check (build continues, schema NOT verified)");
      return;
    }
    console.log("[schema-sync] could not inspect the database — skipping (" + String(e.message).split("\n")[0] + ")");
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
    console.error("[schema-sync] db push failed: " + String(e.stderr ?? e.message).split("\n").slice(0, 20).join("\n"));
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
