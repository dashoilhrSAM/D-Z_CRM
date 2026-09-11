// Checkout discount arithmetic. Money, so the edges matter more than the happy path.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MAX_PERCENT,
  applyDiscount,
  discountableSen,
  manualDiscountFor,
  manualDiscountLabel,
  parseDiscount,
  totalAfterManualDiscount,
  type InvoiceMoney,
} from "@/modules/finance/invoice-discount";

const bill = (subtotalSen: number, promoDiscountSen = 0, taxSen = 0): InvoiceMoney => ({ subtotalSen, promoDiscountSen, taxSen });
const percent = (value: number) => ({ kind: "PERCENT" as const, value });
const amount = (value: number) => ({ kind: "AMOUNT" as const, value });

describe("manualDiscountFor", () => {
  it("takes a percentage off the subtotal", () => {
    expect(manualDiscountFor(bill(10000), percent(10))).toBe(1000);
    expect(manualDiscountFor(bill(16500), percent(10))).toBe(1650);
  });

  it("takes a fixed amount off, given in sen", () => {
    expect(manualDiscountFor(bill(10000), amount(500))).toBe(500);
  });

  it("rounds a percentage to whole sen", () => {
    // 33% of 9999 sen is 3299.67 — money is integer sen everywhere in this project.
    expect(manualDiscountFor(bill(9999), percent(33))).toBe(3300);
  });

  it("is zero when there is no discount", () => {
    expect(manualDiscountFor(bill(10000), null)).toBe(0);
    expect(manualDiscountFor(bill(10000), undefined)).toBe(0);
  });

  /**
   * The result is what was ACTUALLY taken off, not what was asked for. A 100% discount on a
   * bill that already carries a promotion can only remove what is left, and reporting the
   * larger number would overstate what the cashier gave away.
   */
  it("never takes off more than the promotion left behind", () => {
    expect(manualDiscountFor(bill(10000, 2000), percent(100))).toBe(8000);
    expect(manualDiscountFor(bill(10000, 2000), amount(9000))).toBe(8000);
  });

  it("is zero when a promotion already covers the whole bill", () => {
    expect(manualDiscountFor(bill(10000, 10000), percent(50))).toBe(0);
    expect(manualDiscountFor(bill(10000, 12000), amount(500))).toBe(0);
  });

  it("ignores nonsense rather than producing a negative discount", () => {
    expect(manualDiscountFor(bill(10000), percent(0))).toBe(0);
    expect(manualDiscountFor(bill(10000), percent(-20))).toBe(0);
    expect(manualDiscountFor(bill(10000), amount(-500))).toBe(0);
    expect(manualDiscountFor(bill(0), percent(10))).toBe(0);
  });

  it("clamps a percentage above 100 instead of exceeding the bill", () => {
    expect(manualDiscountFor(bill(10000), percent(250))).toBe(10000);
  });

  it("applies the percentage to the subtotal, not to what is left after the promotion", () => {
    // Stated as a test because it is a choice: 10% off the bill, not 10% off the net.
    expect(manualDiscountFor(bill(10000, 5000), percent(10))).toBe(1000);
  });
});

describe("totalAfterManualDiscount", () => {
  it("subtracts the discount and adds tax", () => {
    expect(totalAfterManualDiscount(bill(10000, 0, 600), 1000)).toBe(9600);
  });

  it("stacks with the promotional discount rather than replacing it", () => {
    expect(totalAfterManualDiscount(bill(10000, 2000, 0), 1000)).toBe(7000);
  });

  it("never goes below zero, or below tax", () => {
    expect(totalAfterManualDiscount(bill(10000), 99999)).toBe(0);
    expect(totalAfterManualDiscount(bill(10000, 0, 600), 99999)).toBe(600);
  });
});

describe("applyDiscount", () => {
  it("derives both numbers in one pass, consistently", () => {
    expect(applyDiscount(bill(16500, 0, 0), percent(10))).toEqual({ manualDiscountSen: 1650, totalSen: 14850 });
  });

  it("round-trips: the lines minus both discounts plus tax is the total", () => {
    const b = bill(16500, 1500, 300);
    const { manualDiscountSen, totalSen } = applyDiscount(b, amount(2000));
    expect(16500 - 1500 - manualDiscountSen + 300).toBe(totalSen);
  });
});

describe("discountableSen", () => {
  it("is what is left after the promotion", () => {
    expect(discountableSen(bill(10000, 3000))).toBe(7000);
    expect(discountableSen(bill(10000, 12000))).toBe(0);
  });
});

describe("parseDiscount", () => {
  it("accepts a sensible percentage", () => {
    expect(parseDiscount("PERCENT", 10)).toEqual({ ok: true, request: { kind: "PERCENT", value: 10 } });
    expect(parseDiscount("PERCENT", MAX_PERCENT).ok).toBe(true);
  });

  it("accepts an amount and converts it to whole sen", () => {
    expect(parseDiscount("AMOUNT", 500)).toEqual({ ok: true, request: { kind: "AMOUNT", value: 500 } });
    expect(parseDiscount("AMOUNT", 500.4)).toEqual({ ok: true, request: { kind: "AMOUNT", value: 500 } });
  });

  /**
   * A server action is a public endpoint. The form that normally calls it is not a guarantee
   * of anything, so the values are checked here rather than trusted.
   */
  it("rejects what the form would not send", () => {
    expect(parseDiscount("FREE", 10).ok).toBe(false);
    expect(parseDiscount("PERCENT", 0).ok).toBe(false);
    expect(parseDiscount("PERCENT", 101).ok).toBe(false);
    expect(parseDiscount("PERCENT", -5).ok).toBe(false);
    expect(parseDiscount("PERCENT", "abc").ok).toBe(false);
    expect(parseDiscount("PERCENT", NaN).ok).toBe(false);
    expect(parseDiscount("PERCENT", Infinity).ok).toBe(false);
    expect(parseDiscount("AMOUNT", 0).ok).toBe(false);
    expect(parseDiscount("AMOUNT", -100).ok).toBe(false);
  });
});

describe("manualDiscountLabel", () => {
  it("reads as a percentage or as money", () => {
    expect(manualDiscountLabel("PERCENT", 10)).toBe("10%");
    expect(manualDiscountLabel("AMOUNT", 500)).toBe("RM5");
    expect(manualDiscountLabel(null, null)).toBe("");
    expect(manualDiscountLabel("PERCENT", null)).toBe("");
  });
});

describe("one definition of the arithmetic", () => {
  /**
   * If the action ever computed the total itself, the stored number and the previewed number
   * would be free to drift — and the one the cashier reads is the one they quote to a customer.
   */
  it("the server action derives the total from the shared function", () => {
    const src = readFileSync(path.join(process.cwd(), "src/actions/invoices.ts"), "utf8");
    expect(src).toContain("applyDiscount(bill, request)");
  });

  it("the checkout panel previews with the same function", () => {
    const src = readFileSync(path.join(process.cwd(), "src/components/workshop/invoice-payment-panel.tsx"), "utf8");
    expect(src).toContain("applyDiscount(bill, draftRequest)");
  });
});
