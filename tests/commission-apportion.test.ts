// 佣金口径的纯函数测试。
//
// 这三件事每一种都曾以"看起来很合理"的方式错掉，而且错了不会报错、只会给人错的数字：
// 折扣分摊（尾差/上限）、哪些行该计提（免费行）、以及计提落在哪个窗口（时区）。
import { describe, expect, it } from "vitest";
import { isBillableLine, netLineSen, splitDiscountToLines, windowKeyOf } from "@/lib/commission/apportion";

describe("折扣分摊：客户实付才是佣金基数", () => {
  it("按行占比分摊，尾差归最大行，且总和不超折扣", () => {
    // 100 / 300 / 600，折扣 100 → 10 / 30 / 60
    const shares = splitDiscountToLines([10000, 30000, 60000], 10000);
    expect(shares).toEqual([1000, 3000, 6000]);
    expect(shares.reduce((s, v) => s + v, 0)).toBe(10000);
  });

  it("除不尽的尾差全部落到最大行（可复现，不散落）", () => {
    // 三行等额，折扣 100 sen：33/33/33 余 1 → 给最大行（并列取下标最小者）
    const shares = splitDiscountToLines([1000, 1000, 1000], 100);
    expect(shares.reduce((s, v) => s + v, 0)).toBe(100);
    expect(shares[0]).toBe(34);
    expect(shares.slice(1)).toEqual([33, 33]);
  });

  it("单行承担额不超过它自己的金额（净额永不为负）", () => {
    // 便宜的行走大折扣：不能把 1 分的行分到 5 分
    const shares = splitDiscountToLines([1, 99999], 50000);
    expect(shares[0]).toBeLessThanOrEqual(1);
    expect(shares.reduce((s, v) => s + v, 0)).toBe(50000);
  });

  it("折扣 ≥ 小计（全免）时每行承担自己的全部金额", () => {
    const shares = splitDiscountToLines([100, 200], 999);
    expect(shares).toEqual([100, 200]);
    expect(netLineSen(100, shares[0])).toBe(0);
  });

  it("没有折扣 / 金额为 0 时不产生任何分摊", () => {
    expect(splitDiscountToLines([100, 200], 0)).toEqual([0, 0]);
    expect(splitDiscountToLines([], 500)).toEqual([]);
    expect(splitDiscountToLines([0, 0], 100)).toEqual([0, 0]);
  });

  it("净额 = 行金额 − 该行承担的折扣", () => {
    expect(netLineSen(9000, 450)).toBe(8550);
  });
});

describe("哪些行参与计提", () => {
  it("免费行/保修行不参与（不计佣也不计件）", () => {
    expect(isBillableLine({ status: "INCLUDED", unitPriceSen: 0 })).toBe(false);
  });

  it("被客户拒绝的行不参与", () => {
    expect(isBillableLine({ status: "DECLINED", unitPriceSen: 5000 })).toBe(false);
  });

  it("正常计费行参与", () => {
    expect(isBillableLine({ status: "INCLUDED", unitPriceSen: 5000 })).toBe(true);
    expect(isBillableLine({ status: null, unitPriceSen: 1 })).toBe(true);
  });
});

describe("结算窗口：自然月，按 MYT 而不是 UTC", () => {
  it("月初凌晨属于 MYT 的当月（UTC 上还是上个月的最后一天）", () => {
    // 2026-09-30T18:30:00Z = 2026-10-01 02:30 MYT → 必须算 10 月
    expect(windowKeyOf(new Date("2026-09-30T18:30:00Z"))).toBe("2026-10");
  });

  it("月末深夜仍属于 MYT 的当月", () => {
    // 2026-09-30T15:00:00Z = 2026-09-30 23:00 MYT → 9 月
    expect(windowKeyOf(new Date("2026-09-30T15:00:00Z"))).toBe("2026-09");
  });

  it("跨年边界正确", () => {
    expect(windowKeyOf(new Date("2026-12-31T16:30:00Z"))).toBe("2027-01");
  });

  it("窗口键是补零的 YYYY-MM（可安全用作字符串键排序）", () => {
    expect(windowKeyOf(new Date("2026-01-15T00:00:00Z"))).toBe("2026-01");
  });
});
