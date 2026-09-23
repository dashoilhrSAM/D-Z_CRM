// 阶梯领取的真库测试（P3 下半）。
//
// 幂等与"只能领一次"只能这样验证：**在真库上撞唯一键**。纯函数测不出"第二条插不进去"。
// 这条测试同时钉住两件容易被写反的事：
//  ① 可领取状态是**推导**出来的（不存状态字段）：领完之后面板必须自己变空；
//  ② 领取是 TIER_BONUS 台账的**唯一入口**（自动补发走的是同一套判定）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { previousWindowKey, windowKeyFor } from "@/lib/commission/tiers";

const saved = { databaseUrl: process.env.DATABASE_URL };
const tag = "c" + Date.now().toString(36);
const plate = ("C" + tag.slice(-4) + Math.random().toString(36).slice(2, 4)).toUpperCase();

let db: typeof import("@/lib/db")["db"];
let tierPanelFor: typeof import("@/modules/commission/claim")["tierPanelFor"];
let claimTierFor: typeof import("@/modules/commission/claim")["claimTierFor"];
let autoGrantExpiredTiers: typeof import("@/modules/commission/auto-grant")["autoGrantExpiredTiers"];

let orgId = "";
let mechA = "";
let mechB = "";
let tierSetId = "";
let tier10 = "";
let productId = "";
const NOW = new Date("2026-09-15T04:00:00Z");
const WINDOW = windowKeyFor("MONTH", NOW);
const PREV = previousWindowKey(WINDOW);

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  ({ db } = await import("@/lib/db"));
  ({ tierPanelFor, claimTierFor } = await import("@/modules/commission/claim"));
  ({ autoGrantExpiredTiers } = await import("@/modules/commission/auto-grant"));

  const org = await db.organisation.create({ data: { name: "COMM-CLAIM-" + tag } });
  orgId = org.id;
  const branch = await db.branch.create({ data: { organisationId: org.id, name: "Claim Branch", city: "Petaling Jaya" } });
  const a = await db.user.create({ data: { organisationId: org.id, branchId: branch.id, name: "Claim Mech A", email: "a-" + tag + "@dsh.test", role: "MECHANIC" } });
  const b = await db.user.create({ data: { organisationId: org.id, branchId: branch.id, name: "Claim Mech B", email: "b-" + tag + "@dsh.test", role: "MECHANIC" } });
  mechA = a.id;
  mechB = b.id;
  const customer = await db.customer.create({ data: { organisationId: org.id, name: "Claim Customer " + tag } });
  await db.motorcycle.create({ data: { customerId: customer.id, plate, brand: "Test", model: "Claim Bike", year: 2020 } });
  const product = await db.product.create({ data: { organisationId: org.id, name: "Claim Oil " + tag, sku: "OIL-" + tag, sellPriceSen: 5000, costPriceSen: 3000, category: "OIL" } });
  productId = product.id;

  const set = await db.commissionTierSet.create({
    data: {
      organisationId: org.id, name: "Buy 10 get bonus", scope: "PRODUCT", targetId: product.id,
      windowKind: "MONTH", countUnit: "ITEM_QTY", rewardKind: "ONE_OFF_FIXED", retroactive: true,
      effectiveFrom: new Date("2020-01-01T00:00:00Z"),
      tiers: { create: [{ thresholdQty: 10, rewardValue: 5000 }, { thresholdQty: 20, rewardValue: 12000 }] },
    },
    include: { tiers: true },
  });
  tierSetId = set.id;
  tier10 = set.tiers.find((t) => t.thresholdQty === 10)!.id;

  // 技师 A 在本窗口卖满 10 件（直接写台账行：件数从台账推导，这里就是"已经攒够"）
  for (let i = 0; i < 10; i++) {
    await db.commissionLedger.create({
      data: {
        organisationId: org.id, userId: mechA, kind: "BASE", amountSen: 250, basis: "PERCENT",
        baseSen: 5000, qty: 1, productId: product.id, category: "OIL",
        earnedAt: new Date(2026, 8, 2 + i, 3, 0, 0), windowKey: WINDOW,
      },
    });
  }
  // 技师 B 只卖了 9 件（差一件，不该可领）
  for (let i = 0; i < 9; i++) {
    await db.commissionLedger.create({
      data: {
        organisationId: org.id, userId: mechB, kind: "BASE", amountSen: 250, basis: "PERCENT",
        baseSen: 5000, qty: 1, productId: product.id, category: "OIL",
        earnedAt: new Date(2026, 8, 2 + i, 3, 30, 0), windowKey: WINDOW,
      },
    });
  }
  // 上一个窗口：A 也攒满了 10 件但没领（用于验证自动补发）
  for (let i = 0; i < 10; i++) {
    await db.commissionLedger.create({
      data: {
        organisationId: org.id, userId: mechA, kind: "BASE", amountSen: 250, basis: "PERCENT",
        baseSen: 5000, qty: 1, productId: product.id, category: "OIL",
        earnedAt: new Date(2026, 7, 5 + i, 3, 0, 0), windowKey: PREV,
      },
    });
  }
});

afterAll(async () => {
  await db.commissionLedger.deleteMany({ where: { organisationId: orgId } });
  await db.commissionClaim.deleteMany({ where: { organisationId: orgId } });
  await db.commissionTierSet.deleteMany({ where: { organisationId: orgId } });
  await db.commissionRule.deleteMany({ where: { organisationId: orgId } });
  await db.product.deleteMany({ where: { organisationId: orgId } });
  await db.motorcycle.deleteMany({ where: { plate } });
  await db.customer.deleteMany({ where: { organisationId: orgId } });
  await db.user.deleteMany({ where: { organisationId: orgId } });
  await db.branch.deleteMany({ where: { organisationId: orgId } });
  await db.organisation.delete({ where: { id: orgId } });
});

describe("面板：可领取状态是推导出来的", () => {
  it("攒够 10 件的技师看到可领取（含金额与进度）", async () => {
    const panel = await tierPanelFor(orgId, mechA, NOW);
    expect(panel.windowKey).toBe(WINDOW);
    const set = panel.sets.find((s) => s.tierSetId === tierSetId)!;
    expect(set.units).toBe(10);
    expect(panel.claimableTotalSen).toBe(5000);
    const t = set.tiers.find((x) => x.tierId === tier10)!;
    expect(t.claimable).toBe(true);
    expect(t.amountSen).toBe(5000);
    expect(t.triggerRowId).toBeTruthy();
    expect(set.nextTier?.thresholdQty).toBe(20);
  });

  it("**未达标时显示配置值，而不是 RM0**（生产上就是这么露出来的）", async () => {
    // bug 现场：面板上写着「满 10 件 · RM0」——技师会以为这奖励一文不值。
    // 原因是我把「实际会发的数」与「配置里写的数」混成了一个字段，未达标时回落成 0。
    // 这条测试把两种口径钉死：amountSen 只在可领取时有值，否则必须是 null，
    // 界面据此回退到 rewardValue（配置值）。
    const panel = await tierPanelFor(orgId, mechB, NOW);
    const tier = panel.sets.find((s) => s.tierSetId === tierSetId)!.tiers.find((x) => x.tierId === tier10)!;
    expect(tier.claimable).toBe(false);
    expect(tier.amountSen).toBeNull();
    expect(tier.rewardValue).toBe(5000);
  });

  it("只卖 9 件的技师什么都领不到（差一件就是差一件）", async () => {
    const panel = await tierPanelFor(orgId, mechB, NOW);
    expect(panel.claimableTotalSen).toBe(0);
    expect(panel.sets.find((s) => s.tierSetId === tierSetId)!.tiers.every((t) => !t.claimable)).toBe(true);
  });
});

describe("领取：TIER_BONUS 台账的唯一入口", () => {
  it("领取写入 claim + 唯一一条 TIER_BONUS，金额与面板一致", async () => {
    const res = await claimTierFor(orgId, mechA, { tierSetId, tierId: tier10 }, NOW);
    expect(res.ok).toBe(true);
    expect(res.amountSen).toBe(5000);

    const claims = await db.commissionClaim.findMany({ where: { organisationId: orgId, userId: mechA, windowKey: WINDOW } });
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ tierId: tier10, claimedQty: 10, amountSen: 5000 });

    const bonus = await db.commissionLedger.findMany({ where: { organisationId: orgId, userId: mechA, kind: "TIER_BONUS" } });
    expect(bonus).toHaveLength(1);
    expect(bonus[0].amountSen).toBe(5000);
    expect(claims[0].ledgerId).toBe(bonus[0].id); // 两边互相指得上
  });

  it("**再领一次被拒**，且不产生第二条台账", async () => {
    const before = await db.commissionLedger.count({ where: { organisationId: orgId, userId: mechA, kind: "TIER_BONUS" } });
    const again = await claimTierFor(orgId, mechA, { tierSetId, tierId: tier10 }, NOW);
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/not claimable|Already/i);
    const after = await db.commissionLedger.count({ where: { organisationId: orgId, userId: mechA, kind: "TIER_BONUS" } });
    expect(after).toBe(before);
  });

  it("领完之后面板自己变空（没有「状态字段」需要维护）", async () => {
    const panel = await tierPanelFor(orgId, mechA, NOW);
    expect(panel.claimableTotalSen).toBe(0);
    const t = panel.sets.find((s) => s.tierSetId === tierSetId)!.tiers.find((x) => x.tierId === tier10)!;
    expect(t.claimed).toBe(true);
    expect(t.claimable).toBe(false);
    expect(panel.history.some((h) => h.amountSen === 5000)).toBe(true);
  });

  it("不能替别人领：换一个人来领，判定结果不同（B 还没达标）", async () => {
    const res = await claimTierFor(orgId, mechB, { tierSetId, tierId: tier10 }, NOW);
    expect(res.ok).toBe(false);
  });
});

describe("窗口结束的自动补发（设计稿方案甲）", () => {
  it("上一个窗口未领取的会补发，并写进那个窗口", async () => {
    const res = await autoGrantExpiredTiers({ organisationId: orgId, now: NOW });
    expect(res.windowKey).toBe(PREV);
    expect(res.granted).toBe(1);
    expect(res.totalSen).toBe(5000);

    const row = await db.commissionLedger.findFirst({ where: { organisationId: orgId, userId: mechA, kind: "TIER_BONUS", windowKey: PREV } });
    expect(row?.amountSen).toBe(5000);
    expect(row?.reason).toContain("auto-granted");
  });

  it("再跑一次不会重复补发（唯一键兜住）", async () => {
    const res = await autoGrantExpiredTiers({ organisationId: orgId, now: NOW });
    expect(res.granted).toBe(0);
    const rows = await db.commissionLedger.findMany({ where: { organisationId: orgId, userId: mechA, kind: "TIER_BONUS", windowKey: PREV } });
    expect(rows).toHaveLength(1);
  });

  it("自动补发不会误伤当前窗口（当前窗口的奖励仍等技师自己领）", async () => {
    const claims = await db.commissionClaim.findMany({ where: { organisationId: orgId, windowKey: WINDOW } });
    expect(claims.every((c) => c.windowKey === WINDOW)).toBe(true);
  });
});
