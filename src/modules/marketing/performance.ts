// Campaign performance (MKT-015/016/017): what a campaign actually produced.
//
// Lead attribution comes from Lead.campaignId, booking attribution from
// Booking.campaignId, and revenue from the invoice on the job that booking became.
// The pure `computePerformance` half is separated from the queries so it can be
// unit-tested without a database.
import { db } from "@/lib/db";

export interface CampaignPerformance {
  campaignId: string;
  /** Customers matching the campaign's audience right now. */
  audience: number;
  messages: { sent: number; delivered: number; failed: number };
  /** MKT-015 */
  leads: number;
  /** MKT-016 */
  bookings: number;
  /** MKT-017: invoiced revenue attributed to this campaign, in sen. */
  revenueSen: number;
  /** Promotional discount given on attributed bookings, in sen. */
  discountCostSen: number;
  /** bookings / audience, as a percentage. Null when the audience is empty. */
  conversionPct: number | null;
  /** revenue / discount given. Null when no discount was given — not "infinite". */
  roiOnDiscount: number | null;
}

export interface PerformanceInput {
  audience: number;
  messages: { status: string }[];
  leadCount: number;
  attributedBookings: { revenueSen: number; discountSen: number }[];
}

/** MKT-015/016/017: derive performance figures from raw rows. Pure. */
export function computePerformance(campaignId: string, input: PerformanceInput): CampaignPerformance {
  const messages = { sent: 0, delivered: 0, failed: 0 };
  for (const m of input.messages) {
    // every stored row is an attempt, so each counts toward `sent`;
    // delivered/failed are the outcome breakdown
    messages.sent += 1;
    if (m.status === "FAILED") messages.failed += 1;
    else if (m.status === "DELIVERED" || m.status === "READ") messages.delivered += 1;
  }

  const bookings = input.attributedBookings.length;
  const revenueSen = input.attributedBookings.reduce((s, b) => s + b.revenueSen, 0);
  const discountCostSen = input.attributedBookings.reduce((s, b) => s + b.discountSen, 0);

  return {
    campaignId,
    audience: input.audience,
    messages,
    leads: input.leadCount,
    bookings,
    revenueSen,
    discountCostSen,
    conversionPct: input.audience > 0 ? Math.round((bookings / input.audience) * 1000) / 10 : null,
    roiOnDiscount: discountCostSen > 0 ? Math.round((revenueSen / discountCostSen) * 100) / 100 : null,
  };
}

/** Load performance for a set of campaigns. */
export async function loadCampaignPerformance(campaignIds: string[]): Promise<Map<string, CampaignPerformance>> {
  const out = new Map<string, CampaignPerformance>();
  if (campaignIds.length === 0) return out;

  const [leadsByCampaign, bookings, msgs] = await Promise.all([
    db.lead.groupBy({ by: ["campaignId"], where: { campaignId: { in: campaignIds } }, _count: true }),
    db.booking.findMany({
      where: { campaignId: { in: campaignIds } },
      select: {
        campaignId: true,
        promoDiscountSen: true,
        job: { select: { invoice: { select: { totalSen: true, discountSen: true } } } },
      },
    }),
    db.message.groupBy({
      by: ["referenceId", "status"],
      where: { referenceType: "CAMPAIGN", referenceId: { in: campaignIds } },
      _count: true,
    }),
  ]);

  const leadCounts = new Map<string, number>();
  for (const l of leadsByCampaign) if (l.campaignId) leadCounts.set(l.campaignId, l._count);

  const bookingRows = new Map<string, { revenueSen: number; discountSen: number }[]>();
  for (const b of bookings) {
    if (!b.campaignId) continue;
    const list = bookingRows.get(b.campaignId) ?? [];
    list.push({
      revenueSen: b.job?.invoice?.totalSen ?? 0,
      // prefer the invoice's recorded discount; fall back to the booking snapshot
      discountSen: b.job?.invoice?.discountSen ?? b.promoDiscountSen ?? 0,
    });
    bookingRows.set(b.campaignId, list);
  }

  const msgRows = new Map<string, { status: string }[]>();
  for (const m of msgs) {
    if (!m.referenceId) continue;
    const list = msgRows.get(m.referenceId) ?? [];
    for (let i = 0; i < m._count; i++) list.push({ status: m.status });
    msgRows.set(m.referenceId, list);
  }

  for (const id of campaignIds) {
    out.set(id, computePerformance(id, {
      // audience size is filled in by the caller (it needs the audience engine)
      audience: 0,
      messages: msgRows.get(id) ?? [],
      leadCount: leadCounts.get(id) ?? 0,
      attributedBookings: bookingRows.get(id) ?? [],
    }));
  }
  return out;
}
