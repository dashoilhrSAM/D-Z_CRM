import { db } from "../src/lib/db";
import { staffService } from "../src/modules/staff/service";
import { inventoryService } from "../src/modules/inventory/service";

async function main() {
  const ahmad = await db.customer.findFirst({ where: { phone: "012-345 6789" }, include: { motorcycles: true, jobs: { include: { invoice: true } }, reminders: true } });
  if (ahmad) {
    const completed = ahmad.jobs.filter((j) => j.status === "COMPLETED");
    const spend = completed.reduce((s, j) => s + (j.invoice?.totalSen ?? 0), 0);
    console.log("AHMAD:", ahmad.name, "| bikes:", ahmad.motorcycles.length, "| visits:", completed.length, "| lifetime RM", spend / 100);
  const sorted = completed.sort((a, b) => (b.completedAt ?? b.createdAt).getTime() - (a.completedAt ?? a.createdAt).getTime());
  console.log("  invoices:", sorted.map((j) => j.jobNumber + "=" + ((j.invoice?.totalSen ?? 0) / 100)).join(" "));
  console.log("  last:", sorted[0]?.jobNumber, sorted[0]?.mileage + "km", sorted[0]?.completedAt?.toISOString().slice(0, 10));
    console.log("  bike:", ahmad.motorcycles[0]?.plate, ahmad.motorcycles[0]?.currentMileage + "km", "| next:", ahmad.motorcycles[0]?.nextServiceMileage);
    console.log("  reminder:", ahmad.reminders.map((r) => r.nextServiceMileage + "km est " + (r.estimatedDate ? r.estimatedDate.toISOString().slice(0, 10) : "?")));
    console.log("  last job:", completed[0]?.jobNumber, completed[0]?.mileage + "km", completed[0]?.completedAt?.toISOString().slice(0, 10));
  }
  const jobs = await db.serviceJob.count();
  const open = await db.serviceJob.count({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } });
  console.log("jobs total:", jobs, "| open:", open);
  const today = new Date();
  const todayJobs = await db.serviceJob.count({ where: { createdAt: { gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()) } } });
  console.log("jobs today:", todayJobs);
  const inv = await db.invoice.findMany({ where: { issuedAt: { gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()) } } });
  console.log("today invoices:", inv.length, "revenue RM", inv.reduce((s, i) => s + i.totalSen, 0) / 100);
  const reminders = await db.serviceReminder.findMany({ include: { motorcycle: true } });
  const due = reminders.filter((r) => !r.closedAt && r.motorcycle.currentMileage >= r.nextServiceMileage).length;
  console.log("reminders total:", reminders.length, "| due/overdue:", due);
  const reviews = await db.review.findMany({ where: { rating: { not: null } } });
  console.log("reviews:", reviews.length, "avg", (reviews.reduce((s, r) => s + r.rating!, 0) / reviews.length).toFixed(2));
  const bookings = await db.booking.count();
  console.log("bookings:", bookings);
  const kpi = await staffService.kpiBoard(undefined, 30);
  console.log("KPI top:", kpi.top?.name, kpi.top?.score, "| jobs:", kpi.top?.jobs, "avgTicket RM", (kpi.top?.avgTicketSen ?? 0) / 100);
  const kl = await db.branch.findFirst({ where: { isMain: true } });
  const status = await inventoryService.stockStatus(kl!.id);
  const crit = status.filter((s2) => s2.level === "CRITICAL" || s2.level === "OUT_OF_STOCK");
  console.log("stock critical+oos:", crit.length, crit.map((c) => c.sku + ":" + c.quantity).join(" "), "| low:", status.filter((s2) => s2.level === "LOW").length);
  const aizat = kpi.staff.find((k) => k.name.includes("Aizat"));
  console.log("Aizat detail:", JSON.stringify(aizat));
  const dead = await inventoryService.deadStock(kl!.id);
  console.log("dead stock items:", dead.length, "value RM", dead.reduce((s2, d) => s2 + d.valueSen, 0) / 100);
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });