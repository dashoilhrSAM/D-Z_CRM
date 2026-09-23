// 完整链路的端到端断言（P3 收尾）：**配置 → 真的卖够件数 → 计提 → 面板可领取 → 领取 → 台账**。
//
// 为什么必须走真实完工，而不是手工插几条台账行：手工插验证的是「我插的数据能被数出来」，
// 而不是「**卖出去的东西**能被数出来」。中间隔着计提、作用域身份、件数口径、窗口归属四道关，
// 任何一道错了都不会报错，只会让面板上那个数字不对 —— 而数字不对在工资里就是钱不对。
//
// 这条测试就是老板在界面上建了一个目标之后，系统承诺会发生的事情。
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const saved = { databaseUrl: process.env.DATABASE_URL };
const tag = "k" + Date.now().toString(36);
const plate = ("K" + tag.slice(-4) + Math.random().toString(36).slice(2, 4)).toUpperCase();

let db: typeof import("@/lib/db")["db"];
let completionService: typeof import("@/services/completion")["completionService"];
let tierPanelFor: typeof import("@/modules/commission/claim")["tierPanelFor"];
let claimTierFor: typeof import("@/modules/commission/claim")["claimTierFor"];

let orgId = "";
let mechId = "";
let tierSetId = "";
let tierId = "";
const jobIds: string[] = [];
const ORG = () => orgId;

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  ({ db } = await import("@/lib/db"));
  ({ completionService } = await import("@/services/completion"));
  ({ tierPanelFor, claimTierFor } = await import("@/modules/commission/claim"));

  const org = await db.organisation.create({ data: { name: "COMM-CHAIN-" + tag } });
  orgId = org.id;
  const branch = await db.branch.create({ data: { organisationId: org.id, name: "Chain Branch", city: "Petaling Jaya" } });
  const mech = await db.user.create({
    data: { organisationId: org.id, branchId: branch.id, name: "Chain Mechanic", email: "chain-" + tag + "@dsh.test", role: "MECHANIC" },
  });
  mechId = mech.id;
  const customer = await db.customer.create({ data: { organisationId: org.id, name: "Chain Customer " + tag } });
  const moto = await db.motorcycle.create({
    data: { customerId: customer.id, plate, brand: "Test", model: "Chain Bike", year: 2020, currentMileage: 5000 },
  });

  // 商品（机油）与基础规则：5% —— 与生产上那个目标同一个形状
  const product = await db.product.create({
    data: { organisationId: org.id, name: "Chain Oil 10W-40 " + tag, sku: "CHAIN-" + tag, sellPriceSen: 3800, costPriceSen: 2500, category: "ENGINE_OIL" },
  });
  await db.commissionRule.create({
    data: { organisationId: org.id, scope: "DEFAULT", basis: "PERCENT", value: 500, effectiveFrom: new Date("2020-01-01T00:00:00Z") },
  });

  // **老板在界面上建的那个目标**：这个商品，满 10 件 → 一次性 RM50
  const set = await db.commissionTierSet.create({
    data: {
      organisationId: org.id, name: "Chain Oil: buy 10 get bonus", scope: "PRODUCT", targetId: product.id,
      windowKind: "MONTH", countUnit: "ITEM_QTY", rewardKind: "ONE_OFF_FIXED", retroactive: true,
      effectiveFrom: new Date("2020-01-01T00:00:00Z"),
      tiers: { create: [{ thresholdQty: 10, rewardValue: 5000 }] },
    },
    include: { tiers: true },
  });
  tierSetId = set.id;
  tierId = set.tiers[0].id;

  // 一单卖 10 件（柜台真的这么卖才会有的工单）
  const job = await db.serviceJob.create({
    data: {
      jobNumber: "CHAIN-" + tag, branchId: branch.id, customerId: customer.id, motorcycleId: moto.id,
      mileage: 5000, mechanicId: mech.id, status: "READY",
    },
  });
  jobIds.push(job.id);
  await db.serviceJobItem.create({
    data: {
      jobId: job.id, description: "Chain Oil 10W-40 x10", kind: "PART",
      productId: product.id, quantity: 10, unitPriceSen: 3800, lineTotalSen: 38000,
      status: "INCLUDED", source: "COUNTER",
    },
  });
});

afterAll(async () => {
  await db.commissionClaim.deleteMany({ where: { organisationId: ORG() } });
  await db.commissionLedger.deleteMany({ where: { organisationId: ORG() } });
  await db.commissionTierSet.deleteMany({ where: { organisationId: ORG() } });
  await db.commissionRule.deleteMany({ where: { organisationId: ORG() } });
  // 商品必须在**工单行之后**删：ServiceJobItem.productId 指向它（第一版顺序写反了，
  // 结果是 5 条断言全绿、清理却抛外键错误 —— "测试通过 ≠ 测试干净"）
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
    await db.review.deleteMany({ where: { jobId: id } });
    await db.notification.deleteMany({ where: { body: { contains: id } } });
    await db.serviceJob.delete({ where: { id: id } });
  }
  await db.product.deleteMany({ where: { organisationId: ORG() } });
  const customerIds = (await db.customer.findMany({ where: { organisationId: ORG() }, select: { id: true } })).map((c) => c.id);
  await db.message.deleteMany({ where: { customerId: { in: customerIds } } });
  await db.notification.deleteMany({ where: { customerId: { in: customerIds } } });
  await db.loyaltyTransaction.deleteMany({ where: { account: { customerId: { in: customerIds } } } });
  await db.loyaltyAccount.deleteMany({ where: { organisationId: ORG() } });
  // 完工流程还会建 ServiceReminder（挂在摩托车上）—— 漏掉它，删摩托车就会撞外键
  const motos = await db.motorcycle.findMany({ where: { plate }, select: { id: true } });
  await db.serviceReminder.deleteMany({ where: { motorcycleId: { in: motos.map((m) => m.id) } } });
  await db.motorcycle.deleteMany({ where: { plate } });
  await db.customer.deleteMany({ where: { organisationId: ORG() } });
  await db.user.deleteMany({ where: { organisationId: ORG() } });
  await db.branch.deleteMany({ where: { organisationId: ORG() } });
  await db.organisation.delete({ where: { id: ORG() } });
});

const WINDOW = () => new Date().toISOString().slice(0, 7); // 当前窗口（按 MYT 的月初是同一件事，这里只用于展示）

describe("链路第 1 步：卖出去 → 完工 → 计提（带作用域身份）", () => {
  it("完工后台账里有一条 BASE，件数 10，且**记着这是哪个商品**", async () => {
    const result = await completionService.complete(jobIds[0]);
    expect(result.commissionAccruedSen).toBe(1900); // 38000 × 5%

    const rows = await db.commissionLedger.findMany({ where: { jobId: jobIds[0] } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "BASE", qty: 10, amountSen: 1900, baseSen: 38000 });
    // 这三列就是阶梯统计的"身份证"：件数要按作用域统计，就必须知道这一行是什么
    expect(rows[0].productId).toBeTruthy();
    expect(rows[0].category).toBe("ENGINE_OIL");
  });
});

describe("链路第 2 步：阶梯自己数出来", () => {
  it("面板显示「10 / 10 件」并给出可领取（金额 = 配置的 RM50）", async () => {
    const panel = await tierPanelFor(orgId, mechId);
    expect(panel.windowKey).toBe(WINDOW());
    const set = panel.sets.find((s) => s.tierSetId === tierSetId);
    expect(set, "刚建的组合应该出现在面板上").toBeTruthy();
    expect(set!.units).toBe(10);
    expect(set!.tiers[0].claimable).toBe(true);
    expect(set!.tiers[0].amountSen).toBe(5000);
    expect(panel.claimableTotalSen).toBe(5000);
  });
});

describe("链路第 3 步：领取 → 台账里多一条 TIER_BONUS", () => {
  it("领取写入 claim + TIER_BONUS，金额与面板一致，并记下当时的件数", async () => {
    const res = await claimTierFor(orgId, mechId, { tierSetId, tierId });
    expect(res.ok).toBe(true);
    expect(res.amountSen).toBe(5000);

    const bonus = await db.commissionLedger.findMany({ where: { organisationId: orgId, userId: mechId, kind: "TIER_BONUS" } });
    expect(bonus).toHaveLength(1);
    expect(bonus[0].amountSen).toBe(5000);

    const claim = await db.commissionClaim.findFirst({ where: { organisationId: orgId, userId: mechId, tierId } });
    expect(claim?.ledgerId).toBe(bonus[0].id);
    expect(claim?.claimedQty).toBe(10);
  });

  it("再领一次被拒，台账不增加", async () => {
    const again = await claimTierFor(orgId, mechId, { tierSetId, tierId });
    expect(again.ok).toBe(false);
    expect(await db.commissionLedger.count({ where: { organisationId: orgId, kind: "TIER_BONUS" } })).toBe(1);
  });

  it("面板随之变空，并在历史里留下这一条（含窗口）", async () => {
    const panel = await tierPanelFor(orgId, mechId);
    expect(panel.claimableTotalSen).toBe(0);
    expect(panel.history.some((h) => h.amountSen === 5000)).toBe(true);
    expect(panel.history[0].windowKey).toBe(WINDOW());
    expect(panel.history[0].tierSetName).toContain("Chain Oil");
  });
});
