import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { BASE_URL, setPersona, bookViaRider, confirmAndCheckIn, runMechanicInspection, settle, dismissGuide } from "./helpers";

/**
 * A discounted job must quote the discounted total in the completion WhatsApp.
 *
 * The unit test pins the wording; this one proves the wiring end to end, because the bug lived
 * in the wiring: booking through a campaign link → promo snapshot on the booking → discounted
 * invoice at completion → the message row that was actually stored for that job.
 *
 * The package has to be picked in the form: a booking resolves its discount from its own priced
 * lines, so a package-less booking carries no promo and this test would then prove nothing.
 */
const db = new PrismaClient({ datasources: { db: { url: "file:./e2e.db" } } });

test("the completion message quotes the total the discounted invoice shows", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const branch = await db.branch.findFirstOrThrow({ where: { isMain: true }, select: { id: true } });
  const campaign = await db.campaign.create({
    data: {
      branchId: branch.id,
      name: "E2E Quote 10%",
      type: "PROMO",
      status: "ACTIVE",
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 7 * 86400000),
      discountPercent: 10,
    },
    select: { id: true },
  });

  try {
    // 1. Rider books through the campaign link, so the promo is snapshotted onto the booking.
    await bookViaRider(page, ctx, { query: "?campaign=" + campaign.id, packageName: "Standard Service" });
    const jobId = await confirmAndCheckIn(page, ctx);
    await runMechanicInspection(page, jobId);

    // 2. Rider approves, then the mechanic completes the job.
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
    await expect(page.getByText("CUSTOMER APPROVED").first()).toBeVisible();
    await page.getByTestId("complete-service").click();
    await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    // 3. Guard the premise: an invoice with no discount would make this test prove nothing.
    const job = await db.serviceJob.findUniqueOrThrow({
      where: { id: jobId },
      select: {
        booking: { select: { promoDiscountSen: true } },
        invoice: { select: { id: true, subtotalSen: true, discountSen: true, totalSen: true } },
      },
    });
    const invoice = job.invoice!;
    console.log("invoice", JSON.stringify(invoice), "booking promo", job.booking?.promoDiscountSen);
    const promised = job.booking?.promoDiscountSen ?? 0;
    expect(promised, "the campaign link did not discount the booking").toBeGreaterThan(0);
    // This booking was quoted at booking time (package + campaign link), check-in re-quotes the
    // same package so the promise stands, and the invoice takes exactly that promised amount —
    // not a percentage re-derived from the finished bill.
    expect(invoice.discountSen).toBe(promised);
    expect(invoice.discountSen).not.toBe(Math.round((invoice.subtotalSen * 10) / 100));
    expect(invoice.totalSen).toBe(invoice.subtotalSen - invoice.discountSen);
    // Every amount in this flow is a whole ringgit, so the formatter renders no decimals —
    // which keeps the string assertions below readable.
    expect(invoice.totalSen % 100).toBe(0);
    expect(invoice.subtotalSen % 100).toBe(0);

    // 4. The message the customer actually received quotes that total — and names the discount.
    const message = await db.message.findFirstOrThrow({
      where: { jobId, referenceType: "COMPLETION" },
      orderBy: { createdAt: "desc" },
      select: { body: true },
    });
    console.log("completion message:", message.body);
    expect(message.body).toContain("Total RM" + invoice.totalSen / 100);
    expect(message.body).toContain("diskaun RM" + invoice.discountSen / 100);
    // The subtotal is what the old body quoted; it must not be presented as the total any more.
    expect(message.body).not.toContain("RM" + invoice.subtotalSen / 100);

    // 5. Not just the message: what the workshop expects to collect follows the same invoice.
    const owed = await db.payment.aggregate({ where: { invoiceId: invoice.id }, _sum: { amountSen: true } });
    expect(owed._sum.amountSen).toBe(invoice.totalSen);
  } finally {
    // The other specs share this database — leave no extra live promo behind.
    await db.campaign.delete({ where: { id: campaign.id } }).catch(() => {});
    await ctx.close();
  }
});
