// Checkout discounts: how much comes off a bill, and what the bill becomes.
//
// WHY THIS IS SEPARATE FROM discountSen
// -------------------------------------
// Invoice.discountSen already exists and is NOT a general-purpose discount field. completion.ts
// writes the promotional discount into it from the booking snapshot, and marketing reads it
// back as the campaign discount cost (modules/marketing/performance.ts) to compute ROI. A
// cashier's goodwill discount written there would silently inflate what a campaign appears to
// have cost. So a manual discount is its own number, and the two are shown separately.
//
// ONE DEFINITION OF THE ARITHMETIC
// --------------------------------
// The amount is derived here and nowhere else. The server action writes what this returns and
// the UI previews what this returns, so the two cannot disagree.

import { formatRM } from "@/lib/money";

export type DiscountKind = "PERCENT" | "AMOUNT";

export interface DiscountRequest {
  kind: DiscountKind;
  /** PERCENT: the number typed, so 10 means 10%. AMOUNT: an amount in sen. */
  value: number;
}

/** The money already on the invoice before any manual discount. */
export interface InvoiceMoney {
  subtotalSen: number;
  /** The promotional discount. Read by this module, never written by it. */
  promoDiscountSen: number;
  taxSen: number;
}

export const MAX_PERCENT = 100;

export function isDiscountKind(v: unknown): v is DiscountKind {
  return v === "PERCENT" || v === "AMOUNT";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** What is left to discount once the promotional discount has been taken. */
export function discountableSen(bill: InvoiceMoney): number {
  return Math.max(0, bill.subtotalSen - bill.promoDiscountSen);
}

/**
 * How much a manual discount actually takes off the bill.
 *
 * Capped at what is left after the promotional discount, so this is the amount really removed
 * rather than the amount requested. A 100% discount on a bill that already carries a 10%
 * promotion therefore reports 90% of the subtotal, not the whole subtotal — which is the number
 * that belongs in a report about what the cashier gave away.
 */
export function manualDiscountFor(bill: InvoiceMoney, request: DiscountRequest | null | undefined): number {
  if (!request) return 0;
  const ceiling = discountableSen(bill);
  if (ceiling <= 0) return 0;

  if (request.kind === "PERCENT") {
    const pct = clamp(request.value, 0, MAX_PERCENT);
    return clamp(Math.round((bill.subtotalSen * pct) / 100), 0, ceiling);
  }
  // AMOUNT arrives in sen. Rounded because money is stored as integer sen throughout the
  // project, and a fractional value here would be a bug upstream rather than a nicety.
  return clamp(Math.round(request.value), 0, ceiling);
}

/** The invoice total once the manual discount is applied. Never negative. */
export function totalAfterManualDiscount(bill: InvoiceMoney, manualDiscountSen: number): number {
  const net = bill.subtotalSen - bill.promoDiscountSen - Math.max(0, manualDiscountSen);
  return Math.max(0, net) + bill.taxSen;
}

/** Everything the caller needs, derived in one pass. */
export function applyDiscount(bill: InvoiceMoney, request: DiscountRequest | null | undefined) {
  const manualDiscountSen = manualDiscountFor(bill, request);
  return { manualDiscountSen, totalSen: totalAfterManualDiscount(bill, manualDiscountSen) };
}

/**
 * How a stored discount reads back: "10%" or "RM5.00".
 *
 * Defined once because three surfaces show it — the payment panel, the invoice list and the
 * printed invoice — and a discount that reads differently depending on where you look is a
 * discount nobody trusts.
 */
export function manualDiscountLabel(kind: string | null | undefined, value: number | null | undefined): string {
  if (value == null) return "";
  return kind === "PERCENT" ? value + "%" : formatRM(value);
}

/**
 * Validate what arrived from the browser. A server action is a public endpoint; the form that
 * normally calls it is not a guarantee of anything.
 */
export function parseDiscount(kind: unknown, value: unknown): { ok: true; request: DiscountRequest } | { ok: false; error: string } {
  if (!isDiscountKind(kind)) return { ok: false, error: "Discount type must be a percentage or an amount." };
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return { ok: false, error: "Discount value must be a number." };

  if (kind === "PERCENT") {
    if (n <= 0 || n > MAX_PERCENT) return { ok: false, error: "Percentage must be above 0 and at most 100." };
    return { ok: true, request: { kind, value: n } };
  }
  const sen = Math.round(n);
  if (sen <= 0) return { ok: false, error: "Discount amount must be more than zero." };
  return { ok: true, request: { kind, value: sen } };
}
