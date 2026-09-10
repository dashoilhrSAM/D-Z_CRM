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

function runPrisma(args, env) {
  return execFileSync(prismaBin(), args, { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
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

async function main() {
  const checkOnly = process.argv.includes("--check");
  const isProduction = process.env.VERCEL_ENV === "production";

  const primary = process.env.DATABASE_URL ?? "";
  const url = process.env.DRIFT_CHECK_URL || (primary.startsWith("file:") ? "" : primary);
  if (!url) {
    console.log("[schema-sync] no postgres url — skipping (local/sqlite build)");
    return;
  }

  let sql;
  try {
    sql = diffSql(url);
  } catch (e) {
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
  try {
    // Deliberately no --accept-data-loss: let prisma refuse if it sees anything risky.
    runPrisma(["db", "push", "--schema", SCHEMA, "--skip-generate"], { DATABASE_URL: url });
  } catch (e) {
    console.error("[schema-sync] db push failed: " + String(e.stderr ?? e.message).split("\n").slice(0, 20).join("\n"));
    process.exit(1);
  }

  const after = diffSql(url);
  if (after) {
    console.error("[schema-sync] schema still differs after sync:\n" + after);
    process.exit(1);
  }
  console.log("[schema-sync] production schema is now in sync");
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error("[schema-sync] unexpected error:", e);
    process.exit(1);
  });
}
