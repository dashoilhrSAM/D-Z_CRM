// MKT-015/016/017: campaign performance aggregation.
import { describe, it, expect } from "vitest";
import { computePerformance } from "@/modules/marketing/performance";

const empty = { audience: 0, messages: [], leadCount: 0, attributedBookings: [] };

describe("computePerformance", () => {
  it("breaks delivery outcomes down by status", () => {
    const p = computePerformance("c1", {
      ...empty, audience: 100,
      messages: [{ status: "SENT" }, { status: "DELIVERED" }, { status: "DELIVERED" }, { status: "READ" }, { status: "FAILED" }],
    });
    expect(p.messages.sent).toBe(5); // every stored row is an attempt
    expect(p.messages.delivered).toBe(3); // DELIVERED + READ
    expect(p.messages.failed).toBe(1);
  });

  it("sums attributed revenue and leads (MKT-015/016/017)", () => {
    const p = computePerformance("c1", {
      ...empty, audience: 50, leadCount: 7,
      attributedBookings: [{ revenueSen: 12000, discountSen: 3000 }, { revenueSen: 8000, discountSen: 2000 }],
    });
    expect(p.leads).toBe(7);
    expect(p.bookings).toBe(2);
    expect(p.revenueSen).toBe(20000);
    expect(p.discountCostSen).toBe(5000);
  });

  it("computes conversion against the real audience size", () => {
    const p = computePerformance("c1", { ...empty, audience: 40, attributedBookings: [{ revenueSen: 0, discountSen: 0 }] });
    expect(p.conversionPct).toBe(2.5);
  });

  it("returns null conversion for an empty audience instead of dividing by zero", () => {
    const p = computePerformance("c1", { ...empty, audience: 0, attributedBookings: [{ revenueSen: 100, discountSen: 0 }] });
    expect(p.conversionPct).toBeNull();
  });

  it("returns null ROI when no discount was given, rather than infinity", () => {
    const p = computePerformance("c1", { ...empty, audience: 10, attributedBookings: [{ revenueSen: 5000, discountSen: 0 }] });
    expect(p.roiOnDiscount).toBeNull();
  });

  it("expresses ROI as revenue generated per ringgit of discount", () => {
    const p = computePerformance("c1", { ...empty, audience: 10, attributedBookings: [{ revenueSen: 45000, discountSen: 5000 }] });
    expect(p.roiOnDiscount).toBe(9);
  });

  it("handles a campaign with no activity at all", () => {
    const p = computePerformance("c1", empty);
    expect(p).toMatchObject({ audience: 0, leads: 0, bookings: 0, revenueSen: 0, conversionPct: null, roiOnDiscount: null });
    expect(p.messages).toEqual({ sent: 0, delivered: 0, failed: 0 });
  });

  it("does not mutate its input", () => {
    const input = { audience: 5, messages: [{ status: "FAILED" }], leadCount: 1, attributedBookings: [{ revenueSen: 100, discountSen: 10 }] };
    const snapshot = JSON.parse(JSON.stringify(input));
    computePerformance("c1", input);
    expect(input).toEqual(snapshot);
  });
});
