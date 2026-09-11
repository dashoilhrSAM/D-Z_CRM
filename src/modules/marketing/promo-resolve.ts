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

/** MKT-017: apply a promo percent to a subtotal (the quote base). */
export function discountForSubtotal(subtotalSen: number, discountPercent: number | null | undefined): number {
  const pct = clampPercent(typeof discountPercent === "number" ? discountPercent : null);
  if (!pct || subtotalSen <= 0) return 0;
  return Math.min(subtotalSen, Math.round((subtotalSen * pct) / 100));
}

/**
 * Re-base a promise onto the lines that are actually being quoted.
 *
 * Used when the counter changes what the customer is quoted (swapping the package at check-in):
 * the *percent* was already promised, so it is not re-decided — a campaign that has since ended
 * still stands — but the base it applies to follows the new quote.
 */
export function rescalePromoSnapshot(snapshot: PromoSnapshot, lines: PricedLine[]): PromoSnapshot {
  const originalSen = sumLines(lines);
  const savedSen = discountForSubtotal(originalSen, snapshot.discountPercent);
  return { ...snapshot, originalSen, discountedSen: originalSen - savedSen, savedSen };
}

/**
 * What comes off the bill at completion: **the amount promised, never more than the bill**.
 *
 * Deliberately not "percent × invoice subtotal": the percent was promised on the lines that were
 * quoted, and anything added after that quote (an approved repair, a part fitted later) was never
 * quoted at a discount. Re-deriving the percentage from the finished bill hands the campaign's
 * budget to work nobody promised a discount on — and makes the invoice disagree with the quote.
 */
export function promoDiscountForBill(snapshot: PromoSnapshot | null | undefined, subtotalSen: number): number {
  if (!snapshot) return 0;
  return Math.max(0, Math.min(snapshot.savedSen, Math.max(0, subtotalSen)));
}

function sumLines(lines: PricedLine[]): number {
  return lines.reduce((s, l) => s + Math.max(0, l.priceSen), 0);
}

/**
 * Make the promo promise at the moment a customer is first quoted real money.
 *
 * A booking that arrived with a package is quoted at booking time and already carries a snapshot.
 * One that did not — the rider skipped the optional package, or the job is a repair — used to end
 * up with no snapshot at all and therefore no discount, however live the promotion was. The
 * quotation is where those lines turn into money, so that is where the promise is now made.
 *
 * Returns the snapshot now in force, or null when nothing was promised (no booking, or nothing
 * to discount).
 */
export async function promisePromoOnQuote(input: { jobId: string; branchId: string; lines: PricedLine[] }): Promise<PromoSnapshot | null> {
  if (input.lines.length === 0) return null;
  const booking = await db.booking.findFirst({
    where: { jobId: input.jobId },
    select: { id: true, campaignId: true, promoSnapshot: true },
  });
  if (!booking) return null; // a counter walk-in has no booking — nothing was promised to anyone

  const current = readPromoSnapshot(booking.promoSnapshot);
  if (current) {
    if (sumLines(input.lines) === current.originalSen) return current; // same quote → the promise stands
    const next = rescalePromoSnapshot(current, input.lines);
    await db.booking.update({ where: { id: booking.id }, data: { promoSnapshot: next as never, promoDiscountSen: next.savedSen } });
    return next;
  }

  const quote = await resolvePromoForBooking({ branchId: input.branchId, lines: input.lines, campaignId: booking.campaignId });
  if (!quote) return null;
  const snapshot = toPromoSnapshot(quote);
  await db.booking.update({ where: { id: booking.id }, data: { promoSnapshot: snapshot as never, promoDiscountSen: snapshot.savedSen } });
  return snapshot;
}
