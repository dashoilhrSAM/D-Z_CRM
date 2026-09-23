// 阶梯的边界测试（P3）。设计稿 §9 点名要覆盖的：9/10/11 件、并发达档、跨窗口重置。
//
// 这些数字背后是"钱归谁"的问题，而不是算术练习。所以除了"算得对"，还要断言两件更容易被忽略的事：
//  ① 同一毫秒的两单也必须有**唯一且可复现**的归属（否则两个技师会扯皮）；
//  ② 跨窗口必须天然重置（不靠定时任务清零——那是这类系统最经典的事故源）。
import { describe, expect, it } from "vitest";
import {
  avgUnitCommission,
  claimableTiers,
  countUnits,
  evaluateTierSet,
  qualifyingRows,
  rewardAmount,
  rowMatchesScope,
  windowKeyFor,
  type LedgerUnitLike,
  type TierLike,
  type TierSetLike,
} from "@/lib/commission/tiers";

const W = "2026-09";

function row(over: Partial<LedgerUnitLike> & { id: string }): LedgerUnitLike {
  return {
    userId: "mech-1",
    kind: "BASE",
    qty: 1,
    amountSen: 1000,
    windowKey: W,
    earnedAt: new Date("2026-09-10T02:00:00Z"),
    productId: "oil",
    serviceTypeId: null,
    category: null,
    ...over,
  };
}

function set(over: Partial<TierSetLike> = {}): TierSetLike {
  return {
    id: "set1",
    name: "Buy 10 get 2",
    scope: "PRODUCT",
    targetId: "oil",
    windowKind: "MONTH",
    countUnit: "ITEM_QTY",
    rewardKind: "ONE_OFF_FIXED",
    retroactive: true,
    active: true,
    effectiveFrom: new Date("2020-01-01T00:00:00Z"),
    effectiveTo: null,
    ...over,
  };
}

const TIERS: TierLike[] = [
  { id: "t10", tierSetId: "set1", thresholdQty: 10, rewardValue: 5000 },
  { id: "t20", tierSetId: "set1", thresholdQty: 20, rewardValue: 12000 },
];

const rowsN = (n: number) => Array.from({ length: n }, (_, i) => row({ id: "r" + String(i + 1).padStart(2, "0") }));

describe("边界 9 / 10 / 11 件", () => {
  it("9 件：没达档，进度 90%，还差 1 件", () => {
    const p = evaluateTierSet(rowsN(9), set(), TIERS, "mech-1", W);
    expect(p.units).toBe(9);
    expect(p.achievements).toHaveLength(0);
    expect(p.nextTier?.id).toBe("t10");
    expect(p.remaining).toBe(1);
    expect(p.progressPct).toBe(90);
  });

  it("10 件：达第一档，且**触发者是第 10 条台账行**", () => {
    const p = evaluateTierSet(rowsN(10), set(), TIERS, "mech-1", W);
    expect(p.units).toBe(10);
    expect(p.achievements.map((a) => a.tier.id)).toEqual(["t10"]);
    expect(p.achievements[0].triggerRowId).toBe("r10");
    expect(p.nextTier?.id).toBe("t20");
  });

  it("11 件：仍然只达第一档（第二档 20 件）", () => {
    const p = evaluateTierSet(rowsN(11), set(), TIERS, "mech-1", W);
    expect(p.achievements.map((a) => a.tier.id)).toEqual(["t10"]);
    expect(p.remaining).toBe(9);
  });
});

describe("并发下的「第 10 件归谁」必须唯一且可复现", () => {
  it("同一毫秒的两单：按 id 兜底，结果与输入顺序无关", () => {
    const same = new Date("2026-09-10T02:00:00.000Z");
    const rows = [...rowsN(9), row({ id: "zzz", earnedAt: same }), row({ id: "aaa", earnedAt: same })];
    const p1 = evaluateTierSet(rows, set(), TIERS, "mech-1", W);
    const p2 = evaluateTierSet([...rows].reverse(), set(), TIERS, "mech-1", W);
    expect(p1.units).toBe(11);
    // 第 10 件是 r09 之后的**先按时间、再按 id** 的那一条 —— aaa < zzz
    expect(p1.achievements[0].triggerRowId).toBe("r09");
    expect(p2.achievements[0].triggerRowId).toBe("r09");
    // 换一种构造：前 9 条同毫秒、第 10 条迟到一秒 → 触发者应当是那一条迟到的
    const withLate = [...rowsN(9).map((r) => row({ id: r.id, earnedAt: same })), row({ id: "late", earnedAt: new Date(same.getTime() + 1000) })];
    expect(evaluateTierSet(withLate, set(), TIERS, "mech-1", W).achievements[0].triggerRowId).toBe("late");
  });
});

describe("跨窗口天然重置（不靠定时任务清零）", () => {
  it("上个月的件数不计入本月", () => {
    const rows = [...rowsN(9), row({ id: "oct-1", windowKey: "2026-10" }), row({ id: "oct-2", windowKey: "2026-10" })];
    const p = evaluateTierSet(rows, set(), TIERS, "mech-1", W);
    expect(p.units).toBe(9); // 10 月那两条不算
    expect(p.achievements).toHaveLength(0);
    expect(evaluateTierSet(rows, set(), TIERS, "mech-1", "2026-10").units).toBe(2);
  });

  it("别人的件数不算我的", () => {
    const rows = [...rowsN(9), row({ id: "other", userId: "mech-2" })];
    expect(evaluateTierSet(rows, set(), TIERS, "mech-1", W).units).toBe(9);
  });

  it("PENDING / LEGACY / ADJUSTMENT 都不算「卖出一件」", () => {
    const rows = [
      ...rowsN(9),
      row({ id: "p", kind: "PENDING" }),
      row({ id: "l", kind: "LEGACY" }),
      row({ id: "a", kind: "ADJUSTMENT", amountSen: 500 }),
    ];
    expect(evaluateTierSet(rows, set(), TIERS, "mech-1", W).units).toBe(9);
  });
});

describe("作用域：单 SKU / 单个服务 / 一个分类 / 全店", () => {
  const rows = [
    row({ id: "p1", productId: "oil", serviceTypeId: "s-oil", category: "OIL" }),
    row({ id: "p2", productId: "filter", serviceTypeId: "s-oil", category: "FILTER" }),
    row({ id: "p3", productId: null, serviceTypeId: "s-tyre", category: "TYRE" }),
  ];

  it("PRODUCT 按商品匹配", () => {
    expect(qualifyingRows(rows, set({ scope: "PRODUCT", targetId: "oil" }), "mech-1", W).map((r) => r.id)).toEqual(["p1"]);
  });
  it("SERVICE 按服务匹配", () => {
    expect(qualifyingRows(rows, set({ scope: "SERVICE", targetId: "s-oil" }), "mech-1", W).map((r) => r.id)).toEqual(["p1", "p2"]);
  });
  it("CATEGORY 按分类匹配", () => {
    expect(qualifyingRows(rows, set({ scope: "CATEGORY", targetId: "TYRE" }), "mech-1", W).map((r) => r.id)).toEqual(["p3"]);
  });
  it("ALL 全店统计", () => {
    expect(qualifyingRows(rows, set({ scope: "ALL", targetId: null }), "mech-1", W)).toHaveLength(3);
  });
  it("缺身份证的行不会被错算进某个具体作用域（只能进 ALL）", () => {
    const orphan = row({ id: "x", productId: null, serviceTypeId: null, category: null });
    expect(rowMatchesScope(orphan, set({ scope: "PRODUCT", targetId: "oil" }))).toBe(false);
    expect(rowMatchesScope(orphan, set({ scope: "ALL", targetId: null }))).toBe(true);
  });
});

describe("计件单位", () => {
  it("ITEM_QTY 按件数（qty 之和），LINE_COUNT 按行数", () => {
    const rows = [
      row({ id: "a", qty: 5 }),
      row({ id: "b", qty: 5 }),
      row({ id: "c", qty: 2 }),
    ];
    expect(countUnits(rows, set({ countUnit: "ITEM_QTY" }))).toBe(12);
    expect(countUnits(rows, set({ countUnit: "LINE_COUNT" }))).toBe(3);
    expect(evaluateTierSet(rows, set({ countUnit: "LINE_COUNT" }), TIERS, "mech-1", W).units).toBe(3);
  });
});

describe("三种奖励形态（界面上的选项必须条条算得清）", () => {
  const t10 = TIERS[0];

  it("ONE_OFF_FIXED：一次性 RM50", () => {
    expect(rewardAmount(set({ rewardKind: "ONE_OFF_FIXED" }), t10, { units: 12, avgUnitCommissionSen: 500 })).toBe(5000);
  });

  it("EXTRA_PER_UNIT_FIXED：追溯 = 全部 12 件都加 2 元", () => {
    expect(rewardAmount(set({ rewardKind: "EXTRA_PER_UNIT_FIXED", retroactive: true }), { ...t10, rewardValue: 200 }, { units: 12, avgUnitCommissionSen: 500 })).toBe(2400);
  });

  it("EXTRA_PER_UNIT_FIXED：不追溯 = 只算跨过门槛后的 2 件", () => {
    expect(rewardAmount(set({ rewardKind: "EXTRA_PER_UNIT_FIXED", retroactive: false }), { ...t10, rewardValue: 200 }, { units: 12, avgUnitCommissionSen: 500 })).toBe(400);
  });

  it("FREE_UNIT_COMMISSION：送 2 件 = 2 × 平均单件佣金", () => {
    const rows = [row({ id: "a", amountSen: 500 }), row({ id: "b", amountSen: 700 })];
    expect(avgUnitCommission(rows)).toBe(600);
    expect(rewardAmount(set({ rewardKind: "FREE_UNIT_COMMISSION" }), { ...t10, rewardValue: 2 }, { units: 10, avgUnitCommissionSen: avgUnitCommission(rows) })).toBe(1200);
  });

  it("没有合格行时平均单件佣金为 0（不产生凭空奖励）", () => {
    expect(avgUnitCommission([])).toBe(0);
    expect(rewardAmount(set({ rewardKind: "FREE_UNIT_COMMISSION" }), { ...t10, rewardValue: 2 }, { units: 0, avgUnitCommissionSen: 0 })).toBe(0);
  });
});

describe("可领取清单：状态是推导出来的", () => {
  const base = { rows: rowsN(10), tierSets: [set()], tiers: TIERS, userId: "mech-1", windowKey: W };

  it("达标且未领取 → 可领取，并带上金额与触发行", () => {
    const list = claimableTiers({ ...base, claimedTierIds: [] });
    expect(list).toHaveLength(1);
    expect(list[0].tier.id).toBe("t10");
    expect(list[0].amountSen).toBe(5000);
    expect(list[0].triggerRowId).toBe("r10");
  });

  it("已领取 → 不再出现（「领过」由唯一键保证，不靠状态字段）", () => {
    expect(claimableTiers({ ...base, claimedTierIds: ["t10"] })).toHaveLength(0);
  });

  it("没达标 → 不可领取", () => {
    expect(claimableTiers({ ...base, rows: rowsN(9), claimedTierIds: [] })).toHaveLength(0);
  });

  it("组合还没生效（生效窗口晚于该窗口）→ 不可领取", () => {
    const later = set({ effectiveFrom: new Date("2026-10-01T00:00:00Z") });
    expect(claimableTiers({ ...base, tierSets: [later], claimedTierIds: [] })).toHaveLength(0);
  });

  it("停用的组合不参与", () => {
    expect(claimableTiers({ ...base, tierSets: [set({ active: false })], claimedTierIds: [] })).toHaveLength(0);
  });
});

describe("窗口口径", () => {
  it("MONTH = 门店时区 MYT 的自然月（月初凌晨属于当月）", () => {
    expect(windowKeyFor("MONTH", new Date("2026-09-30T18:30:00Z"))).toBe("2026-10");
    expect(windowKeyFor("MONTH", new Date("2026-09-30T15:00:00Z"))).toBe("2026-09");
  });

  it("尚未实现的窗口类型**明确抛错**，而不是悄悄按自然月算", () => {
    expect(() => windowKeyFor("ROLLING_30D", new Date())).toThrow(/Unsupported/);
  });
});
