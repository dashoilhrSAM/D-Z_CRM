// P2 的验收测试：**重跑计提不产生第二条**（设计稿 §8 里 P2 的可观测验收）。
//
// 为什么这条测试必须在真库上跑（而不是只测纯函数）：幂等是靠**数据库唯一键**实现的，
// 纯函数测不出"第二条插不进去"。这也是本项目一贯的做派——守卫要在真环境里可证伪。
//
// 用一个独立的测试组织（名字带随机后缀），结束后按外键顺序清理，不动演示数据。
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const saved = { databaseUrl: process.env.DATABASE_URL };
const tag = "t" + Date.now().toString(36);

let db: typeof import("@/lib/db")["db"];
let accrueForJob: typeof import("@/modules/commission/engine")["accrueForJob"];
let orgId = "";
let invoiceId = "";
const jobIds: string[] = [];

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  ({ db } = await import("@/lib/db"));
  ({ accrueForJob } = await import("@/modules/commission/engine"));

  const org = await db.organisation.create({ data: { name: "COMM-TEST-" + tag } });
  orgId = org.id;
  const branch = await db.branch.create({ data: { organisationId: org.id, name: "Test Branch", city: "Petaling Jaya" } });
  const mech = await db.user.create({
    data: { organisationId: org.id, branchId: branch.id, name: "Test Mechanic", email: "mech-" + tag + "@dsh.test", role: "MECHANIC" },
  });
  const customer = await db.customer.create({ data: { organisationId: org.id, name: "Test Customer " + tag, phone: "0120000" + tag.slice(-4) } });
  const moto = await db.motorcycle.create({ data: { customerId: customer.id, plate: "T" + tag.toUpperCase().slice(0, 6), brand: "Test", model: "Test Bike", year: 2020, currentMileage: 1000 } });

  // 一张 5% 的默认规则：覆盖所有未单独配置的行
  await db.commissionRule.create({
    data: { organisationId: org.id, scope: "DEFAULT", basis: "PERCENT", value: 500, effectiveFrom: new Date("2020-01-01T00:00:00Z") },
  });

  // 工单 A：有技师、有计费行 + 一张免费行、发票带 900 sen 折扣
  const jobA = await db.serviceJob.create({
    data: { jobNumber: "TEST-A-" + tag, branchId: branch.id, customerId: customer.id, motorcycleId: moto.id, mileage: 1000, mechanicId: mech.id, status: "COMPLETED", completedAt: new Date() },
  });
  jobIds.push(jobA.id);
  await db.serviceJobItem.create({ data: { jobId: jobA.id, description: "Engine Oil Change", kind: "SERVICE", quantity: 1, unitPriceSen: 9000, lineTotalSen: 9000, status: "INCLUDED", source: "COUNTER" } });
  await db.serviceJobItem.create({ data: { jobId: jobA.id, description: "Free 20-point check", kind: "SERVICE", quantity: 1, unitPriceSen: 0, lineTotalSen: 0, status: "INCLUDED", source: "COUNTER" } });
  const inv = await db.invoice.create({
    data: { branchId: branch.id, customerId: customer.id, jobId: jobA.id, invoiceNumber: "TESTINV-" + tag, subtotalSen: 9000, discountSen: 900, totalSen: 8100 },
  });
  invoiceId = inv.id;

  // 工单 B：**没有指派技师**（决定 1 的边界：不许静默算 0）
  const jobB = await db.serviceJob.create({
    data: { jobNumber: "TEST-B-" + tag, branchId: branch.id, customerId: customer.id, motorcycleId: moto.id, mileage: 1000, status: "COMPLETED", completedAt: new Date() },
  });
  jobIds.push(jobB.id);
  await db.serviceJobItem.create({ data: { jobId: jobB.id, description: "Tyre Replacement", kind: "SERVICE", quantity: 1, unitPriceSen: 7500, lineTotalSen: 7500, status: "INCLUDED", source: "COUNTER" } });
  await db.invoice.create({
    data: { branchId: branch.id, customerId: customer.id, jobId: jobB.id, invoiceNumber: "TESTINV-B-" + tag, subtotalSen: 7500, discountSen: 0, totalSen: 7500 },
  });
});

afterAll(async () => {
  // 按外键顺序清理（只删本测试造的数据）
  await db.commissionLedger.deleteMany({ where: { organisationId: orgId } });
  await db.commissionRule.deleteMany({ where: { organisationId: orgId } });
  await db.invoice.deleteMany({ where: { invoiceNumber: { contains: tag } } });
  for (const id of jobIds) {
    await db.serviceJobItem.deleteMany({ where: { jobId: id } });
    await db.serviceJob.delete({ where: { id } });
  }
  await db.motorcycle.deleteMany({ where: { plate: "T" + tag.toUpperCase().slice(0, 6) } });
  await db.customer.deleteMany({ where: { organisationId: orgId } });
  await db.user.deleteMany({ where: { organisationId: orgId } });
  await db.branch.deleteMany({ where: { organisationId: orgId } });
  await db.organisation.delete({ where: { id: orgId } });
});

describe("完工计提（工单 A：有技师 + 免费行 + 发票折扣）", () => {
  it("按**客户实付**计提：折扣按行分摊后算 5%", async () => {
    const first = await accrueForJob(db, jobIds[0]);
    // 9000 − 900(折扣) = 8100 净额；5% = 405
    expect(first.based).toBe(1);
    expect(first.totalSen).toBe(405);
    const row = await db.commissionLedger.findFirst({ where: { jobId: jobIds[0], kind: "BASE" } });
    expect(row).toMatchObject({ amountSen: 405, baseSen: 8100, basis: "PERCENT", kind: "BASE" });
    expect(row?.ruleSnapshot).toContain("DEFAULT");
    expect(row?.windowKey).toMatch(/^\d{4}-\d{2}$/);
  });

  it("**重跑不产生第二条**：第二次全部撞唯一键，台账行数不变", async () => {
    const before = await db.commissionLedger.count({ where: { jobId: jobIds[0] } });
    const second = await accrueForJob(db, jobIds[0]);
    expect(second.based).toBe(0);
    expect(second.totalSen).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
    const after = await db.commissionLedger.count({ where: { jobId: jobIds[0] } });
    expect(after).toBe(before);
  });

  it("免费行不计佣也不计件（不留 BASE，也不留 LEGACY）", async () => {
    const rows = await db.commissionLedger.findMany({ where: { jobId: jobIds[0] } });
    // 只有一条计费行的台账；免费行完全没有行
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("BASE");
  });

  it("发票不存在时不计提（计提时点＝完工开票）", async () => {
    const job = await db.serviceJob.create({
      data: { jobNumber: "TEST-C-" + tag, branchId: (await db.branch.findFirst({ where: { organisationId: orgId } }))!.id, customerId: (await db.customer.findFirst({ where: { organisationId: orgId } }))!.id, motorcycleId: (await db.motorcycle.findFirst({ where: { plate: "T" + tag.toUpperCase().slice(0, 6) } }))!.id, mileage: 1 },
    });
    jobIds.push(job.id);
    const res = await accrueForJob(db, job.id);
    expect(res).toEqual({ based: 0, legacy: 0, pending: 0, skipped: 0, totalSen: 0 });
  });
});

describe("未指派技师（工单 B）", () => {
  it("写 PENDING 行而不是静默算 0（钱少给了必须有人看得见）", async () => {
    const res = await accrueForJob(db, jobIds[1]);
    expect(res.pending).toBe(1);
    expect(res.based).toBe(0);
    const row = await db.commissionLedger.findFirst({ where: { jobId: jobIds[1], kind: "PENDING" } });
    expect(row?.amountSen).toBe(0);
    expect(row?.reason).toContain("no mechanic");
  });
});
