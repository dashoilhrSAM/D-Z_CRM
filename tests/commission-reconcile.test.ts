// 对账（不变量）测试：这张"最后一道网"自己必须是对的。
//
// 为什么它值得单独测：对账报告一旦**假红**，人就学会忽略它（狼来了），真缺口反而没人看；
// 一旦**假绿**，它就成了"看起来没事"的装饰。两种失败都比没有报告更糟。
//
// 重点覆盖 P4 才成立的那条不变量：**台账 == 工资单**，且取数口径必须与结算一致
// （按 earnedAt 落在周期内，而不是按窗口键匹配）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const saved = { databaseUrl: process.env.DATABASE_URL };
const tag = "r" + Date.now().toString(36);
const plate = ("R" + tag.slice(-4) + Math.random().toString(36).slice(2, 4)).toUpperCase();

let db: typeof import("@/lib/db")["db"];
let runCommissionReconciliation: typeof import("@/modules/commission/reconcile")["runCommissionReconciliation"];

let orgId = "";
let branchId = "";
let mechA = "";
let mechB = "";
let customerId = "";
const JOB_A = "RC-A-" + tag;
const PERIOD_START = new Date("2026-09-01T00:00:00Z");
const WINDOW = "2026-09";

async function ledgerRow(userId: string, kind: string, amountSen: number, earnedAt: Date, windowKey: string, jobId?: string) {
  return db.commissionLedger.create({
    // jobId 可选：本文件多数台账行是为"结算对比"写的（不带工单），
    // 而**覆盖检查**只认带 jobId 的行 —— 两者的用途不同，所以显式可选。
    data: { organisationId: orgId, userId, kind, amountSen, basis: "PERCENT", baseSen: 0, qty: 1, earnedAt, windowKey, jobId: jobId ?? null },
  });
}

async function payout(userId: string, commissionSen: number, status: string) {
  return db.staffPayout.create({
    data: { userId, period: "month", periodStart: PERIOD_START, baseSen: 0, commissionSen, addonBonusSen: 0, bonusSen: 0, totalSen: commissionSen, status },
  });
}

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  ({ db } = await import("@/lib/db"));
  ({ runCommissionReconciliation } = await import("@/modules/commission/reconcile"));

  const org = await db.organisation.create({ data: { name: "COMM-RECON-" + tag } });
  orgId = org.id;
  const branch = await db.branch.create({ data: { organisationId: org.id, name: "Recon Branch", city: "Petaling Jaya" } });
  branchId = branch.id;
  const a = await db.user.create({ data: { organisationId: org.id, branchId: branch.id, name: "Recon A", email: "ra-" + tag + "@dsh.test", role: "MECHANIC" } });
  const b = await db.user.create({ data: { organisationId: org.id, branchId: branch.id, name: "Recon B", email: "rb-" + tag + "@dsh.test", role: "MECHANIC" } });
  mechA = a.id;
  mechB = b.id;
  const customer = await db.customer.create({ data: { organisationId: org.id, name: "Recon Customer " + tag } });
  customerId = customer.id;
  const moto = await db.motorcycle.create({ data: { customerId: customer.id, plate, brand: "Test", model: "Recon Bike", year: 2020, currentMileage: 1000 } });

  // 工单 A：已计提（有一行计费行 + 一条 BASE）
  const jobA = await db.serviceJob.create({
    data: {
      jobNumber: JOB_A, branchId: branch.id, customerId: customer.id, motorcycleId: moto.id,
      mileage: 1000, mechanicId: mechA, status: "COMPLETED", completedAt: new Date("2026-09-10T04:00:00Z"),
    },
  });
  const itemA = await db.serviceJobItem.create({
    data: { jobId: jobA.id, description: "Recon Service", kind: "SERVICE", quantity: 1, unitPriceSen: 20000, lineTotalSen: 20000, status: "INCLUDED", source: "COUNTER" },
  });
  const invA = await db.invoice.create({
    data: { branchId: branch.id, customerId: customer.id, jobId: jobA.id, invoiceNumber: "RC-" + tag, issuedAt: new Date("2026-09-10T04:00:00Z"), subtotalSen: 20000, discountSen: 0, totalSen: 20000 },
  });
  await db.invoiceItem.create({ data: { invoiceId: invA.id, description: "Recon Service", quantity: 1, unitPriceSen: 20000, lineTotalSen: 20000 } });
  await ledgerRow(mechA, "BASE", 1000, new Date("2026-09-10T04:00:00Z"), WINDOW);
  void itemA;

  // 工单 B：**历史工单**（P2 之前完工，台账里一行都没有）—— 不该被报成"未覆盖"
  const jobB = await db.serviceJob.create({
    data: {
      jobNumber: "RC-HIST-" + tag, branchId: branch.id, customerId: customer.id, motorcycleId: moto.id,
      mileage: 1000, mechanicId: mechA, status: "COMPLETED", completedAt: new Date("2026-08-01T04:00:00Z"),
    },
  });
  await db.serviceJobItem.create({
    data: { jobId: jobB.id, description: "Legacy Service", kind: "SERVICE", quantity: 1, unitPriceSen: 15000, lineTotalSen: 15000, status: "INCLUDED", source: "COUNTER" },
  });
});

afterAll(async () => {
  const jobs = await db.serviceJob.findMany({ where: { branchId }, select: { id: true } });
  for (const j of jobs) {
    const inv = await db.invoice.findFirst({ where: { jobId: j.id } });
    if (inv) {
      await db.payment.deleteMany({ where: { invoiceId: inv.id } });
      await db.invoiceItem.deleteMany({ where: { invoiceId: inv.id } });
      await db.invoice.delete({ where: { id: inv.id } });
    }
    await db.serviceJobItem.deleteMany({ where: { jobId: j.id } });
    await db.serviceJobPart.deleteMany({ where: { jobId: j.id } });
    await db.serviceReminder.deleteMany({ where: { jobId: j.id } });
    await db.serviceHistory.deleteMany({ where: { jobId: j.id } });
    await db.jobStatusHistory.deleteMany({ where: { jobId: j.id } });
    await db.serviceJob.delete({ where: { id: j.id } });
  }
  // 按**组织里的所有用户**删工资单：本文件里除了 A/B 还有一个临时用户（LEGACY 用例造的），
  // 只删 A/B 会让它的工资单残留下来、挡住后面的 user.deleteMany（第三次栽在同一类清理顺序上了）。
  const orgUserIds = (await db.user.findMany({ where: { organisationId: orgId }, select: { id: true } })).map((u) => u.id);
  await db.staffPayout.deleteMany({ where: { userId: { in: orgUserIds } } });
  await db.commissionLedger.deleteMany({ where: { organisationId: orgId } });
  const motos = await db.motorcycle.findMany({ where: { plate }, select: { id: true } });
  await db.serviceReminder.deleteMany({ where: { motorcycleId: { in: motos.map((m) => m.id) } } });
  await db.message.deleteMany({ where: { customerId } });
  await db.notification.deleteMany({ where: { customerId } });
  await db.motorcycle.deleteMany({ where: { plate } });
  await db.product.deleteMany({ where: { organisationId: orgId } });
  await db.customer.deleteMany({ where: { organisationId: orgId } });
  await db.user.deleteMany({ where: { organisationId: orgId } });
  await db.branch.deleteMany({ where: { organisationId: orgId } });
  await db.organisation.delete({ where: { id: orgId } });
});

describe("不变量 1：台账 == 工资单（P4 才真正成立）", () => {
  it("一致 → 通过，并且不给任何假警报", async () => {
    await payout(mechA, 1000, "PENDING");
    const r = await runCommissionReconciliation({ organisationId: orgId });
    const row = r.payoutDrift.find((d) => d.userName === "Recon A")!;
    expect(row.kind).toBe("MATCH");
    expect(row.diffSen).toBe(0);
    expect(r.hardFailures.filter((f) => f.includes("Recon A"))).toHaveLength(0);
  });

  it("未付款却有差额 → **判红**（这时候还能重算，不能就这么付了）", async () => {
    await db.staffPayout.updateMany({ where: { userId: mechA }, data: { commissionSen: 800, totalSen: 800 } });
    const r = await runCommissionReconciliation({ organisationId: orgId });
    expect(r.ok).toBe(false);
    expect(r.hardFailures.some((f) => f.includes("Recon A") && f.includes("未付款"))).toBe(true);
    await db.staffPayout.updateMany({ where: { userId: mechA }, data: { commissionSen: 1000, totalSen: 1000 } });
  });

  it("**已付款**却有差额 → 只提示不判红（金额已冻结，只能在下一期调整）", async () => {
    await db.staffPayout.updateMany({ where: { userId: mechA }, data: { status: "PAID", commissionSen: 800, totalSen: 800 } });
    const r = await runCommissionReconciliation({ organisationId: orgId });
    expect(r.hardFailures.some((f) => f.includes("Recon A"))).toBe(false);
    expect(r.notes.some((n) => n.includes("Recon A") && n.includes("下一期"))).toBe(true);
    await db.staffPayout.updateMany({ where: { userId: mechA }, data: { status: "PENDING", commissionSen: 1000, totalSen: 1000 } });
  });

  it("**迟到的计提**算在本周期（口径必须与结算一致，否则报假红）", async () => {
    // 8 月的工单 9 月完工：earnedAt 在 9 月，窗口键是 2026-08
    await ledgerRow(mechB, "BASE", 700, new Date("2026-09-05T04:00:00Z"), "2026-08");
    await payout(mechB, 700, "PENDING");
    const r = await runCommissionReconciliation({ organisationId: orgId });
    const row = r.payoutDrift.find((d) => d.userName === "Recon B")!;
    expect(row.kind).toBe("MATCH");
    expect(row.ledgerSen).toBe(700);
  });

  it("该周期没有台账 → 标 LEGACY，不判红（P2 之前的历史工资单就是这样）", async () => {
    const u = await db.user.create({ data: { organisationId: orgId, branchId, name: "Recon Legacy", email: "rl-" + tag + "@dsh.test", role: "MECHANIC" } });
    await payout(u.id, 4321, "PAID");
    const r = await runCommissionReconciliation({ organisationId: orgId });
    const row = r.payoutDrift.find((d) => d.userName === "Recon Legacy")!;
    expect(row.kind).toBe("LEGACY");
    expect(r.hardFailures.some((f) => f.includes("Recon Legacy"))).toBe(false);
  });
});

describe("不变量 3：佣金不得超过营业额", () => {
  it("台账 BASE 超过同期发票收入 → 判红", async () => {
    // 造一笔远超营业额（RM200）的佣金
    await ledgerRow(mechB, "BASE", 999999, new Date("2026-09-20T04:00:00Z"), WINDOW);
    const r = await runCommissionReconciliation({ windowKey: WINDOW, organisationId: orgId });
    expect(r.ok).toBe(false);
    expect(r.hardFailures.some((f) => f.includes(WINDOW) && f.includes("超过了该窗口发票收入"))).toBe(true);
    const w = r.windows.find((x) => x.windowKey === WINDOW)!;
    expect(w.revenueSen).toBe(20000);
    expect(w.ratioPct! > 100).toBe(true);
  });
});

describe("零件行也要覆盖（P4b）", () => {
  it("开关打开：有价格的零件行没有台账 → 出现在未覆盖清单", async () => {
    // **自带台账行的独立工单**：覆盖检查只处理"台账里出现过的工单"（没有台账的算历史工单，
    // 按设计不重算）。本文件顶部夹具的台账行是为"结算对比"写的、**没有 jobId**，
    // 所以这里另造一张，否则零件根本进不了检查（第一次就是这么写的，断言拿到 0）。
    const product = await db.product.create({
      data: { organisationId: orgId, name: "Recon Filter " + tag, sku: "RF-" + tag, sellPriceSen: 2500, costPriceSen: 1500, category: "FILTER" },
    });
    const jobNumber = "RC-PART-" + tag;
    const moto = await db.motorcycle.findFirst({ where: { plate } });
    const job = await db.serviceJob.create({
      data: {
        jobNumber, branchId, customerId, motorcycleId: moto!.id, mileage: 2000, mechanicId: mechA,
        status: "COMPLETED", completedAt: new Date("2026-09-12T04:00:00Z"),
      },
    });
    await db.serviceJobItem.create({
      data: { jobId: job.id, description: "Part Coverage Service", kind: "SERVICE", quantity: 1, unitPriceSen: 6000, lineTotalSen: 6000, status: "INCLUDED", source: "COUNTER" },
    });
    await ledgerRow(mechA, "BASE", 300, new Date("2026-09-12T04:00:00Z"), WINDOW, job.id);
    // 有价格的零件行 —— 故意**不给它写台账**，它必须被报出来
    await db.serviceJobPart.create({
      data: {
        jobId: job.id, productId: product.id, quantity: 1, unitCostSen: 1500,
        unitPriceSen: 2500, lineTotalSen: 2500, status: "ACCEPTED", source: "COUNTER",
      },
    });
    const r = await runCommissionReconciliation({ organisationId: orgId });
    expect(r.stats.billablePartLines).toBe(1);
    expect(r.stats.uncoveredParts).toHaveLength(1);
    expect(r.stats.uncoveredParts[0]).toContain(jobNumber);
  });

  it("开关关闭：零件行**完全不检查**（否则就是误报，而误报会让真报告失效）", async () => {
    await db.organisation.update({ where: { id: orgId }, data: { commissionOnParts: false } });
    const r = await runCommissionReconciliation({ organisationId: orgId });
    expect(r.stats.billablePartLines).toBe(0);
    expect(r.stats.uncoveredParts).toHaveLength(0);
    expect(r.hardFailures.some((f) => /零件/.test(f))).toBe(false);
    await db.organisation.update({ where: { id: orgId }, data: { commissionOnParts: true } });
  });
});

describe("不变量 2：历史工单与配置缺口要分开", () => {
  it("历史工单（无台账）计入 historicalLines，**不算未覆盖**", async () => {
    const r = await runCommissionReconciliation({ organisationId: orgId });
    expect(r.stats.historicalLines).toBeGreaterThanOrEqual(1);
    expect(r.stats.historicalJobs).toContain("RC-HIST-" + tag);
    expect(r.stats.uncovered.some((u) => u.includes("Legacy Service"))).toBe(false);
  });
});
