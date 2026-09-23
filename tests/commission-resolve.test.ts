// 佣金解析器的金用例矩阵。
//
// 这块出错的方式只有两种，且都很贵：
//  · 选错规则（该用 SKU 级的却用了默认级）→ 技师拿错钱、还很难解释；
//  · 算错金额（四舍五入/数量/组合的固定部分）→ 一分一分都是钱。
// 所以下面每个层级、每种算法、每种时间边界都各有一条断言，并且**先测"不该命中"的反面**。
import { describe, expect, it } from "vitest";
import {
  commissionAmount,
  describeRule,
  explainResolution,
  resolveCommissionRule,
  type CommissionRuleLike,
} from "@/lib/commission/resolve";

const T0 = new Date("2026-09-01T00:00:00Z");
const T1 = new Date("2026-10-01T00:00:00Z");

function rule(over: Partial<CommissionRuleLike> & { id: string; scope: string }): CommissionRuleLike {
  return {
    targetKey: null,
    basis: "PERCENT",
    value: 500, // 5%
    valuePercent: null,
    valueFixedSen: null,
    effectiveFrom: T0,
    effectiveTo: null,
    priority: 0,
    active: true,
    ...over,
  };
}

const line = (over: Partial<Parameters<typeof resolveCommissionRule>[0]> = {}) => ({
  productId: null, serviceTypeId: null, packageId: null, category: null, baseSen: 10000, qty: 1, ...over,
});

describe("层级：最具体者胜，命中即终止、不叠加", () => {
  const rules = [
    rule({ id: "p", scope: "PRODUCT", targetKey: "prod-1", value: 700 }), // 7%
    rule({ id: "s", scope: "SERVICE", targetKey: "svc-1", value: 600 }), // 6%
    rule({ id: "k", scope: "PACKAGE", targetKey: "pkg-1", value: 500 }), // 5%
    rule({ id: "c", scope: "CATEGORY", targetKey: "OIL", value: 400 }), // 4%
    rule({ id: "d", scope: "DEFAULT", value: 100 }), // 1%
  ];

  it("同时有 SKU 与服务身份时用 SKU 级（更具体）", () => {
    const r = resolveCommissionRule(line({ productId: "prod-1", serviceTypeId: "svc-1", category: "OIL" }), rules);
    expect(r.ok && r.matchedBy).toBe("PRODUCT");
    expect(r.ok && r.amountSen).toBe(700); // 10000 × 7%
  });

  it("没有 SKU 就用服务级", () => {
    const r = resolveCommissionRule(line({ serviceTypeId: "svc-1", category: "OIL" }), rules);
    expect(r.ok && r.matchedBy).toBe("SERVICE");
    expect(r.ok && r.amountSen).toBe(600);
  });

  it("套餐行用套餐级（套餐不对应任何 SKU/服务）", () => {
    const r = resolveCommissionRule(line({ packageId: "pkg-1", category: "OIL" }), rules);
    expect(r.ok && r.matchedBy).toBe("PACKAGE");
  });

  it("只有分类就用分类级", () => {
    const r = resolveCommissionRule(line({ category: "OIL" }), rules);
    expect(r.ok && r.matchedBy).toBe("CATEGORY");
  });

  it("什么都没有就用默认级", () => {
    const r = resolveCommissionRule(line(), rules);
    expect(r.ok && r.matchedBy).toBe("DEFAULT");
    expect(r.ok && r.amountSen).toBe(100);
  });

  it("**不叠加**：命中 SKU 级时不会再加分类/默认的百分比", () => {
    const r = resolveCommissionRule(line({ productId: "prod-1", category: "OIL" }), rules);
    expect(r.ok && r.amountSen).toBe(700); // 7% 而不是 7%+4%+1%
  });

  it("完全没有规则 → 明确报 no-rule（不静默算 0）", () => {
    const r = resolveCommissionRule(line({ productId: "unknown" }), [rule({ id: "s", scope: "SERVICE", targetKey: "x" })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-rule");
  });

  it("分类匹配用的是分类名，不是 id：分类不匹配时**落到下一层**（这里就是默认级）", () => {
    const r = resolveCommissionRule(line({ category: "TYRE" }), rules);
    expect(r.ok && r.matchedBy, "TYRE 没有规则 → 不该命中 CATEGORY，应落到 DEFAULT").toBe("DEFAULT");
    // 反过来：把默认级也拿掉，才是真的"无规则"
    const r2 = resolveCommissionRule(line({ category: "TYRE" }), rules.filter((x) => x.scope !== "DEFAULT"));
    expect(r2.ok).toBe(false);
  });
});

describe("算法：百分比 / 固定额 / 组合", () => {
  it("百分比四舍五入到分", () => {
    expect(commissionAmount(rule({ id: "x", scope: "PRODUCT", value: 525 }), 9099, 1)).toBe(478); // 90.99 × 5.25%
  });

  it("固定额按件数乘", () => {
    expect(commissionAmount(rule({ id: "x", scope: "PRODUCT", basis: "FIXED", value: 200 }), 10000, 3)).toBe(600);
  });

  it("组合 = 百分比部分 + 每件固定部分", () => {
    const combo = rule({ id: "x", scope: "PRODUCT", basis: "COMBO", valuePercent: 500, valueFixedSen: 200 });
    expect(commissionAmount(combo, 10000, 2)).toBe(500 + 400); // 5% of 100 + 2×RM2
  });

  it("免费行（基数 0）算出 0，而不是抛错", () => {
    expect(commissionAmount(rule({ id: "x", scope: "PRODUCT" }), 0, 1)).toBe(0);
  });

  it("描述文案正确（界面与日志共用）", () => {
    expect(describeRule(rule({ id: "x", scope: "PRODUCT", value: 525 }))).toBe("5.25%");
    expect(describeRule(rule({ id: "y", scope: "PRODUCT", value: 200, basis: "FIXED" }))).toBe("RM 2.00/unit");
    expect(describeRule(rule({ id: "z", scope: "PRODUCT", basis: "COMBO", valuePercent: 500, valueFixedSen: 200 }))).toBe("5% + RM 2.00/unit");
  });
});

describe("时间边界：生效区间", () => {
  it("还没生效的规则不参与匹配（会落到下一层）", () => {
    const rules = [
      rule({ id: "future", scope: "PRODUCT", targetKey: "prod-1", value: 900, effectiveFrom: T1 }),
      rule({ id: "d", scope: "DEFAULT", value: 100 }),
    ];
    const r = resolveCommissionRule(line({ productId: "prod-1" }), rules, T0);
    expect(r.ok && r.matchedBy).toBe("DEFAULT");
  });

  it("已过期的规则不参与匹配", () => {
    const rules = [
      rule({ id: "old", scope: "PRODUCT", targetKey: "prod-1", value: 900, effectiveFrom: T0, effectiveTo: T1 }),
      rule({ id: "d", scope: "DEFAULT", value: 100 }),
    ];
    const r = resolveCommissionRule(line({ productId: "prod-1" }), rules, T1);
    expect(r.ok && r.matchedBy).toBe("DEFAULT");
  });

  it("停用（active=false）的规则被忽略", () => {
    const rules = [
      rule({ id: "off", scope: "PRODUCT", targetKey: "prod-1", value: 900, active: false }),
      rule({ id: "d", scope: "DEFAULT", value: 100 }),
    ];
    const r = resolveCommissionRule(line({ productId: "prod-1" }), rules);
    expect(r.ok && r.matchedBy).toBe("DEFAULT");
  });
});

describe("冲突：同层多条同时生效", () => {
  it("取 effectiveFrom 最新的那条，并标 ambiguous", () => {
    const rules = [
      rule({ id: "a", scope: "PRODUCT", targetKey: "prod-1", value: 500, effectiveFrom: T0 }),
      rule({ id: "b", scope: "PRODUCT", targetKey: "prod-1", value: 800, effectiveFrom: new Date("2026-09-15T00:00:00Z") }),
    ];
    const r = resolveCommissionRule(line({ productId: "prod-1" }), rules, new Date("2026-09-20T00:00:00Z"));
    expect(r.ok && r.ambiguous).toBe(true);
    expect(r.ok && r.rule.id).toBe("b");
    expect(r.ok && r.candidates.length).toBe(2);
  });

  it("effectiveFrom 相同时按 priority 大者，再并列则按 id 稳定排序（结果可复现）", () => {
    const rules = [
      rule({ id: "zzz", scope: "PRODUCT", targetKey: "prod-1", value: 100, priority: 5 }),
      rule({ id: "aaa", scope: "PRODUCT", targetKey: "prod-1", value: 900, priority: 5 }),
      rule({ id: "mmm", scope: "PRODUCT", targetKey: "prod-1", value: 300, priority: 9 }),
    ];
    const r = resolveCommissionRule(line({ productId: "prod-1" }), rules);
    expect(r.ok && r.rule.id).toBe("mmm"); // priority 9 胜
    const r2 = resolveCommissionRule(line({ productId: "prod-1" }), rules.filter((x) => x.id !== "mmm"));
    expect(r2.ok && r2.rule.id).toBe("aaa"); // priority 并列 → id 升序稳定
    expect(r2.ok && r2.ambiguous).toBe(true);
  });

  it("单条命中时不算冲突", () => {
    const r = resolveCommissionRule(line({ productId: "prod-1" }), [rule({ id: "a", scope: "PRODUCT", targetKey: "prod-1" })]);
    expect(r.ok && r.ambiguous).toBe(false);
  });
});

describe("解释文案（争议时靠它，不靠翻数据库）", () => {
  it("命中时说明层级、算法、基数与金额", () => {
    const r = resolveCommissionRule(line({ productId: "p", baseSen: 9000, qty: 1 }), [rule({ id: "a", scope: "PRODUCT", targetKey: "p", value: 500 })]);
    const text = explainResolution(r, "Motul 5100");
    expect(text).toContain("Motul 5100");
    expect(text).toContain("SKU");
    expect(text).toContain("5%");
    expect(text).toContain("RM 90.00");
    expect(text).toContain("RM 4.50");
  });

  it("没命中时明说会回退到旧规则（不假装算过）", () => {
    const r = resolveCommissionRule(line(), []);
    expect(explainResolution(r)).toContain("legacy");
  });
});
