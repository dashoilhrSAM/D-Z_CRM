// 零件计佣（P4b）：由 workshop 的开关决定，且零件行要和服行一样有幂等保证。
//
// 三件必须钉住的事：
//  ① 开关**开**时零件照常计提（零件行有 productId，规则与阶梯都能正常工作）；
//  ② 开关**关**时零件**完全不计提** —— 连 0 元痕迹都不留（否则对账会把它报成"未被规则覆盖"，那是噪声）；
//  ③ 幂等：零件行有独立唯一键 (jobPartId, kind)，重跑不会写第二条。
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const saved = { databaseUrl: process.env.DATABASE_URL };
const tag = "p" + Date.now().toString(36);
const plate = ("P" + tag.slice(-4) + Math.random().toString(36).slice(2, 4)).toUpperCase();

let db: typeof import("@/lib/db")["db"];
let accrueForJob: typeof import("@/modules/commission/engine")["accrueForJob"];

let orgId = "";
let branchId = "";
let mechId = "";
let customerId = "";
let motoId = "";
let productId = "";
const jobIds: string[] = [];

/** 造一张带**零件行**的已完工工单（有发票，才能计提）。 */
async function makeJobWithPart(partPriceSen: number, qty: number, jobNumber: string) {
  const job = await db.serviceJob.create({
    data: {
      jobNumber, branchId, customerId, motorcycleId: motoId, mileage: 1000, mechanicId: mechId,
      status: "COMPLETED", completedAt: new Date(),
    },
  });
  jobIds.push(job.id);
  if (partPriceSen > 0) {
    await db.serviceJobPart.create({
      data: {
        jobId: job.id, productId, quantity: qty, unitCostSen: 2500,
        unitPriceSen: partPriceSen, lineTotalSen: partPriceSen * qty, status: "INCLUDED", source: "COUNTER",
      },
    });
  }
  await db.invoice.create({
    data: {
      branchId, customerId, jobId: job.id, invoiceNumber: "PART-" + jobNumber,
      subtotalSen: partPriceSen * qty, discountSen: 0, totalSen: partPriceSen * qty,
    },
  });
  return job.id;
}

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  ({ db } = await import("@/lib/db"));
  ({ accrueForJob } = await import("@/modules/commission/engine"));

  const org = await db.organisation.create({ data: { name: "COMM-PARTS-" + tag } });
  orgId = org.id;
  const branch = await db.branch.create({ data: { organisationId: org.id, name: "Parts Branch", city: "Petaling Jaya" } });
  branchId = branch.id;
  const mech = await db.user.create({ data: { organisationId: org.id, branchId: branch.id, name: "Parts Mech", email: "parts-" + tag + "@dsh.test", role: "MECHANIC" } });
  mechId = mech.id;
  const customer = await db.customer.create({ data: { organisationId: org.id, name: "Parts Customer " + tag } });
  customerId = customer.id;
  const moto = await db.motorcycle.create({ data: { customerId, plate, brand: "Test", model: "Parts Bike", year: 2019, currentMileage: 1000 } });
  motoId = moto.id;
  const product = await db.product.create({
    data: { organisationId: org.id, name: "Parts Oil " + tag, sku: "POIL-" + tag, sellPriceSen: 3500, costPriceSen: 2500, category: "ENGINE_OIL" },
  });
  productId = product.id;
  await db.commissionRule.create({
    data: { organisationId: org.id, scope: "DEFAULT", basis: "PERCENT", value: 500, effectiveFrom: new Date("2020-01-01T00:00:00Z") },
  });
});

afterAll(async () => {
  for (const id of jobIds) {
    const inv = await db.invoice.findFirst({ where: { jobId: id } });
    if (inv) {
      await db.payment.deleteMany({ where: { invoiceId: inv.id } });
      await db.invoiceItem.deleteMany({ where: { invoiceId: inv.id } });
      await db.invoice.delete({ where: { id: inv.id } });
    }
    await db.serviceJobPart.deleteMany({ where: { jobId: id } });
    await db.serviceJobItem.deleteMany({ where: { jobId: id } });
    await db.commissionLedger.deleteMany({ where: { jobId: id } });
    await db.serviceHistory.deleteMany({ where: { jobId: id } });
    await db.jobStatusHistory.deleteMany({ where: { jobId: id } });
    await db.serviceJob.delete({ where: { id: id } });
  }
  await db.commissionRule.deleteMany({ where: { organisationId: orgId } });
  await db.product.deleteMany({ where: { organisationId: orgId } });
  const motos = await db.motorcycle.findMany({ where: { plate }, select: { id: true } });
  await db.serviceReminder.deleteMany({ where: { motorcycleId: { in: motos.map((m) => m.id) } } });
  await db.motorcycle.deleteMany({ where: { plate } });
  await db.customer.deleteMany({ where: { organisationId: orgId } });
  await db.user.deleteMany({ where: { organisationId: orgId } });
  await db.branch.deleteMany({ where: { organisationId: orgId } });
  await db.organisation.delete({ where: { id: orgId } });
});

describe("开关打开时：零件照常计提", () => {
  it("零件行产生一条 BASE，金额 = 零件净额 × 5%，并带上 productId 与 jobPartId", async () => {
    const jobId = await makeJobWithPart(3500, 2, "P-ON-" + tag);
    const summary = await accrueForJob(db, jobId);
    expect(summary.based).toBe(1);
    expect(summary.totalSen).toBe(350); // 7000 × 5%

    const rows = await db.commissionLedger.findMany({ where: { jobId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "BASE", baseSen: 7000, amountSen: 350, qty: 2, basis: "PERCENT" });
    expect(rows[0].jobPartId).toBeTruthy();
    expect(rows[0].jobItemId).toBeNull();
    // 作用域身份：零件行也有 productId，所以阶梯/分类统计照常可用
    expect(rows[0].productId).toBe(productId);
    expect(rows[0].category).toBe("ENGINE_OIL");
  });

  it("重跑不产生第二条（零件行有自己的唯一键）", async () => {
    const jobId = jobIds[jobIds.length - 1];
    const again = await accrueForJob(db, jobId);
    expect(again.skipped).toBe(1);
    expect(await db.commissionLedger.count({ where: { jobId } })).toBe(1);
  });
});

describe("开关关闭时：零件完全不计提（连 0 元痕迹都不留）", () => {
  it("关掉后同一张零件单不再产生任何台账行", async () => {
    await db.organisation.update({ where: { id: orgId }, data: { commissionOnParts: false } });
    const jobId = await makeJobWithPart(4000, 1, "P-OFF-" + tag);
    const summary = await accrueForJob(db, jobId);
    expect(summary.based).toBe(0);
    expect(summary.legacy).toBe(0);
    expect(summary.pending).toBe(0);
    expect(await db.commissionLedger.count({ where: { jobId } })).toBe(0);
    await db.organisation.update({ where: { id: orgId }, data: { commissionOnParts: true } });
  });

  it("重新打开后（同一张工单重跑）零件会被计提 —— 说明开关是读取时的判断，不是写入时的快照", async () => {
    const jobId = jobIds[jobIds.length - 1];
    const summary = await accrueForJob(db, jobId);
    expect(summary.based).toBe(1);
    expect(await db.commissionLedger.count({ where: { jobId } })).toBe(1);
  });
});
