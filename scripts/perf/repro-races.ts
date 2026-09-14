#!/usr/bin/env tsx
/**
 * 并发竞态复现脚本（跑在隔离的 perf.db 上，不碰 dev/e2e/生产）
 * ==========================================================
 * 目的：在动手修之前，先**证明**这三个问题是真实存在的，而不是读代码猜的。
 *
 *   A. 时段超卖：AppointmentSlot 的容量是"先读后写"——读 bookedCount 判断是否满、
 *      之后才 increment，中间隔着若干 await。并发预约时多个请求可以都读到"还有位置"。
 *   B. 库存丢失更新：deductStockTx 读 current → 判断 → 写 current-qty（绝对赋值）。
 *      两个并发扣减都读到 5，都写 4：实扣 2 只记 1。
 *   C. 时段只增不减：取消/改期不释放名额，容量被永久占用。
 *
 * 用法：
 *   DATABASE_URL="file:./perf.db" pnpm exec tsx scripts/perf/repro-races.ts
 *   DATABASE_URL="file:./perf.db" pnpm exec tsx scripts/perf/repro-races.ts --scenario A
 */
import { PrismaClient } from "@prisma/client";
import { inventoryService } from "@/modules/inventory/service";
import { bookingService } from "@/modules/bookings/service";

const db = new PrismaClient();
const TAG = "perf_repro";
const arg = (n: string, d: string) => {
  const i = process.argv.indexOf("--" + n);
  return i >= 0 ? (process.argv[i + 1] ?? d) : d;
};
const only = arg("scenario", "");

async function klBranch() {
  const b = await db.branch.findFirst({ where: { isMain: true } });
  if (!b) throw new Error("no main branch");
  return b;
}

/** A：时段容量 TOCTOU */
async function scenarioA() {
  const branch = await klBranch();
  const cust = await db.customer.findFirst({ where: { id: { startsWith: "perf_" } }, include: { motorcycles: true } });
  if (!cust || cust.motorcycles.length === 0) throw new Error("perf.db 里没有带车的合成客户，先跑 seed-volume.ts");
  const CAP = 3;
  const date = new Date(Date.now() + 400 * 86400000);
  const startTime = "23:45";
  await db.appointmentSlot.deleteMany({ where: { branchId: branch.id, date, startTime } });
  const slot = await db.appointmentSlot.create({
    data: { branchId: branch.id, date, startTime, maxBookings: CAP, bookedCount: 0, isHoliday: false },
  });

  const N = 10;
  const results = await Promise.allSettled(
    Array.from({ length: N }, () =>
      bookingService.create({
        branchId: branch.id, customerId: cust.id, motorcycleId: cust.motorcycles[0].id,
        serviceType: "Standard Service", date, timeSlot: startTime, source: "RIDER_APP",
      }),
    ),
  );
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.length - ok;
  const errs = [...new Set(results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.message).slice(0, 40)))];
  const after = await db.appointmentSlot.findUnique({ where: { id: slot.id }, select: { bookedCount: true } });
  const bookings = await db.booking.count({ where: { branchId: branch.id, date, timeSlot: startTime } });

  console.log("\n=== A. 时段容量（容量 " + CAP + "，并发 " + N + " 次预约）===");
  console.log("  成功落单 : " + ok + " / 拒绝: " + failed + (errs.length ? "  (" + errs.join(" | ") + ")" : ""));
  console.log("  slot.bookedCount : " + after?.bookedCount);
  console.log("  实际 booking 行  : " + bookings);
  console.log(ok > CAP
    ? "  ❌ 超卖：" + ok + " 单落在容量 " + CAP + " 的时段上（正确应恰好 " + CAP + " 单、其余被拒）"
    : "  ✅ 未超卖");

  await db.booking.deleteMany({ where: { branchId: branch.id, date, timeSlot: startTime } });
  await db.appointmentSlot.delete({ where: { id: slot.id } });
}

/** B：库存丢失更新 */
async function scenarioB() {
  const branch = await klBranch();
  const sku = TAG + "_SKU";
  await db.stockMovement.deleteMany({ where: { product: { sku } } });
  await db.inventory.deleteMany({ where: { product: { sku } } });
  await db.product.deleteMany({ where: { sku } });
  const org = await db.organisation.findFirst();
  const product = await db.product.create({
    data: { organisationId: org!.id, name: TAG + " repro part", sku, sellPriceSen: 1000, costPriceSen: 500 },
  });
  const START = 5;
  await db.inventory.create({ data: { branchId: branch.id, productId: product.id, quantity: START } });

  const N = 10;
  const results = await Promise.allSettled(
    Array.from({ length: N }, () => inventoryService.deductStock(branch.id, product.id, 1, TAG + " repro")),
  );
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const errs = [...new Set(results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.message).slice(0, 44)))];
  const inv = await db.inventory.findFirst({ where: { branchId: branch.id, productId: product.id }, select: { quantity: true } });
  const movements = await db.stockMovement.aggregate({ where: { productId: product.id, quantity: { lt: 0 } }, _sum: { quantity: true } });
  const taken = Math.abs(movements._sum.quantity ?? 0);

  console.log("\n=== B. 库存扣减（起始 " + START + "，并发 " + N + " 次各扣 1）===");
  console.log("  报告成功 : " + ok + (errs.length ? "  (失败原因: " + errs.join(" | ") + ")" : ""));
  console.log("  账面结存 : " + inv?.quantity + "   流水实际扣走: " + taken);
  const expectedOk = START;
  if (ok > expectedOk || (inv?.quantity ?? 0) < 0) {
    console.log("  ❌ 账实不符：声称成功 " + ok + " 次（应 " + expectedOk + "），或结存为负");
  } else if ((inv?.quantity ?? 0) + taken !== START) {
    console.log("  ❌ 丢失更新：结存 " + inv?.quantity + " + 已扣 " + taken + " ≠ 起始 " + START);
  } else {
    console.log("  ✅ 账实相符（本次未被调度成竞态；PG READ COMMITTED 下仍可能发生）");
  }

  await db.stockMovement.deleteMany({ where: { productId: product.id } });
  await db.inventory.deleteMany({ where: { productId: product.id } });
  await db.product.delete({ where: { id: product.id } });
}

/** C：时段只增不减（不需要并发，确定性复现） */
async function scenarioC() {
  const branch = await klBranch();
  const cust = await db.customer.findFirst({ where: { id: { startsWith: "perf_" } }, include: { motorcycles: true } });
  if (!cust || cust.motorcycles.length === 0) throw new Error("no synthetic customer with a bike");
  const date = new Date(Date.now() + 401 * 86400000);
  const startTime = "23:50";
  await db.appointmentSlot.deleteMany({ where: { branchId: branch.id, date, startTime } });
  const slot = await db.appointmentSlot.create({
    data: { branchId: branch.id, date, startTime, maxBookings: 1, bookedCount: 0, isHoliday: false },
  });
  const created = await bookingService.create({
    branchId: branch.id, customerId: cust.id, motorcycleId: cust.motorcycles[0].id,
    serviceType: "Standard Service", date, timeSlot: startTime, source: "RIDER_APP",
  });
  const afterBook = await db.appointmentSlot.findUnique({ where: { id: slot.id }, select: { bookedCount: true } });
  await bookingService.transition((created as { id: string }).id, "CANCELLED");
  const afterCancel = await db.appointmentSlot.findUnique({ where: { id: slot.id }, select: { bookedCount: true } });

  console.log("\n=== C. 取消预约是否释放名额（容量 1）===");
  console.log("  预约后 bookedCount : " + afterBook?.bookedCount);
  console.log("  取消后 bookedCount : " + afterCancel?.bookedCount);
  console.log(afterCancel?.bookedCount === 0 ? "  ✅ 已释放" : "  ❌ 未释放：名额被永久占用（该时段再也约不到人）");

  await db.booking.deleteMany({ where: { branchId: branch.id, date, timeSlot: startTime } });
  await db.appointmentSlot.delete({ where: { id: slot.id } });
}

async function main() {
  console.log("目标库: " + (process.env.DATABASE_URL ?? "(来自 .env)"));
  if (!only || only === "A") await scenarioA();
  if (!only || only === "B") await scenarioB();
  if (!only || only === "C") await scenarioC();
  await db.$disconnect();
}
main().catch(async (e) => { console.error("repro failed:", e); await db.$disconnect(); process.exit(1); });
