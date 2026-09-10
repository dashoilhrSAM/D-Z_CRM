// Verify MKT-013/MKT-017 on the MONEY path: does the invoice actually deduct the promo?
// Builds a disposable customer + bike + job, completes it through the real
// CompletionService, asserts the invoice, then removes every row it created.
import { db } from "../src/lib/db";
import { bookingService } from "../src/modules/bookings/service";
import { completionService } from "../src/services/completion";

async function main() {
  const results: { check: string; ok: boolean; detail: string }[] = [];
  const record = (c: string, ok: boolean, d: string) => { results.push({ check: c, ok, detail: d }); console.log((ok ? "PASS  " : "FAIL  ") + c + " — " + d); };

  const org = await db.organisation.findFirst();
  const branch = await db.branch.findFirst({ where: { isMain: true } });
  if (!org || !branch) throw new Error("no org/branch");
  const pkg = await db.servicePackage.findFirst({ where: { active: true, priceSen: { gt: 0 } } });
  if (!pkg) throw new Error("no package");

  const tag = "__mktverify_" + Date.now().toString(36);
  const customer = await db.customer.create({ data: { organisationId: org.id, branchId: branch.id, name: tag, phone: "+60100000000" } });
  const bike = await db.motorcycle.create({ data: { customerId: customer.id, brand: "Test", model: tag, plate: tag.slice(-8).toUpperCase(), year: 2020, currentMileage: 1000, type: "AUTO" } });
  const pointsBonus = 50;
  const campaign = await db.campaign.create({ data: { branchId: branch.id, name: tag, type: "PROMO", status: "ACTIVE", startDate: new Date(Date.now() - 86400000), endDate: new Date(Date.now() + 86400000), discountPercent: 20, pointsBonus, audience: "ALL" } });

  const subtotal = 6000;
  const expectedDiscount = 1200;
  const expectedTotal = 4800;

  try {
    // 1. book through the real path so the promo snapshot is produced
    const booking = await bookingService.create({
      branchId: branch.id, customerId: customer.id, motorcycleId: bike.id,
      serviceType: pkg.name, date: new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z"),
      timeSlot: "16:00", source: "COUNTER", packageId: pkg.id, type: "SERVICE",
    }) as { id: string; promoDiscountSen: number };

    // 2. build a job linked to that booking, priced at 6000 sen of labour
    const job = await db.serviceJob.create({
      data: {
        jobNumber: tag, branchId: branch.id, customerId: customer.id, motorcycleId: bike.id,
        mileage: 1500, status: "READY", type: "SERVICE",
        items: { create: [{ description: "Labour", kind: "SERVICE", quantity: 1, unitPriceSen: subtotal, lineTotalSen: subtotal, status: "INCLUDED", source: "COUNTER" }] },
      },
    });
    await db.booking.update({ where: { id: booking.id }, data: { jobId: job.id } });

    // 3. complete it
    await completionService.complete(job.id);

    const inv = await db.invoice.findUnique({ where: { jobId: job.id }, include: { payments: true } });
    record("invoice subtotal is the undiscounted work", inv?.subtotalSen === subtotal, "subtotalSen=" + inv?.subtotalSen);
    record("invoice deducts the promo (MKT-017)", inv?.discountSen === expectedDiscount, "discountSen=" + inv?.discountSen + " expected " + expectedDiscount);
    record("invoice total is discounted", inv?.totalSen === expectedTotal, "totalSen=" + inv?.totalSen + " expected " + expectedTotal);
    record("receivable matches the discounted total", inv?.payments?.[0]?.amountSen === expectedTotal, "payment=" + inv?.payments?.[0]?.amountSen);

    // MKT-014: campaign bonus points land on top of the normal service points
    const acct = await db.loyaltyAccount.findUnique({ where: { customerId: customer.id } });
    const basePoints = Math.max(10, Math.round(subtotal / 100));
    record("loyalty points include the campaign bonus (MKT-014)", acct?.totalEarned === basePoints + pointsBonus,
      "totalEarned=" + acct?.totalEarned + " expected " + (basePoints + pointsBonus));
    const bonusTx = acct
      ? await db.loyaltyTransaction.findFirst({ where: { accountId: acct.id, referenceType: "CAMPAIGN" } })
      : null;
    record("bonus is recorded as a separate campaign transaction", bonusTx?.points === pointsBonus,
      "bonusTx.points=" + bonusTx?.points);
  } finally {
    // remove everything this run created, in FK-safe order
    const jobs = await db.serviceJob.findMany({ where: { customerId: customer.id }, select: { id: true } });
    const jobIds = jobs.map((j) => j.id);
    const invs = await db.invoice.findMany({ where: { customerId: customer.id }, select: { id: true } });
    const invIds = invs.map((i) => i.id);
    const acct = await db.loyaltyAccount.findUnique({ where: { customerId: customer.id }, select: { id: true } });
    await db.payment.deleteMany({ where: { invoiceId: { in: invIds } } });
    await db.invoiceItem.deleteMany({ where: { invoiceId: { in: invIds } } });
    await db.invoice.deleteMany({ where: { customerId: customer.id } });
    if (acct) { await db.loyaltyTransaction.deleteMany({ where: { accountId: acct.id } }); await db.loyaltyAccount.delete({ where: { id: acct.id } }); }
    await db.review.deleteMany({ where: { customerId: customer.id } });
    await db.notification.deleteMany({ where: { customerId: customer.id } });
    await db.serviceHistory.deleteMany({ where: { customerId: customer.id } });
    await db.serviceReminder.deleteMany({ where: { customerId: customer.id } });
    await db.message.deleteMany({ where: { customerId: customer.id } });
    await db.jobStatusHistory.deleteMany({ where: { jobId: { in: jobIds } } });
    await db.serviceJobItem.deleteMany({ where: { jobId: { in: jobIds } } });
    await db.serviceJobPart.deleteMany({ where: { jobId: { in: jobIds } } });
    await db.booking.deleteMany({ where: { customerId: customer.id } });
    await db.serviceJob.deleteMany({ where: { customerId: customer.id } });
    await db.motorcycle.deleteMany({ where: { customerId: customer.id } });
    await db.customer.delete({ where: { id: customer.id } });
    await db.campaign.delete({ where: { id: campaign.id } });
    console.log("cleanup done");
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n" + (results.length - failed.length) + "/" + results.length + " checks passed");
  if (failed.length > 0) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERROR", e); process.exit(1); });
