// Campaign lifecycle.
//
// Campaigns had no scheduler: a SCHEDULED campaign never became ACTIVE on its start
// date, and an ACTIVE one never ended. Whether a promo was live was decided purely by
// isPromoActive() at read time, so the calendar showed statuses that disagreed with
// what the discount engine actually did.
//
// The transition rule is a pure function so it can be tested without a database; the
// sync just applies it to rows that are out of date.
import { db } from "@/lib/db";

export type CampaignStatusValue = "DRAFT" | "SCHEDULED" | "ACTIVE" | "ENDED";

export interface LifecycleCampaign {
  status: string;
  startDate: Date;
  endDate: Date | null;
}

/**
 * The status a campaign should have at `now`.
 *
 * - DRAFT is never auto-activated — a draft is an unfinished edit, not a schedule.
 * - ENDED is terminal; re-running a campaign means editing it back to ACTIVE.
 * - SCHEDULED becomes ACTIVE on its start date, and ENDED if the window already passed.
 * - ACTIVE becomes ENDED once the end date passes.
 */
export function effectiveCampaignStatus(c: LifecycleCampaign, now: Date = new Date()): CampaignStatusValue {
  const status = c.status as CampaignStatusValue;

  if (status === "DRAFT" || status === "ENDED") return status;

  const pastEnd = c.endDate !== null && now > c.endDate;
  const beforeStart = now < c.startDate;

  if (status === "SCHEDULED") {
    if (pastEnd) return "ENDED";
    if (!beforeStart) return "ACTIVE";
    return "SCHEDULED";
  }

  // ACTIVE
  if (pastEnd) return "ENDED";
  return "ACTIVE";
}

export interface LifecycleChange {
  id: string;
  name: string;
  from: CampaignStatusValue;
  to: CampaignStatusValue;
}

/**
 * Apply the lifecycle rule to every campaign of an organisation and persist the
 * transitions. Idempotent: only rows whose status actually changed are written.
 * Intended to be called when the marketing pages load (this app runs no cron).
 */
export async function syncCampaignStatuses(orgId: string, now: Date = new Date()): Promise<LifecycleChange[]> {
  const campaigns = await db.campaign.findMany({
    where: { branch: { organisationId: orgId } },
    select: { id: true, name: true, status: true, startDate: true, endDate: true },
  });

  const changes: LifecycleChange[] = [];
  for (const c of campaigns) {
    const next = effectiveCampaignStatus(c, now);
    if (next === c.status) continue;
    changes.push({ id: c.id, name: c.name, from: c.status as CampaignStatusValue, to: next });
  }

  for (const change of changes) {
    await db.campaign.update({ where: { id: change.id }, data: { status: change.to } });
  }
  return changes;
}
