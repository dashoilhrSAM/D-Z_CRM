// The number a rider is told to pay when the bike is ready. It must equal the invoice.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { completionMessage } from "@/modules/messaging/completion-message";

describe("completionMessage", () => {
  it("quotes the invoice total", () => {
    expect(completionMessage({ customerName: "Ahmad Danial", totalSen: 16500 })).toBe(
      "Hi Ahmad, motosikal awak dah siap! Total RM165. Terima kasih — D&Z Smart Workshop.",
    );
  });

  it("quotes the discounted total, not the list price, and says why", () => {
    // 10% off RM165 — the old body quoted the RM165 subtotal, so this string is exactly what
    // was missing before the fix.
    const body = completionMessage({ customerName: "Ahmad Danial", totalSen: 14850, discountSen: 1650 });
    expect(body).toContain("Total RM148.50");
    expect(body).toContain("(diskaun RM16.50)");
    expect(body).not.toContain("Total RM165");
  });

  it("keeps the cents when the total has them", () => {
    expect(completionMessage({ customerName: "Siti Nurhaliza", totalSen: 9999 })).toContain("Total RM99.99");
  });

  it("drops the discount clause when nothing was discounted", () => {
    expect(completionMessage({ customerName: "Ahmad Danial", totalSen: 16500, discountSen: 0 })).not.toContain("diskaun");
    expect(completionMessage({ customerName: "Ahmad Danial", totalSen: 16500 })).not.toContain("diskaun");
  });

  it("greets with the first name only", () => {
    expect(completionMessage({ customerName: "Muhammad bin Zain", totalSen: 100 })).toContain("Hi Muhammad,");
  });

  it("is what the completion workflow actually sends", () => {
    // Source guard: the wiring is the part a unit test cannot see, and the bug lived in the
    // wiring. Fails on the old inline subtotal body.
    const src = readFileSync(path.join(process.cwd(), "src/services/completion.ts"), "utf8");
    expect(src).toContain("completionMessage({ customerName: job.customer.name, totalSen, discountSen })");
    expect(src, "the completion message must not be built from the subtotal again").not.toContain(
      "(subtotal / 100).toLocaleString()",
    );
  });
});
