// Marketing audience engine (MKT-005..012).
//
// Turns a declarative rule set into a Prisma CustomerWhereInput so segment
// resolution happens in the database instead of shipping every customer into
// memory. Pure and deterministic — unit-testable without a database.
//
// Replaces the ad-hoc `audienceCustomers()` helper that used to live inside
// src/actions/marketing.ts (and the separate `listPosterTargets` in
// src/actions/posters.ts). Both now share this resolver.
import type { Prisma } from "@prisma/client";

export interface AudienceRules {
  /** MKT-006: customer tags. AND semantics — a customer must carry every tag. */
  tags?: string[];
  /** MKT-007: restrict to these branch ids (org-level campaigns spanning branches). */
  branches?: string[];
  /** MKT-008: must (true) / must not (false) own a motorcycle. */
  motorcycleOwned?: boolean;
  /** MKT-008: brand or model keyword match. OR semantics — any one matches. */
  models?: string[];
  /** MKT-009: serviced within the last N days (a COMPLETED job in the window). */
  lastServiceWithinDays?: number;
  /** MKT-009/MKT-010: has service history but nothing in the last N days (dormant). */
  inactiveForDays?: number;
  /** MKT-010: signed up within the last N days. */
  joinedWithinDays?: number;
  /** MKT-011: loyalty tier names. */
  tiers?: string[];
  /** MKT-009: has an open DUE/OVERDUE service reminder. */
  overdueService?: boolean;
  /**
   * MKT-012: when true, only customers whose consent record has marketingOptIn=true
   * are returned.
   *
   * Deliberately defaults to OFF. The project's current delivery guard
   * (messagingModule.canSendMarketing) is a soft opt-out model: a customer with NO
   * consent record is allowed, and only an explicit marketingOptIn=false blocks.
   * Turning this on makes the segment strict opt-in and will shrink reach, so it is
   * a per-campaign business/compliance decision rather than a silent default change.
   */
  requireMarketingConsent?: boolean;
}

/** Reminder statuses that mean "service is due or overdue". */
const OVERDUE_REMINDER_STATUSES = ["DUE", "OVERDUE"] as const;

function cutoffFrom(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/**
 * A COMPLETED job inside the window. `completedAt` is nullable on completed jobs
 * (older rows fall back to createdAt), so both are checked.
 */
function servicedAfter(cutoff: Date): Prisma.ServiceJobWhereInput {
  return {
    status: "COMPLETED",
    OR: [
      { completedAt: { gte: cutoff } },
      { completedAt: null, createdAt: { gte: cutoff } },
    ],
  };
}

function positiveDays(v: number | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return Math.floor(v);
}

/**
 * Build an org-scoped Prisma where clause for the given rules.
 * `orgId` is required so a segment can never leak across organisations.
 */
export function buildAudienceWhere(
  orgId: string,
  rules: AudienceRules = {},
  now: Date = new Date(),
): Prisma.CustomerWhereInput {
  const and: Prisma.CustomerWhereInput[] = [{ organisationId: orgId }];

  const tags = (rules.tags ?? []).map((t) => t.trim()).filter(Boolean);
  for (const tag of tags) and.push({ tags: { contains: tag } });

  const branches = (rules.branches ?? []).filter(Boolean);
  if (branches.length > 0) and.push({ branchId: { in: branches } });

  if (rules.motorcycleOwned === true) and.push({ motorcycles: { some: {} } });
  if (rules.motorcycleOwned === false) and.push({ motorcycles: { none: {} } });

  const models = (rules.models ?? []).map((m) => m.trim()).filter(Boolean);
  if (models.length > 0) {
    and.push({
      motorcycles: {
        some: { OR: models.flatMap((m) => [{ brand: { contains: m } }, { model: { contains: m } }]) },
      },
    });
  }

  const lastServiceDays = positiveDays(rules.lastServiceWithinDays);
  if (lastServiceDays !== null) {
    and.push({ jobs: { some: servicedAfter(cutoffFrom(now, lastServiceDays)) } });
  }

  const inactiveDays = positiveDays(rules.inactiveForDays);
  if (inactiveDays !== null) {
    // dormant = has serviced at some point, but not within the window
    and.push({ jobs: { some: { status: "COMPLETED" } } });
    and.push({ jobs: { none: servicedAfter(cutoffFrom(now, inactiveDays)) } });
  }

  const joinedDays = positiveDays(rules.joinedWithinDays);
  if (joinedDays !== null) {
    and.push({ joinedAt: { gte: cutoffFrom(now, joinedDays) } });
  }

  const tiers = (rules.tiers ?? []).map((t) => t.trim()).filter(Boolean);
  if (tiers.length > 0) {
    and.push({ loyaltyAccount: { is: { tier: { is: { name: { in: tiers } } } } } });
  }

  if (rules.overdueService) {
    and.push({ reminders: { some: { status: { in: [...OVERDUE_REMINDER_STATUSES] }, closedAt: null } } });
  }

  if (rules.requireMarketingConsent) {
    and.push({ consent: { is: { marketingOptIn: true } } });
  }

  return and.length === 1 ? and[0] : { AND: and };
}

/**
 * Legacy `Campaign.audience` string codes → rules, so existing campaigns keep
 * working while new ones use the richer rule set.
 *
 * Note: the previous implementation mapped BOTH "30_DAYS" and "60_DAYS" to the
 * same reminder-status list, so the two options returned an identical audience.
 * They now mean what they say.
 */
export function rulesFromLegacyAudience(audience: string | null | undefined): AudienceRules {
  switch (audience) {
    case "NEW": return { joinedWithinDays: 30 };
    case "30_DAYS": return { lastServiceWithinDays: 30 };
    case "60_DAYS": return { lastServiceWithinDays: 60 };
    case "OVERDUE": return { overdueService: true };
    case "ALL":
    case null:
    case undefined:
    case "":
      return {};
    default:
      // Unknown code (including the newer rule codes) — treat as "everyone" rather
      // than silently returning an empty audience.
      return {};
  }
}

/** Resolve a campaign's targeting: explicit rules win, else the legacy string code. */
export function rulesForCampaign(campaign: { audience?: string | null; audienceRules?: unknown }): AudienceRules {
  const raw = campaign.audienceRules;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as AudienceRules;
  }
  return rulesFromLegacyAudience(campaign.audience);
}
