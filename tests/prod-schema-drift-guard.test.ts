// The drift guard must actually catch the class of outage that took production down:
// a column present in schema.pg.prisma but absent from the live database.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseSchema, ddlFor } from "../scripts/check-prod-schema-drift.mjs";

const schemaSrc = readFileSync(path.join(process.cwd(), "prisma/schema.pg.prisma"), "utf8");

describe("parseSchema", () => {
  const models = parseSchema(schemaSrc) as Record<string, { column: string; type: string; optional: boolean; ddlDefault: string | null }[]>;

  it("finds the real models", () => {
    expect(Object.keys(models)).toContain("Campaign");
    expect(Object.keys(models)).toContain("Booking");
    expect(Object.keys(models)).toContain("Organisation");
  });

  it("maps Prisma scalars to postgres types", () => {
    const campaign = models.Campaign;
    expect(campaign.find((f) => f.column === "audienceRules")).toMatchObject({ type: "JSONB", optional: true });
    expect(campaign.find((f) => f.column === "pointsBonus")).toMatchObject({ type: "INTEGER", optional: true });
    const booking = models.Booking;
    expect(booking.find((f) => f.column === "promoDiscountSen")).toMatchObject({ type: "INTEGER", optional: false, ddlDefault: "0" });
    expect(booking.find((f) => f.column === "promoSnapshot")).toMatchObject({ type: "JSONB", optional: true });
    const org = models.Organisation;
    expect(org.find((f) => f.column === "promoAutoApply")).toMatchObject({ type: "BOOLEAN", optional: false, ddlDefault: "true" });
  });

  it("skips relation fields and lists (they are not columns)", () => {
    expect(models.Booking.some((f) => f.column === "branch")).toBe(false);   // relation object
    expect(models.Campaign.some((f) => f.column === "bookings")).toBe(false); // list
  });
});

describe("ddlFor", () => {
  const models = parseSchema(schemaSrc) as Parameters<typeof ddlFor>[1];

  it("generates the exact additive DDL for the columns that broke production", () => {
    const missing = [
      "Campaign.audienceRules",
      "Campaign.pointsBonus",
      "Booking.promoDiscountSen",
      "Booking.promoSnapshot",
      "Lead.campaignId",
      "Organisation.promoAutoApply",
    ];
    const { stmts } = ddlFor(missing, models);
    expect(stmts).toContain('ALTER TABLE "Organisation" ADD COLUMN IF NOT EXISTS "promoAutoApply" BOOLEAN NOT NULL DEFAULT true;');
    expect(stmts).toContain('ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "promoDiscountSen" INTEGER NOT NULL DEFAULT 0;');
    expect(stmts).toContain('ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "promoSnapshot" JSONB;');
    expect(stmts).toContain('ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "audienceRules" JSONB;');
    expect(stmts).toContain('ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "pointsBonus" INTEGER;');
    expect(stmts).toContain('ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;');
    expect(stmts.every((s: string) => s.includes("IF NOT EXISTS"))).toBe(true);
  });

  it("emits every statement as idempotent", () => {
    const { stmts } = ddlFor(["Campaign.pointsBonus"], models);
    expect(stmts[0]).toContain("IF NOT EXISTS");
  });
});
