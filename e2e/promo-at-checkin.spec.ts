import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { BASE_URL, setPersona, bookViaRider, confirmAndCheckIn, runMechanicInspection, settle, dismissGuide } from "./helpers";

/**
 * The promo promise, end to end, for the case that used to get nothing.
 *
 * A rider who does not pick a package at booking time (the form allows it — the counter picks it
 * at check-in) had no priced line at booking, so no promo snapshot was taken and the invoice was
 * charged in full, however live the promotion was. The quotation is the first moment those lines
 * are money, so that is where the promise is made now.
 *
 * It also pins the base: the promise is the quoted lines, so the counter's later work is charged
 * in full — the invoice must not re-derive a percentage from the finished bill.
 */
const db = new PrismaClient({ datasources: { db: { url: "file:./e2e.db" } } });

const PACKAGE_SEN = 12000; // "Standard Service RM120" — what the counter picks at check-in

test("a booking with no package is quoted at check-in and charged the promised discount", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // The seed ships auto-apply ON; another spec flips that switch, so be explicit.
  await db.organisation.updateMany({ data: { promoAutoApply: true } });

  // 1. Rider books without a package and without a campaign link — this is the gap's starting point.
  const ahmad = await db.customer.findFirstOrThrow({ where: { phone: "012-345 6789" }, select: { id: true } });
  const previous = await db.booking.findFirst({ where: { customerId: ahmad.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
  await bookViaRider(page, ctx);
  const booking = await db.booking.findFirstOrThrow({
    where: { customerId: ahmad.id, id: { not: previous?.id ?? "" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, servicePackageId: true, campaignId: true },
  });
  expect(booking.servicePackageId, "premise: the booking must have no package to be the gap case").toBeNull();
  expect(booking.campaignId).toBeNull();

  // 2. Counter picks the package at check-in → the quotation is generated → the promise is made.
  const jobId = await confirmAndCheckIn(page, ctx);
  const promised = await db.booking.findUniqueOrThrow({
    where: { id: booking.id },
    select: { promoSnapshot: true, promoDiscountSen: true },
  });
  const snapshot = promised.promoSnapshot as { campaignId: string; campaignName: string; discountPercent: number; originalSen: number; discountedSen: number; savedSen: number } | null;
  console.log("promise at check-in:", JSON.stringify(snapshot));
  expect(snapshot, "check-in did not make the promo promise").not.toBeNull();
  expect(snapshot!.discountPercent).toBeGreaterThan(0);
  expect(snapshot!.originalSen, "the quote base is the package the counter picked").toBe(PACKAGE_SEN);
  expect(snapshot!.savedSen).toBe(Math.round((PACKAGE_SEN * snapshot!.discountPercent) / 100));
  expect(promised.promoDiscountSen).toBe(snapshot!.savedSen);

  // 2b. The rider approves the quotation — so the promotion has to be on it, not only on the
  //     final invoice. The quotation covers the package alone (RM120 → RM96 after the promise).
  const jobRow = await db.serviceJob.findUniqueOrThrow({ where: { id: jobId }, select: { jobNumber: true, quotation: { select: { totalSen: true } } } });
  const quotation = jobRow.quotation!;
  await setPersona(ctx, "CUSTOMER");
  await page.goto(BASE_URL + "/rider/service-status");
  await dismissGuide(page);
  // Another spec can leave this rider with a second live job, so scope to this job's card.
  const card = page.locator('[data-testid="quotation-card"][data-job="' + jobRow.jobNumber + '"]');
  await expect(card).toBeVisible();
  await expect(card.getByTestId("quotation-promo")).toContainText("RM" + snapshot!.savedSen / 100);
  await expect(card.getByTestId("quotation-total")).toContainText("RM" + (quotation.totalSen - snapshot!.savedSen) / 100);
  await expect(card.getByTestId("quotation-total")).not.toContainText("RM" + quotation.totalSen / 100);

  // 3. Finish the job the usual way.
  await runMechanicInspection(page, jobId);
  await setPersona(ctx, "CUSTOMER");
  await page.goto(BASE_URL + "/rider/approvals");
  await dismissGuide(page);
  await expect(page.getByTestId("approval-card")).toBeVisible();
  await page.getByTestId("approval-approve").click();
  await expect(page.getByTestId("approval-card")).toHaveCount(0, { timeout: 15_000 });

  await setPersona(ctx, "MECHANIC");
  await settle(page);
  await page.goto(BASE_URL + "/mechanic-app/jobs/" + jobId); // 隔离：mechanic 只能 mechanic app
  await dismissGuide(page);
  await page.getByTestId("complete-service").click();
  await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // 4. The invoice takes the promise — and only the promise.
  const job = await db.serviceJob.findUniqueOrThrow({
    where: { id: jobId },
    select: { invoice: { select: { id: true, subtotalSen: true, discountSen: true, totalSen: true } } },
  });
  const invoice = job.invoice!;
  console.log("invoice:", JSON.stringify(invoice), "promised:", snapshot!.savedSen);
  expect(invoice.subtotalSen, "work was added after the quote — otherwise the base is untested").toBeGreaterThan(snapshot!.originalSen);
  expect(invoice.discountSen).toBe(snapshot!.savedSen);
  expect(invoice.totalSen).toBe(invoice.subtotalSen - snapshot!.savedSen);
  // The old rule: percent × the finished bill. It must not be that.
  expect(invoice.discountSen).not.toBe(Math.round((invoice.subtotalSen * snapshot!.discountPercent) / 100));

  // 5. And the customer is told the same number as the invoice shows.
  expect(invoice.totalSen % 100).toBe(0);
  const message = await db.message.findFirstOrThrow({
    where: { jobId, referenceType: "COMPLETION" },
    orderBy: { createdAt: "desc" },
    select: { body: true },
  });
  console.log("completion message:", message.body);
  expect(message.body).toContain("Total RM" + invoice.totalSen / 100);
  expect(message.body).not.toContain("RM" + invoice.subtotalSen / 100);

  const owed = await db.payment.aggregate({ where: { invoiceId: invoice.id }, _sum: { amountSen: true } });
  expect(owed._sum.amountSen).toBe(invoice.totalSen);

  await ctx.close();
});
