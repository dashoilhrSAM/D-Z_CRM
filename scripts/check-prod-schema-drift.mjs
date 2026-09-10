#!/usr/bin/env node
/**
 * Production schema drift guard.
 *
 * Prisma selects every scalar column, so a column that exists in schema.pg.prisma but
 * not in the production database turns every query on that model into a 500 — the whole
 * site goes down, not just the feature that added the column. That has now happened four
 * times (ServiceJobPhoto, Quotation, commissionRules, and the marketing columns).
 *
 * This runs as part of the Vercel build. It blocks the deploy when the code is ahead of
 * the database and prints the exact idempotent DDL to apply.
 *
 * Failure policy:
 *   - real drift        -> exit 1 (fail the deploy; shipping this breaks the site)
 *   - DB unreachable    -> exit 0 with a warning (a network blip must not block deploys)
 *   - no PG url / local -> exit 0 silently (sqlite dev builds)
 *
 * Usage:  node scripts/check-prod-schema-drift.mjs
 * Env:    DATABASE_URL or DST_DATABASE_URL (a postgres:// url)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PG_TYPES = {
  String: "TEXT",
  Int: "INTEGER",
  Boolean: "BOOLEAN",
  DateTime: "TIMESTAMP(3)",
  Float: "DOUBLE PRECISION",
  Json: "JSONB",
  Decimal: "DECIMAL(65,30)",
  BigInt: "BIGINT",
  Bytes: "BYTEA",
};

/** Minimal Prisma schema reader: model -> [{ column, type, optional, ddlDefault }] */
export function parseSchema(src) {
  const enums = new Set(
    [...src.matchAll(/enum\s+(\w+)\s*\{/g)].map((m) => m[1]),
  );
  const models = {};

  for (const block of src.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const modelName = block[1];
    const body = block[2];
    const tableMap = body.match(/@@map\("([^"]+)"\)/);
    const table = tableMap ? tableMap[1] : modelName;

    const fields = [];
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      // type must consume the whole name greedily: a lazy quantifier makes the regex
      // stop after one character and swallow the rest into `rest`.
      const m = line.match(/^(\w+)\s+([\w.]+)(\[\])?(\?)?(.*)$/);
      if (!m) continue;
      const [, field, baseType, isList, isOptional, rest] = m;
      if (isList) continue;                                              // list field: no column
      if (rest.includes("@relation")) continue;                          // relation, not a scalar
      if (!PG_TYPES[baseType] && !enums.has(baseType)) continue;         // unknown / relation object

      const mapped = rest.match(/@map\("([^"]+)"\)/);
      const column = mapped ? mapped[1] : field;
      const optional = Boolean(isOptional);

      let ddlDefault = null;
      const def = rest.match(/@default\(([^)]+)\)/);
      if (def) {
        const token = def[1].trim();
        if (token === "now()") ddlDefault = "CURRENT_TIMESTAMP";
        else if (token === "true") ddlDefault = "true";
        else if (token === "false") ddlDefault = "false";
        else if (token === "autoincrement()") ddlDefault = null;
        else if (token === "cuid()" || token === "uuid()" || token.startsWith("dbgenerated")) ddlDefault = null;
        else if (/^".*"$/.test(token)) ddlDefault = "'" + token.slice(1, -1).replace(/'/g, "''") + "'";
        else if (/^-?\d+(\.\d+)?$/.test(token)) ddlDefault = token;
        else ddlDefault = null;
      }

      fields.push({ column, type: PG_TYPES[baseType] ?? "TEXT", optional, ddlDefault });
    }
    models[table] = fields;
  }
  return models;
}

/** The idempotent DDL that closes the gap. */
export function ddlFor(missing, models) {
  const stmts = [];
  const notes = [];
  for (const key of missing) {
    const [table, column] = key.split(".");
    const field = models[table].find((f) => f.column === column);
    if (!field) continue;
    if (!field.optional && field.ddlDefault === null) {
      // required with no default: add it nullable, backfill, then tighten
      stmts.push(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${field.type};`);
      notes.push(`  -- TODO: backfill "${table}"."${column}" then: ALTER TABLE "${table}" ALTER COLUMN "${column}" SET NOT NULL;`);
    } else {
      const suffix = !field.optional && field.ddlDefault !== null ? ` NOT NULL DEFAULT ${field.ddlDefault}` : "";
      stmts.push(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${field.type}${suffix};`);
    }
  }
  return { stmts, notes };
}

async function main() {
  // Check the database this build will actually use (DATABASE_URL). Locally that is
  // sqlite, so the guard skips — it must never silently reach for production from a
  // developer machine. Set DRIFT_CHECK_URL to inspect a specific database on purpose.
  const primary = process.env.DATABASE_URL ?? "";
  const url = process.env.DRIFT_CHECK_URL || (primary.startsWith("file:") ? "" : primary);
  if (!url) {
    console.log("[drift-guard] no postgres url — skipping (local/sqlite build)");
    return;
  }

  const schemaPath = path.join(process.cwd(), "prisma/schema.pg.prisma");
  const models = parseSchema(readFileSync(schemaPath, "utf8"));

  let Client;
  try {
    ({ Client } = await import("pg"));
  } catch {
    console.log("[drift-guard] pg not installed — skipping");
    return;
  }

  const client = new Client({ connectionString: url, ssl: url.includes("localhost") ? false : { rejectUnauthorized: false } });
  let rows, tables;
  try {
    await client.connect();
    ({ rows } = await client.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'"));
    tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows;
    await client.end();
  } catch (e) {
    // do not block a deploy on a network problem
    console.log("[drift-guard] could not reach the database (" + e.message + ") — skipping check");
    return;
  }

  const tableSet = new Set(tables.map((r) => r.table_name));
  const colSet = new Set(rows.map((r) => r.table_name + "." + r.column_name));

  const missingTables = Object.keys(models).filter((t) => !tableSet.has(t));
  const missingCols = [];
  for (const [table, fields] of Object.entries(models)) {
    if (!tableSet.has(table)) continue;
    for (const f of fields) if (!colSet.has(table + "." + f.column)) missingCols.push(table + "." + f.column);
  }

  if (missingTables.length === 0 && missingCols.length === 0) {
    console.log("[drift-guard] production schema matches schema.pg.prisma (" + Object.keys(models).length + " models)");
    return;
  }

  console.error("");
  console.error("================================================================");
  console.error(" PRODUCTION SCHEMA DRIFT — deploy blocked");
  console.error("================================================================");
  console.error("");
  console.error("The code expects columns the production database does not have.");
  console.error("Prisma selects every scalar column, so this returns 500 on every");
  console.error("query touching those models — the whole site, not one feature.");
  console.error("");
  if (missingTables.length) {
    console.error("Missing tables (" + missingTables.length + "): " + missingTables.join(", "));
    console.error("");
  }
  if (missingCols.length) {
    console.error("Missing columns (" + missingCols.length + "):");
    for (const c of missingCols) console.error("  " + c);
    console.error("");
    const { stmts, notes } = ddlFor(missingCols, models);
    console.error("Apply this (idempotent, additive-only) and redeploy:");
    console.error("");
    for (const s of stmts) console.error("  " + s);
    for (const n of notes) console.error(n);
    console.error("");
  }
  console.error("================================================================");
  process.exit(1);
}

// Only run when invoked directly, so the pure helpers stay importable by tests.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error("[drift-guard] unexpected error:", e);
    process.exit(1);
  });
}
