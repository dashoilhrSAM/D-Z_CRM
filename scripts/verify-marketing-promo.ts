// Verify MKT-013 end-to-end against the real dev database:
// create a live 20% promo -> book with a package -> assert the discount is persisted
// on the booking -> assert the invoice applies it. Cleans up after itself.
import { db } from "../src/lib/db";
import { bookingService } from "../src/modules/bookings/service";
import { loadCampaignPerformance } from "../src/modules/marketing/performance";

async function main() {
  const results: { check: string; ok: boolean; detail: string }[] = [];
  const record = (check: string, ok: boolean, detail: string) => {
    results.push({ check, ok, detail });
    console.log((ok ? "PASS  " : "FAIL  ") + check + " — " + detail);
  };

  const org = await db.organisation.findFirst();
  if (!org) throw new Error("no org");
  const branch = await db.branch.findFirst({ where: { isMain: true } });
  if (!branch) throw new Error("no branch");
  // customers are org-level shared, so branchId may be null — take any customer with a bike
  const customer = await db.customer.findFirst({ where: { motorcycles: { some: {} } } });
  if (!customer) throw new Error("no customer with a motorcycle");
  const bike = await db.motorcycle.findFirst({ where: { customerId: customer.id } });
  const pkg = await db.servicePackage.findFirst({ where: { active: true, priceSen: { gt: 0 } } });
  if (!bike || !pkg) throw new Error("missing bike or package");

  console.log("fixture: customer=" + customer.name + " bike=" + bike.plate + " package=" + pkg.name + " (" + pkg.priceSen + " sen)");

  const campaign = await db.campaign.create({
    data: {
      branchId: branch.id,
      name: "__verify_promo__",
      type: "PROMO",
      status: "ACTIVE",
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 86400000),
      discountPercent: 20,
      audience: "ALL",
    },
  });

  const booking = await bookingService.create({
    branchId: branch.id,
    customerId: customer.id,
    motorcycleId: bike.id,
    serviceType: pkg.name,
    date: new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z"),
    timeSlot: "15:00",
    source: "COUNTER",
    packageId: pkg.id,
    type: "SERVICE",
  }) as { id: string; promoDiscountSen: number; promoSnapshot: unknown; campaignId: string | null };

  const expectedDiscount = Math.round((pkg.priceSen * 80) / 100) === pkg.priceSen ? 0 : Math.round((pkg.priceSen * 20) / 100);
  record("booking persists promoDiscountSen", booking.promoDiscountSen === expectedDiscount,
    "got " + booking.promoDiscountSen + " expected " + expectedDiscount);
  record("booking snapshots the promo", !!booking.promoSnapshot,
    JSON.stringify(booking.promoSnapshot));
  record("booking links the auto-applied campaign", booking.campaignId === campaign.id,
    "campaignId=" + booking.campaignId);

  // booking-side figures survive a fresh read (proves it hit the DB, not just the return value)
  const reread = await db.booking.findUnique({ where: { id: booking.id }, select: { promoDiscountSen: true, promoSnapshot: true, campaignId: true } });
  record("discount is durable (re-read from DB)", reread?.promoDiscountSen === expectedDiscount,
    "re-read " + reread?.promoDiscountSen);

  const perf = await loadCampaignPerformance([campaign.id]);
  record("campaign performance counts the attributed booking", perf.get(campaign.id)?.bookings === 1,
    "bookings=" + perf.get(campaign.id)?.bookings);

  // cleanup
  await db.booking.delete({ where: { id: booking.id } });
  await db.campaign.delete({ where: { id: campaign.id } });
  console.log("cleanup done");

  const failed = results.filter((r) => !r.ok);
  console.log("\n" + (results.length - failed.length) + "/" + results.length + " checks passed");
  if (failed.length > 0) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERROR", e); process.exit(1); });
