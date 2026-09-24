import { describe, expect, it } from "vitest";

describe("时间类触发器：日期判定（写错日期是最难发现的那类 bug）", () => {
  it("预约临近 = 日期正好是明天（不看时刻）", async () => {
    const { isBookingApproaching } = await import("@/modules/automation/scan");
    const now = new Date("2026-09-24T10:00:00Z");
    expect(isBookingApproaching(new Date("2026-09-25T00:00:00Z"), now)).toBe(true);
    expect(isBookingApproaching(new Date("2026-09-25T23:00:00Z"), now), "时刻不同但同一天，也算").toBe(true);
    expect(isBookingApproaching(new Date("2026-09-24T23:00:00Z"), now), "今天不算临近").toBe(false);
    expect(isBookingApproaching(new Date("2026-09-26T10:00:00Z"), now), "后天不算").toBe(false);
    // 跨月/跨年边界
    const eom = new Date("2026-09-30T08:00:00Z");
    expect(isBookingApproaching(new Date("2026-10-01T00:00:00Z"), eom)).toBe(true);
  });

  it("流失判定：超过 N 天没来；**从来没来过也算**", async () => {
    const { isInactive } = await import("@/modules/automation/scan");
    const now = new Date("2026-09-24T10:00:00Z");
    expect(isInactive(new Date("2026-09-01T00:00:00Z"), now), "23 天没来不算流失").toBe(false);
    expect(isInactive(new Date("2026-06-01T00:00:00Z"), now), "115 天没来算流失").toBe(true);
    expect(isInactive(null, now), "从没来过 = 流失").toBe(true);
    const justOver = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000);
    const justUnder = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000);
    expect(isInactive(justOver, now)).toBe(true);
    expect(isInactive(justUnder, now)).toBe(false);
  });
});
