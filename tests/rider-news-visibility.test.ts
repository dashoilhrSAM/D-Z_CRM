// Posters the workshop switches OFF were still reaching riders.
//
// The workshop has a per-poster on/off-News toggle. The News feed honoured it; the promotions
// page — which the News feed links to as "view all" — read every asset regardless. In
// production that was 22 assets of which 10 were switched off.
//
// The campaign side had the same shape of bug from a different angle: four rider pages each
// hand-wrote part of "is this promotion live", and two of them checked only endDate, so a
// campaign whose window had not opened was offered and an open-ended one was hidden.
//
// Both are the same failure — one rule written in several places, each a little different —
// so both are guarded the same way: by asserting the rule is used, not restated.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isPromoActive } from "@/modules/marketing/promo";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

const RIDER_PAGES = [
  "src/app/rider/home/page.tsx",
  "src/app/rider/promotions/page.tsx",
  "src/app/rider/book/page.tsx",
  "src/app/rider/service-history/page.tsx",
];

describe("the rider side never shows a poster that is switched off", () => {
  const files = [
    "src/app/rider/promotions/page.tsx",
    "src/app/rider/service-history/page.tsx",
  ];

  it("every poster query on the rider side filters on published", () => {
    for (const file of files) {
      const src = read(file);
      const queries = src.match(/marketingAsset\.findMany\(\{[^}]*\}/g) ?? [];
      expect(queries.length, file + " no longer reads posters — update this guard").toBeGreaterThan(0);
      for (const q of queries) {
        expect(q, file + " reads posters without filtering on published").toContain("published: true");
      }
    }
  });

  it("no rider page reads posters with an unfiltered findMany", () => {
    for (const file of files) {
      expect(read(file), file).not.toMatch(/marketingAsset\.findMany\(\{\s*orderBy/);
    }
  });
});

describe("one definition of a live promotion", () => {
  it("every rider page that offers promotions asks the shared rule", () => {
    for (const file of RIDER_PAGES) {
      const src = read(file);
      if (!src.includes("campaign.findMany")) continue;
      expect(src, file + " offers promotions without using isPromoActive").toContain("isPromoActive");
    }
  });

  /**
   * The two faults the old hand-written where clauses had. Both are cases the shared rule
   * already handles, which is the point: a partial copy in a page gets them wrong.
   */
  it("a campaign whose window has not opened is not live", () => {
    const now = new Date("2026-09-11T00:00:00Z");
    const later = { type: "PROMO", status: "ACTIVE", discountPercent: 10, startDate: new Date("2026-10-01T00:00:00Z"), endDate: null };
    expect(isPromoActive(later as never, now)).toBe(false);
  });

  it("an open-ended campaign is live, so a filter on endDate alone would hide it", () => {
    const now = new Date("2026-09-11T00:00:00Z");
    const openEnded = { type: "PROMO", status: "ACTIVE", discountPercent: 10, startDate: new Date("2026-09-01T00:00:00Z"), endDate: null };
    expect(isPromoActive(openEnded as never, now)).toBe(true);
  });

  it("no rider page filters campaigns on endDate in the query any more", () => {
    // That clause was the bug: it excludes open-ended campaigns, which are valid.
    for (const file of RIDER_PAGES) {
      expect(read(file), file + " still filters endDate in SQL, which hides open-ended promos")
        .not.toMatch(/campaign\.findMany\(\{[^}]*endDate/);
    }
  });
});
