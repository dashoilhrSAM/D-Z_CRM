import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { BASE_URL, setPersona, settle } from "./helpers";

/**
 * A cashier applies a discount at checkout and takes the money.
 *
 * Asserted against the database, because the thing that matters is what got stored: the
 * discounted total, the discount recorded separately from any promotion, and the payment
 * matching what is now owed.
 */
const db = new PrismaClient({ datasources: { db: { url: "file:./e2e.db" } } });

test("a checkout discount comes off the bill and the customer pays the rest", async ({ page, context }) => {
  // Make a clean, unpaid invoice out of one that is not in use, so the test does not depend
  // on whatever state the seed left behind.
  const target = await db.invoice.findFirstOrThrow({ orderBy: { issuedAt: "desc" }, select: { id: true, invoiceNumber: true } });
  await db.payment.deleteMany({ where: { invoiceId: target.id, method: { not: "PAY_LATER" } } });
  await db.invoice.update({
    where: { id: target.id },
    data: { status: "ISSUED", paidAt: null, manualDiscountSen: 0, manualDiscountKind: null, manualDiscountValue: null, manualDiscountReason: null },
  });
  const before = await db.invoice.findUniqueOrThrow({ where: { id: target.id }, select: { subtotalSen: true, discountSen: true, taxSen: true, totalSen: true } });
  console.log("invoice", target.invoiceNumber, "subtotal", before.subtotalSen, "promo", before.discountSen, "total", before.totalSen);

  await setPersona(context, "OWNER");
  await page.goto(BASE_URL + "/workshop/finance/invoices");
  await settle(page);

  const card = page.locator("div.rounded-2xl").filter({ hasText: target.invoiceNumber }).first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /record payment/i }).click();

  // The dialog previews the discount before anything is committed.
  await page.getByTestId("discount-choice-PERCENT").click();
  await page.getByTestId("discount-value").fill("10");
  await page.waitForTimeout(300);

  const expectedDiscount = Math.min(Math.round((before.subtotalSen * 10) / 100), before.subtotalSen - before.discountSen);
  const expectedTotal = before.subtotalSen - before.discountSen - expectedDiscount + before.taxSen;
  await expect(page.getByTestId("discount-preview")).toContainText(String(expectedDiscount / 100));

  await page.getByTestId("confirm-checkout").click();
  await page.waitForTimeout(3000);

  const after = await db.invoice.findUniqueOrThrow({
    where: { id: target.id },
    select: { status: true, subtotalSen: true, discountSen: true, taxSen: true, totalSen: true, manualDiscountSen: true, manualDiscountKind: true, manualDiscountValue: true },
  });
  console.log("after:", JSON.stringify(after));

  expect(after.manualDiscountKind).toBe("PERCENT");
  expect(after.manualDiscountValue).toBe(10);
  expect(after.manualDiscountSen).toBe(expectedDiscount);
  expect(after.totalSen).toBe(expectedTotal);
  // The promotion is untouched — this is the whole reason the two are separate fields.
  expect(after.discountSen).toBe(before.discountSen);
  expect(after.status).toBe("PAID");

  const paid = await db.payment.aggregate({
    where: { invoiceId: target.id, status: "PAID", method: { not: "PAY_LATER" } },
    _sum: { amountSen: true },
  });
  expect(paid._sum.amountSen).toBe(expectedTotal);

  // And the audit trail names the act, since there is no permission gate on it.
  const logged = await db.auditLog.findFirst({
    where: { entityId: target.id, action: "INVOICE_DISCOUNT_APPLIED" },
    orderBy: { createdAt: "desc" },
  });
  expect(logged, "the discount was not audited").not.toBeNull();
  expect(logged!.after).toContain("PERCENT");
});

test("a settled invoice refuses a discount instead of silently reopening", async ({ page, context }) => {
  const target = await db.invoice.findFirstOrThrow({ where: { status: "PAID" }, select: { id: true } });
  await setPersona(context, "OWNER");
  await page.goto(BASE_URL + "/workshop/finance/invoices?status=PAID");
  await settle(page);

  // No payment dialog on a settled invoice at all — the button is replaced by "paid in full".
  const settledCard = page.locator("div.rounded-2xl").filter({ hasText: "Paid in full" }).first();
  await expect(settledCard).toBeVisible();
  await expect(settledCard.getByRole("button", { name: /record payment/i })).toHaveCount(0);

  const stillPaid = await db.invoice.findUniqueOrThrow({ where: { id: target.id }, select: { status: true } });
  expect(stillPaid.status).toBe("PAID");
});
