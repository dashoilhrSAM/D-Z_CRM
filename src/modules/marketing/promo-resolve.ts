// MKT-013: resolve which promotional campaign actually applies to a set of priced
// lines, then snapshot the outcome onto the booking.
//
// Until now `bestPromoQuote` existed and was unit-tested but never called from any
// route: the rider UI advertised "−20%" while the booking and the invoice charged the
// full amount. This module is the missing link.
import { db } from "@/lib/db";
import { bestPromoQuote, clampPercent, isPromoActive, type PricedLine, type PromoQuote } from "./promo";

/**
 * Fallback when the organisation row cannot be read (fresh DB, migration in flight).
 * The live value is owned by marketing via Organisation.promoAutoApply.
 */
export const AUTO_APPLY_BEST_PROMO_DEFAULT = true;

/**
 * Whether a booking is discounted by the best live promo even when the rider did not
 * arrive through a campaign link.
 *
 * Marketing controls this from the Promotion Calendar ("Auto-apply promotions").
 * On: every booking during a promo window is discounted. Off: only bookings that came
 * through a campaign link (?campaign=<id>) are discounted.
 */
export async function isPromoAutoApplyEnabled(): Promise<boolean> {
  const org = await db.organisation.findFirst({ select: { promoAutoApply: true } });
  return org?.promoAutoApply ?? AUTO_APPLY_BEST_PROMO_DEFAULT;
}

/** Load the PROMO campaigns that could apply to this branch right now. */
async function activePromosFor(branchId: string, now: Date) {
  const campaigns = await db.campaign.findMany({
    where: { branchId, type: "PROMO", status: "ACTIVE" },
    select: { id: true, name: true, type: true, status: true, startDate: true, endDate: true, discountPercent: true },
  });
  return campaigns.filter((c) => isPromoActive(c, now));
}

/**
 * Resolve the promo for a booking.
 *
 * - An explicit `campaignId` (the rider followed a campaign link) wins, provided that
 *   campaign is still an active PROMO; otherwise it is ignored rather than silently
 *   discounting by some other campaign's rate.
 * - With no explicit campaign, the best active promo applies only when the
 *   organisation's promoAutoApply setting is on.
 */
export async function resolvePromoForBooking(opts: {
  branchId: string;
  lines: PricedLine[];
  campaignId?: string | null;
  now?: Date;
  /** Override the organisation setting (used by tests and by callers that already read it). */
  autoApply?: boolean;
}): Promise<PromoQuote | null> {
  const now = opts.now ?? new Date();
  if (opts.lines.length === 0) return null;

  const autoApply = opts.autoApply ?? (await isPromoAutoApplyEnabled());

  if (opts.campaignId) {
    const campaign = await db.campaign.findUnique({
      where: { id: opts.campaignId },
      select: { id: true, name: true, type: true, status: true, branchId: true, startDate: true, endDate: true, discountPercent: true },
    });
    // Only honour it when it is genuinely live for this branch.
    if (campaign && campaign.branchId === opts.branchId && isPromoActive(campaign, now)) {
      return bestPromoQuote(opts.lines, [campaign], now);
    }
    if (!autoApply) return null;
  } else if (!autoApply) {
    return null;
  }

  const active = await activePromosFor(opts.branchId, now);
  return bestPromoQuote(opts.lines, active, now);
}

/** The persisted shape stored on Booking.promoSnapshot. */
export interface PromoSnapshot {
  campaignId: string;
  campaignName: string;
  discountPercent: number;
  originalSen: number;
  discountedSen: number;
  savedSen: number;
}

export function toPromoSnapshot(q: PromoQuote): PromoSnapshot {
  return {
    campaignId: q.campaignId,
    campaignName: q.campaignName,
    discountPercent: clampPercent(q.discountPercent) ?? q.discountPercent,
    originalSen: q.originalSen,
    discountedSen: q.discountedSen,
    savedSen: q.savedSen,
  };
}

/** Narrow the untyped Json column back to a snapshot. */
export function readPromoSnapshot(raw: unknown): PromoSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Partial<PromoSnapshot>;
  if (typeof s.campaignId !== "string" || typeof s.discountPercent !== "number") return null;
  return {
    campaignId: s.campaignId,
    campaignName: typeof s.campaignName === "string" ? s.campaignName : "",
    discountPercent: s.discountPercent,
    originalSen: typeof s.originalSen === "number" ? s.originalSen : 0,
    discountedSen: typeof s.discountedSen === "number" ? s.discountedSen : 0,
    savedSen: typeof s.savedSen === "number" ? s.savedSen : 0,
  };
}

/** MKT-017: apply a promo percent to an invoice subtotal (used at completion). */
export function discountForSubtotal(subtotalSen: number, discountPercent: number | null | undefined): number {
  const pct = clampPercent(typeof discountPercent === "number" ? discountPercent : null);
  if (!pct || subtotalSen <= 0) return 0;
  return Math.min(subtotalSen, Math.round((subtotalSen * pct) / 100));
}
