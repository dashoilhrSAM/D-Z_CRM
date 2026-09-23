// 完工路径的端到端断言（P2 交付时刻意留下的那个缺口）。
//
// 为什么必须补：引擎自己有测试、接线只有一行、且那一行在既有事务里 —— 但这三件事加起来
// **不等于验证过**。真实风险是"接线对了但顺序错了"（比如发票还没建就计提，于是基数拿不到），
// 这种错在单测里看不见，只有真的跑一次 CompletionService.complete 才会暴露。
//
// 这条测试走的是真实完工流程（开票、库存、忠诚度、提醒、服务历史全都跑），只断言与佣金有关的部分。
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const saved = { databaseUrl: process.env.DATABASE_URL };
const tag = "e" + Date.now().toString(36);
// 车牌要**每次运行都不同**：base36 时间戳的前 6 位几小时内都不变，只取前 6 位会让几分钟后的
// 下一次运行撞上残留数据（本用例第一次跑就是这么挂的）。取尾段 + 随机后缀。
const plate = ("E" + tag.slice(-4) + Math.random().toString(36).slice(2, 4)).toUpperCase();

let db: typeof import("@/lib/db")["db"];
let completionService: typeof import("@/services/completion")["completionService"];
let orgId = "";
const jobIds: string[] = [];

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  ({ db } = await import("@/lib/db"));
  ({ completionService } = await import("@/services/completion"));

  const org = await db.organisation.create({ data: { name: "COMM-E2E-" + tag } });
  orgId = org.id;
  const branch = await db.branch.create({ data: { organisationId: org.id, name: "E2E Branch", city: "Petaling Jaya" } });
  const mech = await db.user.create({
    data: { organisationId: org.id, branchId: branch.id, name: "E2E Mechanic", email: "e2e-" + tag + "@dsh.test", role: "MECHANIC" },
  });
  const customer = await db.customer.create({ data: { organisationId: org.id, name: "E2E Customer " + tag } });
  const moto = await db.motorcycle.create({
    data: { customerId: customer.id, plate, brand: "Test", model: "E2E Bike", year: 2021, currentMileage: 1000 },
  });
  await db.commissionRule.create({
    data: { organisationId: org.id, scope: "DEFAULT", basis: "PERCENT", value: 500, effectiveFrom: new Date("2020-01-01T00:00:00Z") },
  });

  // 工单 A：有技师，一条计费行(90.00) + 一条免费行
  const jobA = await db.serviceJob.create({
    data: {
      jobNumber: "E2E-A-" + tag, branchId: branch.id, customerId: customer.id, motorcycleId: moto.id,
      mileage: 1000, mechanicId: mech.id, status: "READY",
    },
  });
  jobIds.push(jobA.id);
  await db.serviceJobItem.create({ data: { jobId: jobA.id, description: "Engine Oil Change", kind: "SERVICE", quantity: 1, unitPriceSen: 9000, lineTotalSen: 9000, status: "INCLUDED", source: "COUNTER" } });
  await db.serviceJobItem.create({ data: { jobId: jobA.id, description: "Free 20-point check", kind: "SERVICE", quantity: 1, unitPriceSen: 0, lineTotalSen: 0, status: "INCLUDED", source: "COUNTER" } });

  // 工单 B：**没有技师**（完工时应当写 PENDING 而不是静默 0）
  const jobB = await db.serviceJob.create({
    data: {
      jobNumber: "E2E-B-" + tag, branchId: branch.id, customerId: customer.id, motorcycleId: moto.id,
      mileage: 1000, status: "READY",
    },
  });
  jobIds.push(jobB.id);
  await db.serviceJobItem.create({ data: { jobId: jobB.id, description: "Tyre Replacement", kind: "SERVICE", quantity: 1, unitPriceSen: 7500, lineTotalSen: 7500, status: "INCLUDED", source: "COUNTER" } });
});

afterAll(async () => {
  await db.commissionLedger.deleteMany({ where: { organisationId: orgId } });
  await db.commissionRule.deleteMany({ where: { organisationId: orgId } });
  for (const id of jobIds) {
    const inv = await db.invoice.findFirst({ where: { jobId: id } });
    if (inv) {
      await db.payment.deleteMany({ where: { invoiceId: inv.id } });
      await db.invoiceItem.deleteMany({ where: { invoiceId: inv.id } });
      await db.invoice.delete({ where: { id: inv.id } });
    }
    await db.serviceJobItem.deleteMany({ where: { jobId: id } });
    await db.serviceHistory.deleteMany({ where: { jobId: id } });
    await db.jobStatusHistory.deleteMany({ where: { jobId: id } });
    // 完工流程还会开 Review 与 Notification（都挂在 customerId 上）——不删它们，最后删客户时会撞外键。
    await db.review.deleteMany({ where: { jobId: id } });
    await db.notification.deleteMany({ where: { body: { contains: id } } });
    await db.serviceJob.delete({ where: { id } });
  }
  await db.loyaltyTransaction.deleteMany({ where: { account: { customerId: { in: (await db.customer.findMany({ where: { organisationId: orgId }, select: { id: true } })).map((c) => c.id) } } } });
  await db.loyaltyAccount.deleteMany({ where: { organisationId: orgId } });
  const customerIds = (await db.customer.findMany({ where: { organisationId: orgId }, select: { id: true } })).map((c) => c.id);
  // 完工后会真的发一条完成通知（messaging 模块落 Message 行）——这些也挂在客户上。
  await db.message.deleteMany({ where: { customerId: { in: customerIds } } });
  await db.notification.deleteMany({ where: { customerId: { in: customerIds } } });
  await db.review.deleteMany({ where: { customerId: { in: customerIds } } });
  await db.serviceReminder.deleteMany({ where: { customerId: { in: customerIds } } });
  await db.motorcycle.deleteMany({ where: { plate } });
  await db.customer.deleteMany({ where: { organisationId: orgId } });
  await db.user.deleteMany({ where: { organisationId: orgId } });
  await db.branch.deleteMany({ where: { organisationId: orgId } });
  await db.organisation.delete({ where: { id: orgId } });
});

describe("完工流程（工单 A：有技师 + 免费行）", () => {
  it("走完真实完工流程后：发票建立、台账有且只有一条 BASE、金额与返回一致", async () => {
    const result = await completionService.complete(jobIds[0]);

    // 发票（完工本来就该开的）
    expect(result.invoiceNumber).toMatch(/^DZ-\d{4}-\d{5}$/);
    const job = await db.serviceJob.findUnique({ where: { id: jobIds[0] }, include: { invoice: true } });
    expect(job?.status).toBe("COMPLETED");
    expect(job?.invoice).not.toBeNull();

    // 佣金：9000 × 5% = 450（这张工单没有折扣）
    const rows = await db.commissionLedger.findMany({ where: { jobId: jobIds[0] } });
    expect(rows).toHaveLength(1); // 免费行不产生任何台账行
    expect(rows[0]).toMatchObject({ kind: "BASE", amountSen: 450, baseSen: 9000, basis: "PERCENT" });
    expect(rows[0].invoiceId).toBe(job?.invoice?.id); // 基数确实来自这张发票
    expect(result.commissionAccruedSen).toBe(450);
  });

  it("**再完工一次**（幂等路径）：不产生第二条台账，返回的金额读自台账而不是重算", async () => {
    const before = await db.commissionLedger.count({ where: { jobId: jobIds[0] } });
    const again = await completionService.complete(jobIds[0]);
    const after = await db.commissionLedger.count({ where: { jobId: jobIds[0] } });
    expect(after).toBe(before);
    expect(again.commissionAccruedSen).toBe(450);
  });
});

describe("完工流程（工单 B：没有技师）", () => {
  it("写 PENDING 行（金额 0 + 原因），不静默算 0", async () => {
    const result = await completionService.complete(jobIds[1]);
    expect(result.commissionAccruedSen).toBe(0);
    const rows = await db.commissionLedger.findMany({ where: { jobId: jobIds[1] } });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("PENDING");
    expect(rows[0].amountSen).toBe(0);
    expect(rows[0].reason).toContain("no mechanic");
  });
});
