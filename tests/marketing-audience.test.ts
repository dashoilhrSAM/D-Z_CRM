// Marketing audience engine (MKT-005..012).
// Pure rule -> Prisma where translation, so it is fully testable without a database.
// Also guards the legacy audience codes, including the old bug where "30_DAYS" and
// "60_DAYS" resolved to the exact same audience.
import { describe, it, expect } from "vitest";
import { buildAudienceWhere, rulesFromLegacyAudience, rulesForCampaign } from "@/modules/marketing/audience";

const now = new Date("2026-09-10T00:00:00Z");
const ORG = "org1";

/** The AND-array form is what multi-rule queries produce. */
function andClauses(where: Record<string, unknown>): Record<string, unknown>[] {
  return (where.AND as Record<string, unknown>[]) ?? [where];
}

describe("buildAudienceWhere", () => {
  it("always scopes to the organisation", () => {
    expect(buildAudienceWhere(ORG, {}, now)).toEqual({ organisationId: ORG });
    const clauses = andClauses(buildAudienceWhere(ORG, { tags: ["vip"] }, now));
    expect(clauses[0]).toEqual({ organisationId: ORG });
  });

  it("applies tags with AND semantics (customer must carry every tag)", () => {
    const clauses = andClauses(buildAudienceWhere(ORG, { tags: ["vip", "fleet"] }, now));
    expect(clauses).toContainEqual({ tags: { contains: "vip" } });
    expect(clauses).toContainEqual({ tags: { contains: "fleet" } });
  });

  it("filters by branch (MKT-007)", () => {
    const clauses = andClauses(buildAudienceWhere(ORG, { branches: ["b1", "b2"] }, now));
    expect(clauses).toContainEqual({ branchId: { in: ["b1", "b2"] } });
  });

  it("handles motorcycle ownership both ways (MKT-008)", () => {
    expect(andClauses(buildAudienceWhere(ORG, { motorcycleOwned: true }, now))).toContainEqual({ motorcycles: { some: {} } });
    expect(andClauses(buildAudienceWhere(ORG, { motorcycleOwned: false }, now))).toContainEqual({ motorcycles: { none: {} } });
  });

  it("matches brand or model keywords with OR semantics (MKT-008)", () => {
    const clauses = andClauses(buildAudienceWhere(ORG, { models: ["Yamaha"] }, now));
    expect(clauses).toContainEqual({
      motorcycles: { some: { OR: [{ brand: { contains: "Yamaha" } }, { model: { contains: "Yamaha" } }] } },
    });
  });

  it("uses a real day window for recent service (MKT-009)", () => {
    const clauses = andClauses(buildAudienceWhere(ORG, { lastServiceWithinDays: 30 }, now));
    const cutoff = new Date(now.getTime() - 30 * 86400000);
    expect(clauses).toContainEqual({
      jobs: { some: { status: "COMPLETED", OR: [{ completedAt: { gte: cutoff } }, { completedAt: null, createdAt: { gte: cutoff } }] } },
    });
  });

  it("requires service history but nothing recent for dormant customers (MKT-010)", () => {
    const clauses = andClauses(buildAudienceWhere(ORG, { inactiveForDays: 90 }, now));
    const cutoff = new Date(now.getTime() - 90 * 86400000);
    expect(clauses).toContainEqual({ jobs: { some: { status: "COMPLETED" } } });
    expect(clauses).toContainEqual({
      jobs: { none: { status: "COMPLETED", OR: [{ completedAt: { gte: cutoff } }, { completedAt: null, createdAt: { gte: cutoff } }] } },
    });
  });

  it("filters new customers by join date (MKT-010)", () => {
    const clauses = andClauses(buildAudienceWhere(ORG, { joinedWithinDays: 30 }, now));
    expect(clauses).toContainEqual({ joinedAt: { gte: new Date(now.getTime() - 30 * 86400000) } });
  });

  it("filters by loyalty tier (MKT-011)", () => {
    const clauses = andClauses(buildAudienceWhere(ORG, { tiers: ["Gold"] }, now));
    expect(clauses).toContainEqual({ loyaltyAccount: { is: { tier: { is: { name: { in: ["Gold"] } } } } } });
  });

  it("selects customers with an open due/overdue reminder (MKT-009)", () => {
    const clauses = andClauses(buildAudienceWhere(ORG, { overdueService: true }, now));
    expect(clauses).toContainEqual({ reminders: { some: { status: { in: ["DUE", "OVERDUE"] }, closedAt: null } } });
  });

  it("only constrains consent when explicitly requested (MKT-012)", () => {
    const withConsent = andClauses(buildAudienceWhere(ORG, { requireMarketingConsent: true }, now));
    const without = andClauses(buildAudienceWhere(ORG, {}, now));
    expect(withConsent).toContainEqual({ consent: { is: { marketingOptIn: true } } });
    expect(without.some((c) => "consent" in c)).toBe(false);
  });

  it("ignores non-positive / non-finite day windows instead of emitting a bad cutoff", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const clauses = andClauses(buildAudienceWhere(ORG, { lastServiceWithinDays: bad, inactiveForDays: bad, joinedWithinDays: bad }, now));
      expect(clauses).toEqual([{ organisationId: ORG }]);
    }
  });

  it("trims and drops blank rules", () => {
    expect(andClauses(buildAudienceWhere(ORG, { tags: ["  ", ""], branches: [], models: ["  "] }, now))).toEqual([{ organisationId: ORG }]);
  });
});

describe("rulesFromLegacyAudience", () => {
  it("maps the legacy codes", () => {
    expect(rulesFromLegacyAudience("ALL")).toEqual({});
    expect(rulesFromLegacyAudience(null)).toEqual({});
    expect(rulesFromLegacyAudience(undefined)).toEqual({});
    expect(rulesFromLegacyAudience("NEW")).toEqual({ joinedWithinDays: 30 });
    expect(rulesFromLegacyAudience("30_DAYS")).toEqual({ lastServiceWithinDays: 30 });
    expect(rulesFromLegacyAudience("60_DAYS")).toEqual({ lastServiceWithinDays: 60 });
    expect(rulesFromLegacyAudience("OVERDUE")).toEqual({ overdueService: true });
  });

  it("REGRESSION: 30_DAYS and 60_DAYS are no longer the same audience", () => {
    // The old audienceCustomers() sent both codes down the identical reminder-status
    // branch, so "active last 30 days" and "active last 60 days" matched the same set.
    const a = andClauses(buildAudienceWhere(ORG, rulesFromLegacyAudience("30_DAYS"), now));
    const b = andClauses(buildAudienceWhere(ORG, rulesFromLegacyAudience("60_DAYS"), now));
    expect(a).not.toEqual(b);
  });

  it("treats an unknown code as everyone rather than nobody", () => {
    expect(rulesFromLegacyAudience("SOMETHING_NEW")).toEqual({});
  });
});

describe("rulesForCampaign", () => {
  it("prefers explicit audienceRules over the legacy string", () => {
    expect(rulesForCampaign({ audience: "ALL", audienceRules: { tags: ["vip"] } })).toEqual({ tags: ["vip"] });
  });

  it("falls back to the legacy code when no rules are stored", () => {
    expect(rulesForCampaign({ audience: "OVERDUE", audienceRules: null })).toEqual({ overdueService: true });
  });

  it("ignores malformed audienceRules payloads", () => {
    expect(rulesForCampaign({ audience: "NEW", audienceRules: ["nope"] })).toEqual({ joinedWithinDays: 30 });
    expect(rulesForCampaign({ audience: "NEW", audienceRules: "nope" })).toEqual({ joinedWithinDays: 30 });
  });
});
