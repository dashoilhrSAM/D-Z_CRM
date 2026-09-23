// 规则冲突检测（纯函数）。
//
// 这条最容易被忽略却最贵：同一条 SKU 上有两条都生效的规则时，"客户到底拿几个点"取决于
// 一个没人记得排序规则 —— 争议时无法解释。所以既要写入时挡，也要能对已有数据报出来。
import { describe, expect, it } from "vitest";
import { detectConflicts, type RuleWindow } from "@/lib/commission/conflicts";

const w = (over: Partial<RuleWindow> & { id: string }): RuleWindow => ({
  scope: "PRODUCT",
  targetKey: "p1",
  active: true,
  effectiveFrom: "2026-09-01T00:00:00Z",
  effectiveTo: null,
  ...over,
});

describe("生效区间重叠检测", () => {
  it("两条都开着且区间重叠 → 报冲突", () => {
    const c = detectConflicts([w({ id: "a" }), w({ id: "b", effectiveFrom: "2026-09-10T00:00:00Z" })]);
    expect(c).toHaveLength(1);
    expect(c[0].ids.sort()).toEqual(["a", "b"]);
    expect(c[0].scope).toBe("PRODUCT");
  });

  it("首尾相接（旧的在新的开始时结束）不算冲突 —— 这正是「改规则」的正确做法", () => {
    const c = detectConflicts([
      w({ id: "old", effectiveTo: "2026-09-10T00:00:00Z" }),
      w({ id: "new", effectiveFrom: "2026-09-10T00:00:00Z" }),
    ]);
    expect(c).toEqual([]);
  });

  it("停用的规则不参与（它不生效，也就不冲突）", () => {
    expect(detectConflicts([w({ id: "a", active: false }), w({ id: "b" })])).toEqual([]);
  });

  it("不同对象/不同层级互不影响", () => {
    const c = detectConflicts([
      w({ id: "a", targetKey: "p1" }),
      w({ id: "b", targetKey: "p2" }),
      w({ id: "c", scope: "SERVICE", targetKey: "s1" }),
      w({ id: "d", scope: "SERVICE", targetKey: "s1" }),
    ]);
    expect(c).toHaveLength(1);
    expect(c[0].scope).toBe("SERVICE");
  });

  it("默认级（targetKey 为 null）同样会冲突", () => {
    const c = detectConflicts([w({ id: "a", scope: "DEFAULT", targetKey: null }), w({ id: "b", scope: "DEFAULT", targetKey: null })]);
    expect(c).toHaveLength(1);
  });
});
