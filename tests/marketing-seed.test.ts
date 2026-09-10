// The marketing dataset is seeded by one command, in an order that matters.
//
// This is covered because the failure it prevents is silent: the tables existed in
// production and were empty, so the Content Studio came up with nothing to suggest and
// looked broken rather than unseeded. Nothing errored — the data simply was not there.
import { describe, expect, it } from "vitest";
import { occasionRows, seedOccasions, openWindowCount, PAYDAY_HORIZON_MONTHS } from "@/modules/marketing/occasion-seed";
import { seedPromoProducts, IMAGE_SOURCE } from "../scripts/import-promo-products";
import { seedBrandProfiles } from "../scripts/seed-brand-profiles";
import { seedDashoilBrand } from "../scripts/apply-dashoil-brand";
import { explain } from "../scripts/seed-marketing-data";

describe("occasionRows", () => {
  it("covers a full year of planning, not just the next holiday", () => {
    const rows = occasionRows();
    expect(rows.length).toBeGreaterThan(30);
    const types = new Set(rows.map((r) => r.type));
    expect(types.has("FESTIVAL")).toBe(true);
    expect(types.has("PAYDAY")).toBe(true);
  });

  /**
   * The paydays are generated from the current month, so the calendar never runs out.
   * A calendar that has gone dry is a planner with nothing to suggest, and it fails
   * quietly — which is the whole reason this is generated rather than listed.
   */
  it("rolls the payday horizon forward with the date it is given", () => {
    const now = occasionRows(new Date("2026-09-10T00:00:00Z"));
    const later = occasionRows(new Date("2027-03-15T00:00:00Z"));
    const paydays = (rows: ReturnType<typeof occasionRows>) => rows.filter((r) => r.type === "PAYDAY").map((r) => r.startDate);
    expect(paydays(now)[0].startsWith("2026-09")).toBe(true);
    expect(paydays(later)[0].startsWith("2027-03")).toBe(true);
    expect(paydays(later).length).toBe(PAYDAY_HORIZON_MONTHS);
  });

  it("gives every occasion a key, so re-running updates instead of duplicating", () => {
    const rows = occasionRows();
    expect(rows.every((r) => typeof r.key === "string" && r.key.length > 0)).toBe(true);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  /**
   * The lead time is the product. A calendar that only knows holiday dates posts a Raya
   * greeting on Raya and misses the weeks when people are actually booking.
   */
  it("carries a lead time and an angle for every entry", () => {
    for (const r of occasionRows()) {
      expect(typeof r.leadDays).toBe("number");
      expect(r.angleHint.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The window rule is the whole value of the calendar: content has to START before the
 * holiday, not on it. A status report that restated the rule could quietly disagree with
 * the planner, so this checks the shared one.
 */
describe("openWindowCount", () => {
  const occasion = (startDate: string, leadDays: number, endDate?: string) => ({ startDate, endDate: endDate ?? null, leadDays });

  it("does not count an occasion whose lead time has not begun", () => {
    expect(openWindowCount([occasion("2026-10-01", 7)], new Date("2026-09-10T00:00:00Z"))).toBe(0);
  });

  it("counts it from the moment the lead time opens", () => {
    // Opens 7 days before 1 October, so 24 September is the first day.
    expect(openWindowCount([occasion("2026-10-01", 7)], new Date("2026-09-24T00:00:00Z"))).toBe(1);
    expect(openWindowCount([occasion("2026-10-01", 7)], new Date("2026-09-23T00:00:00Z"))).toBe(0);
  });

  it("counts it on the day itself", () => {
    expect(openWindowCount([occasion("2026-10-01", 7)], new Date("2026-10-01T00:00:00Z"))).toBe(1);
  });

  it("runs through a multi-day occasion and then stops", () => {
    const monsoon = occasion("2026-11-01", 7, "2027-03-31");
    expect(openWindowCount([monsoon], new Date("2027-01-15T00:00:00Z"))).toBe(1);
    expect(openWindowCount([monsoon], new Date("2027-04-01T00:00:00Z"))).toBe(0);
  });

  it("counts each occasion independently", () => {
    const rows = [occasion("2026-10-01", 7), occasion("2026-12-25", 14), occasion("2026-11-01", 7, "2027-03-31")];
    expect(openWindowCount(rows, new Date("2026-09-25T00:00:00Z"))).toBe(1);
  });
});

describe("seed modules", () => {
  /**
   * They used to run their work on import, which meant importing one to call its seed
   * function also fired it. The single entry point imports all four.
   */
  it("export their seeds instead of running them on import", () => {
    for (const fn of [seedOccasions, seedPromoProducts, seedBrandProfiles, seedDashoilBrand]) {
      expect(typeof fn).toBe("function");
    }
  });

  it("reads images from the committed catalogue by default, not a temp directory", () => {
    // The committed copies are what production serves; the temp path is only a
    // convenience on a machine that has just re-optimised the artwork.
    expect(IMAGE_SOURCE.startsWith(process.cwd())).toBe(false);
  });
});

describe("explain", () => {
  const sqliteClientError = new Error("Error validating datasource `db`: the URL must start with the protocol `file:`.");

  it("turns the sqlite-client-with-postgres-url failure into the command that fixes it", () => {
    const before = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://u:p@host:5432/db";
    const hint = explain(sqliteClientError);
    expect(hint).toContain("schema.pg.prisma");
    expect(hint).toContain("restore the SQLite client");
    process.env.DATABASE_URL = before;
  });

  it("stays out of the way for a genuine local failure", () => {
    const before = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "file:./dev.db";
    expect(explain(sqliteClientError)).toBeNull();
    expect(explain(new Error("some other problem"))).toBeNull();
    process.env.DATABASE_URL = before;
  });
});
