// The promo promise: what the customer is quoted is what the customer is charged.
//
// The bug this pins down: the discount used to be re-derived as "percent × the finished invoice",
// so a customer quoted RM24 off was charged more discount than promised (the counter's later
// work got discounted too), and a customer who never picked a package at booking time got no
// discount at all however live the promotion was.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promoDiscountForBill, rescalePromoSnapshot, type PromoSnapshot } from "@/modules/marketing/promo-resolve";

const snapshot = (over: Partial<PromoSnapshot> = {}): PromoSnapshot => ({
  campaignId: "c1",
  campaignName: "Hari Merdeka Promo",
  discountPercent: 20,
  originalSen: 12000,
  discountedSen: 9600,
  savedSen: 2400,
  ...over,
});

describe("promoDiscountForBill", () => {
  it("takes exactly the promised amount off the bill", () => {
    // Quoted RM120 at −20% → RM24 promised. The bill grew to RM165 (oil filter + chain work).
    expect(promoDiscountForBill(snapshot(), 16500)).toBe(2400);
  });

  it("is not a percentage of the finished bill", () => {
    expect(promoDiscountForBill(snapshot(), 16500)).not.toBe(Math.round(16500 * 0.2));
  });

  it("never takes off more than the bill itself", () => {
    expect(promoDiscountForBill(snapshot(), 1000)).toBe(1000);
    expect(promoDiscountForBill(snapshot({ savedSen: 5000 }), 0)).toBe(0);
  });

  it("is zero when nothing was promised", () => {
    expect(promoDiscountForBill(null, 16500)).toBe(0);
    expect(promoDiscountForBill(undefined, 16500)).toBe(0);
  });

  it("ignores a nonsensical bill instead of inventing a discount", () => {
    expect(promoDiscountForBill(snapshot(), -500)).toBe(0);
  });
});

describe("rescalePromoSnapshot", () => {
  it("keeps the promised percent and campaign, and follows the new quote", () => {
    expect(rescalePromoSnapshot(snapshot(), [{ description: "Basic Service", priceSen: 8000 }])).toEqual({
      campaignId: "c1",
      campaignName: "Hari Merdeka Promo",
      discountPercent: 20,
      originalSen: 8000,
      discountedSen: 6400,
      savedSen: 1600,
    });
  });

  it("rounds to whole sen", () => {
    // 33% of RM99.99 — money is integer sen everywhere in this project.
    expect(rescalePromoSnapshot(snapshot({ discountPercent: 33 }), [{ description: "x", priceSen: 9999 }]).savedSen).toBe(3300);
  });

  it("survives a quote that shrank to nothing", () => {
    const next = rescalePromoSnapshot(snapshot(), []);
    expect(next.originalSen).toBe(0);
    expect(next.savedSen).toBe(0);
  });
});

describe("the wiring", () => {
  it("the quotation makes the promise", () => {
    const src = readFileSync(path.join(process.cwd(), "src/modules/quotations/service.ts"), "utf8");
    expect(src, "the quote is where a package-less booking first sees money").toContain("promisePromoOnQuote");
  });

  it("completion charges the promise, not a percentage of the bill", () => {
    const src = readFileSync(path.join(process.cwd(), "src/services/completion.ts"), "utf8");
    expect(src).toContain("promoDiscountForBill(promo, subtotal)");
    expect(src, "the invoice must not re-derive the percent from the finished bill").not.toContain("discountForSubtotal(subtotal");
  });
});
