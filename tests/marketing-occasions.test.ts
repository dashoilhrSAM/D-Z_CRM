// The Malaysian content calendar.
//
// The behaviour that matters is not "is there a holiday" but "when should we start
// talking about it" — a Raya post published on Raya misses the entire pre-travel
// service window that actually drives revenue.
import { describe, it, expect } from "vitest";
import {
  MY_CALENDAR, paydayOccasions, utcDay, contentWindow, isWindowOpen, daysUntil, rankOccasions,
} from "@/modules/marketing/occasions";

const day = (s: string) => utcDay(s);

describe("utcDay", () => {
  it("anchors to UTC midnight so dates never shift with timezone", () => {
    const d = utcDay("2027-03-09");
    expect(d.toISOString()).toBe("2027-03-09T00:00:00.000Z");
  });
});

describe("contentWindow", () => {
  it("opens leadDays BEFORE the occasion, not on it", () => {
    const { from, to } = contentWindow({ startDate: "2027-03-09", leadDays: 28 });
    expect(from.toISOString()).toBe("2027-02-09T00:00:00.000Z");
    expect(to.toISOString()).toBe("2027-03-09T00:00:00.000Z");
  });

  it("runs through the end date for multi-day windows", () => {
    const { to } = contentWindow({ startDate: "2026-11-01", endDate: "2027-03-31", leadDays: 7 });
    expect(to.toISOString()).toBe("2027-03-31T00:00:00.000Z");
  });
});

describe("isWindowOpen", () => {
  const raya = { startDate: "2027-03-09", leadDays: 28 };

  it("is open inside the lead window", () => {
    expect(isWindowOpen(raya, day("2027-02-15"))).toBe(true);
  });

  it("is closed before the window opens", () => {
    expect(isWindowOpen(raya, day("2027-02-08"))).toBe(false);
  });

  it("is open on the exact day the window opens", () => {
    expect(isWindowOpen(raya, day("2027-02-09"))).toBe(true);
  });

  it("is open on the occasion date itself", () => {
    expect(isWindowOpen(raya, day("2027-03-09"))).toBe(true);
  });

  it("is closed after the occasion has passed", () => {
    expect(isWindowOpen(raya, day("2027-03-10"))).toBe(false);
  });
});

describe("daysUntil", () => {
  it("counts forward to the occasion and negative after it", () => {
    const raya = { startDate: "2027-03-09", leadDays: 28 };
    expect(daysUntil(raya, day("2027-03-09"))).toBe(0);
    expect(daysUntil(raya, day("2027-03-01"))).toBe(8);
    expect(daysUntil(raya, day("2027-03-12"))).toBe(-3);
  });
});

describe("rankOccasions", () => {
  const mk = (key: string, startDate: string, leadDays: number, relevance: number) => ({ key, startDate, leadDays, relevance });

  it("ranks an open window above a closed one regardless of relevance", () => {
    const big = mk("big", "2027-12-25", 14, 5);     // window not open yet
    const small = mk("small", "2026-09-20", 7, 2);  // window open
    const ranked = rankOccasions([big, small], day("2026-09-18"));
    expect(ranked[0].occasion.key).toBe("small");
  });

  it("ranks a higher-relevance occasion higher when both windows are open", () => {
    const hi = mk("hi", "2026-09-16", 14, 5);
    const lo = mk("lo", "2026-09-16", 14, 2);
    const ranked = rankOccasions([lo, hi], day("2026-09-10"));
    expect(ranked[0].occasion.key).toBe("hi");
  });

  it("ranks a nearer date higher than a further one inside the same window", () => {
    const near = mk("near", "2026-09-12", 14, 3);
    const far = mk("far", "2026-09-25", 14, 3);
    const ranked = rankOccasions([far, near], day("2026-09-10"));
    expect(ranked[0].occasion.key).toBe("near");
  });

  it("pushes past occasions to the bottom", () => {
    const past = mk("past", "2026-01-01", 7, 5);
    const future = mk("future", "2026-12-25", 14, 2);
    const ranked = rankOccasions([past, future], day("2026-09-10"));
    expect(ranked[ranked.length - 1].occasion.key).toBe("past");
  });

  it("marks windowOpen consistently", () => {
    const ranked = rankOccasions([mk("a", "2026-09-16", 7, 3)], day("2026-09-13"));
    expect(ranked[0].windowOpen).toBe(true);
    expect(ranked[0].daysUntil).toBe(3);
  });
});

describe("paydayOccasions", () => {
  it("generates the 25th of each month", () => {
    const rows = paydayOccasions("2026-09", 3);
    expect(rows.map((r) => r.startDate)).toEqual(["2026-09-25", "2026-10-25", "2026-11-25"]);
  });

  it("crosses the year boundary correctly", () => {
    const rows = paydayOccasions("2026-11", 3);
    expect(rows.map((r) => r.startDate)).toEqual(["2026-11-25", "2026-12-25", "2027-01-25"]);
    expect(rows[2].key).toBe("MY-PAYDAY-2027-01");
  });

  it("is deliberately low relevance so it yields to real occasions", () => {
    expect(paydayOccasions("2026-09", 1)[0].relevance).toBeLessThan(3);
  });
});

describe("MY_CALENDAR data integrity", () => {
  it("has unique keys", () => {
    const keys = MY_CALENDAR.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses ISO date strings", () => {
    for (const o of MY_CALENDAR) {
      expect(o.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(utcDay(o.startDate).getTime())).toBe(false);
      if (o.endDate) expect(o.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("keeps relevance in 1-5 and a non-negative lead time", () => {
    for (const o of MY_CALENDAR) {
      expect(o.relevance).toBeGreaterThanOrEqual(1);
      expect(o.relevance).toBeLessThanOrEqual(5);
      expect(o.leadDays).toBeGreaterThanOrEqual(0);
    }
  });

  it("never ends before it starts", () => {
    for (const o of MY_CALENDAR) {
      if (o.endDate) expect(utcDay(o.endDate).getTime()).toBeGreaterThanOrEqual(utcDay(o.startDate).getTime());
    }
  });

  it("gives the two biggest travel events the longest lead time", () => {
    const raya = MY_CALENDAR.find((o) => o.key === "MY-2027-RAYA-AIDILFITRI")!;
    const cny = MY_CALENDAR.find((o) => o.key === "MY-2027-CNY")!;
    expect(raya.relevance).toBe(5);
    expect(raya.leadDays).toBeGreaterThanOrEqual(21);
    expect(cny.relevance).toBe(5);
    expect(cny.leadDays).toBeGreaterThanOrEqual(14);
  });

  it("gives every occasion an editorial angle, not just a date", () => {
    for (const o of MY_CALENDAR) {
      expect(o.angleHint.length).toBeGreaterThan(20);
    }
  });
});
