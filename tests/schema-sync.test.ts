// The schema sync script is the thing standing between a schema change and another
// site-wide outage, so its schema parser and DDL generator are covered here.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseSchema, ddlFor, resolveUrl, looksPooled } from "../scripts/sync-prod-schema.mjs";

const schemaSrc = readFileSync(path.join(process.cwd(), "prisma/schema.pg.prisma"), "utf8");
const models = parseSchema(schemaSrc) as Record<string, { column: string; type: string; optional: boolean; ddlDefault: string | null }[]>;

describe("parseSchema", () => {
  it("finds the real models", () => {
    expect(Object.keys(models)).toContain("Campaign");
    expect(Object.keys(models)).toContain("Booking");
    expect(Object.keys(models)).toContain("Organisation");
  });

  it("maps Prisma scalars to postgres types", () => {
    expect(models.Campaign.find((f) => f.column === "audienceRules")).toMatchObject({ type: "JSONB", optional: true });
    expect(models.Campaign.find((f) => f.column === "pointsBonus")).toMatchObject({ type: "INTEGER", optional: true });
    expect(models.Booking.find((f) => f.column === "promoDiscountSen")).toMatchObject({ type: "INTEGER", optional: false, ddlDefault: "0" });
    expect(models.Booking.find((f) => f.column === "promoSnapshot")).toMatchObject({ type: "JSONB", optional: true });
    expect(models.Organisation.find((f) => f.column === "promoAutoApply")).toMatchObject({ type: "BOOLEAN", optional: false, ddlDefault: "true" });
  });

  it("skips relation fields and lists (they are not columns)", () => {
    expect(models.Booking.some((f) => f.column === "branch")).toBe(false);
    expect(models.Campaign.some((f) => f.column === "bookings")).toBe(false);
  });

  it("skips @ignore fields so an unmanaged production-only column is never dropped", () => {
    // Organisation.qrEnabled exists only in the production database. It is marked
    // @ignore precisely so the sync never emits a DROP for it.
    expect(models.Organisation.some((f) => f.column === "qrEnabled")).toBe(false);
  });
});

describe("ddlFor", () => {
  it("generates the exact additive DDL for the columns that broke production", () => {
    const { stmts } = ddlFor([
      "Campaign.audienceRules", "Campaign.pointsBonus", "Booking.promoDiscountSen",
      "Booking.promoSnapshot", "Lead.campaignId", "Organisation.promoAutoApply",
    ], models);
    expect(stmts).toContain('ALTER TABLE "Organisation" ADD COLUMN IF NOT EXISTS "promoAutoApply" BOOLEAN NOT NULL DEFAULT true;');
    expect(stmts).toContain('ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "promoDiscountSen" INTEGER NOT NULL DEFAULT 0;');
    expect(stmts).toContain('ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "audienceRules" JSONB;');
    expect(stmts.every((s: string) => s.includes("IF NOT EXISTS"))).toBe(true);
  });

  it("flags a required column with no default for backfill instead of inventing one", () => {
    const { stmts, notes } = ddlFor(["ServiceJob.mileage"], models);
    expect(stmts[0]).not.toContain("NOT NULL");
    expect(notes.join(" ")).toContain("backfill");
  });
});

/**
 * The build hung for 45 minutes on a database call that never returned, twice, on a
 * project whose builds normally take 90 seconds. These cover the two decisions that stop
 * it happening again: which url migrations are given, and whether a hang is even
 * possible.
 */
describe("resolveUrl", () => {
  it("prefers an explicit diagnostic url above everything", () => {
    expect(resolveUrl({ DRIFT_CHECK_URL: "postgres://x", DIRECT_URL: "postgres://y", DATABASE_URL: "postgres://z" }))
      .toEqual({ url: "postgres://x", source: "DRIFT_CHECK_URL" });
  });

  it("prefers the direct url over the pooled one, which is the whole point", () => {
    // Prisma migrate commands need a real session and will hang on a pooler.
    expect(resolveUrl({ DIRECT_URL: "postgres://direct", DATABASE_URL: "postgres://pooled" }))
      .toEqual({ url: "postgres://direct", source: "DIRECT_URL" });
  });

  it("falls back to DATABASE_URL when no direct url is configured", () => {
    expect(resolveUrl({ DATABASE_URL: "postgres://only" })).toEqual({ url: "postgres://only", source: "DATABASE_URL" });
  });

  it("skips a local sqlite build entirely, so a dev machine can never reach production", () => {
    expect(resolveUrl({ DATABASE_URL: "file:./dev.db" }).url).toBe("");
    expect(resolveUrl({}).url).toBe("");
  });
});

describe("looksPooled", () => {
  it("recognises the pooled shapes that break migrations", () => {
    expect(looksPooled("postgresql://u:p@aws-0-ap.pooler.supabase.com:5432/postgres")).toBe(true);
    expect(looksPooled("postgresql://u:p@db.x.supabase.co:6543/postgres")).toBe(true);
    expect(looksPooled("postgresql://u:p@db.x.supabase.co:5432/postgres?pgbouncer=true")).toBe(true);
  });

  it("leaves a direct connection alone", () => {
    expect(looksPooled("postgresql://u:p@db.dukbfgqbrprivnzcsrlh.supabase.co:5432/postgres")).toBe(false);
  });
});

