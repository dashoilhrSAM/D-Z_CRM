// MKT-013: promo must actually apply.
// Regression for the state where the rider UI advertised "-20%" while booking and
// invoice both charged the full amount (bestPromoQuote existed but was never called).
import { describe, it, expect, vi, beforeEach } from "vitest";

const { dbMock } = vi.hoisted(() => {
  const dbMock = {
    campaign: { findMany: vi.fn(), findUnique: vi.fn() },
    organisation: { findFirst: vi.fn() },
  };
  return { dbMock };
});

vi.mock("@/lib/db", () => ({ db: dbMock }));

import {
  discountForSubtotal,
  isPromoAutoApplyEnabled,
  readPromoSnapshot,
  resolvePromoForBooking,
  toPromoSnapshot,
} from "@/modules/marketing/promo-resolve";

const now = new Date("2026-09-10T00:00:00Z");
const LINES = [{ description: "Standard Service", priceSen: 12000 }, { description: "Oil Filter", priceSen: 2500 }];

const promo = (over: Record<string, unknown> = {}) => ({
  id: "c1", name: "Raya Promo", type: "PROMO", status: "ACTIVE", branchId: "b1",
  startDate: new Date("2026-09-01"), endDate: new Date("2026-09-30"), discountPercent: 20,
  ...over,
});

describe("resolvePromoForBooking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.organisation.findFirst.mockResolvedValue({ promoAutoApply: true });
  });

  it("honours the campaign the rider came through", async () => {
    dbMock.campaign.findUnique.mockResolvedValue(promo({ discountPercent: 20 }));
    const q = await resolvePromoForBooking({ branchId: "b1", lines: LINES, campaignId: "c1", now });
    expect(q?.campaignId).toBe("c1");
    expect(q?.savedSen).toBe(2900); // 20% of 14500
    expect(q?.discountedSen).toBe(11600);
    expect(dbMock.campaign.findMany).not.toHaveBeenCalled();
  });

  it("ignores an explicit campaign that is not active and falls back to the best live one", async () => {
    dbMock.campaign.findUnique.mockResolvedValue(promo({ status: "DRAFT" }));
    dbMock.campaign.findMany.mockResolvedValue([promo({ id: "live", discountPercent: 10 })]);
    const q = await resolvePromoForBooking({ branchId: "b1", lines: LINES, campaignId: "c1", now });
    expect(q?.campaignId).toBe("live");
  });

  it("ignores an explicit campaign belonging to another branch", async () => {
    dbMock.campaign.findUnique.mockResolvedValue(promo({ branchId: "b-other" }));
    dbMock.campaign.findMany.mockResolvedValue([promo({ id: "mine", discountPercent: 15 })]);
    const q = await resolvePromoForBooking({ branchId: "b1", lines: LINES, campaignId: "c1", now });
    expect(q?.campaignId).toBe("mine");
  });

  it("applies the best active promo when no campaign link is present and auto-apply is on", async () => {
    dbMock.campaign.findMany.mockResolvedValue([promo({ id: "a", discountPercent: 10 }), promo({ id: "b", discountPercent: 25 })]);
    const q = await resolvePromoForBooking({ branchId: "b1", lines: LINES, now });
    expect(q?.campaignId).toBe("b");
  });

  it("returns null when nothing is live or there is nothing to price", async () => {
    dbMock.campaign.findMany.mockResolvedValue([]);
    expect(await resolvePromoForBooking({ branchId: "b1", lines: LINES, now })).toBeNull();
    expect(await resolvePromoForBooking({ branchId: "b1", lines: [], now })).toBeNull();
  });

  it("excludes expired / not-yet-started campaigns", async () => {
    dbMock.campaign.findMany.mockResolvedValue([
      promo({ id: "expired", endDate: new Date("2026-08-01") }),
      promo({ id: "future", startDate: new Date("2026-10-01") }),
    ]);
    expect(await resolvePromoForBooking({ branchId: "b1", lines: LINES, now })).toBeNull();
  });

  describe("with the marketing toggle OFF (Organisation.promoAutoApply = false)", () => {
    beforeEach(() => dbMock.organisation.findFirst.mockResolvedValue({ promoAutoApply: false }));

    it("does NOT discount a booking that has no campaign link", async () => {
      dbMock.campaign.findMany.mockResolvedValue([promo({ id: "live", discountPercent: 25 })]);
      expect(await resolvePromoForBooking({ branchId: "b1", lines: LINES, now })).toBeNull();
    });

    it("still discounts a booking that came through a live campaign link", async () => {
      dbMock.campaign.findUnique.mockResolvedValue(promo({ discountPercent: 20 }));
      const q = await resolvePromoForBooking({ branchId: "b1", lines: LINES, campaignId: "c1", now });
      expect(q?.campaignId).toBe("c1");
    });
  });
});

describe("isPromoAutoApplyEnabled", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the organisation setting", async () => {
    dbMock.organisation.findFirst.mockResolvedValue({ promoAutoApply: false });
    expect(await isPromoAutoApplyEnabled()).toBe(false);
    dbMock.organisation.findFirst.mockResolvedValue({ promoAutoApply: true });
    expect(await isPromoAutoApplyEnabled()).toBe(true);
  });

  it("falls back to the default when no organisation exists", async () => {
    dbMock.organisation.findFirst.mockResolvedValue(null);
    expect(await isPromoAutoApplyEnabled()).toBe(true);
  });
});

describe("discountForSubtotal (invoice side)", () => {
  it("applies the percent to the invoice subtotal", () => {
    expect(discountForSubtotal(14500, 20)).toBe(2900);
    expect(discountForSubtotal(10000, 33)).toBe(3300);
  });

  it("never discounts more than the subtotal and ignores junk input", () => {
    expect(discountForSubtotal(1000, 150)).toBe(1000);
    expect(discountForSubtotal(0, 20)).toBe(0);
    expect(discountForSubtotal(-5, 20)).toBe(0);
    expect(discountForSubtotal(1000, null)).toBe(0);
    expect(discountForSubtotal(1000, undefined)).toBe(0);
  });
});

describe("promo snapshot", () => {
  it("round-trips through JSON", () => {
    const snapshot = toPromoSnapshot({ campaignId: "c1", campaignName: "Raya", discountPercent: 20, originalSen: 14500, discountedSen: 11600, savedSen: 2900 });
    expect(readPromoSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  it("rejects malformed payloads so a bad row cannot crash completion", () => {
    expect(readPromoSnapshot(null)).toBeNull();
    expect(readPromoSnapshot("nope")).toBeNull();
    expect(readPromoSnapshot(["nope"])).toBeNull();
    expect(readPromoSnapshot({})).toBeNull();
    expect(readPromoSnapshot({ campaignId: "c1" })).toBeNull();
  });
});
