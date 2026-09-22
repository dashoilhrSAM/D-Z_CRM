// Phone OTP 策略的护栏。
//
// 这些断言存在的理由：验证码链路上有三类**静默失效**——
//  ① 号段白名单写反了（允许了不该允许的，或把本国号码也拦了）；
//  ② 限流永远 allow（等于没有限流，而短信是花钱的）或永远 deny（用户永远拿不到验证码）；
//  ③ 短信文案里混进非 GSM-7 字符（带 emoji / 智能引号会从 1 条短信涨到 2–3 条，且部分运营商会拦）。
// 三类都不会报错，只会在账单、投诉或"收不到验证码"的工单里出现。
import { describe, expect, it } from "vitest";
import {
  OTP_LIMITS,
  buildOtpSms,
  countInWindow,
  evaluateOtpRate,
  isAllowedPhone,
  maskPhone,
  normalizeToE164,
  snapshotOtpUse,
} from "@/lib/otp";

describe("号段白名单（SMS pumping 的第一道防线）", () => {
  it("默认只放马来西亚", () => {
    expect(isAllowedPhone("+60131252832")).toBe(true);
    expect(isAllowedPhone("+6591234567")).toBe(false);
    expect(isAllowedPhone("+14155552671")).toBe(false);
    expect(isAllowedPhone("+8613800138000")).toBe(false);
  });

  it("白名单换成 +65 时，马来西亚号码必须被拒（反向验证：证明比对真的在读白名单）", () => {
    expect(isAllowedPhone("+60131252832", ["+65"])).toBe(false);
    expect(isAllowedPhone("+6591234567", ["+65"])).toBe(true);
  });

  it("没有 + 前缀、位数不合理的号码一律拒绝", () => {
    expect(isAllowedPhone("60131252832")).toBe(false);
    expect(isAllowedPhone("+60")).toBe(false);
    expect(isAllowedPhone("+601234567890123456")).toBe(false);
  });

  it("多国白名单按最长前缀匹配，不会把 +1 当成 +186 之类的超集", () => {
    expect(isAllowedPhone("+14155552671", ["+1"])).toBe(true);
    expect(isAllowedPhone("+8613800138000", ["+1", "+86"])).toBe(true);
  });
});

describe("输入归一化（身份键：错了就会绑错客户）", () => {
  it("本地写法带前导 0 —— 马来号转国际必须去掉它", () => {
    // 修复前实测：combinePhone("+60","013-125 2832") 得到 "+600131252832"（12 位、非法 E.164）。
    // 症状不会是报错，而是"这个号码找不到任何客户" + Supabase 拒绝建号。
    expect(normalizeToE164("+60", "013-125 2832")).toBe("+60131252832");
    expect(normalizeToE164("+60", "0131252832")).toBe("+60131252832");
  });

  it("直接粘贴国际格式不会被重复拼国家码", () => {
    expect(normalizeToE164("+60", "+60131252832")).toBe("+60131252832");
    expect(normalizeToE164("+60", "60131252832")).toBe("+60131252832");
  });

  it("占位符示范的写法（不含前导 0）继续正确", () => {
    expect(normalizeToE164("+60", "12 345 6789")).toBe("+60123456789");
    expect(normalizeToE164("+65", "9123 4567")).toBe("+6591234567");
  });

  it("位数不合理一律返回空串，不把半成品交给 Supabase", () => {
    expect(normalizeToE164("+60", "123")).toBe("");
    expect(normalizeToE164("+60", "1234567890123456789")).toBe("");
    expect(normalizeToE164("", "0131252832")).toBe("");
  });
});

describe("限流判定", () => {
  const empty = { phoneLastMinute: 0, phoneLastDay: 0, ipLastHour: 0 };

  it("第一次请求放行（这条防的是「守卫永远 false」这类空洞实现）", () => {
    expect(evaluateOtpRate(empty)).toEqual({ allow: true });
  });

  it("60 秒内重复请求 → too_soon", () => {
    const d = evaluateOtpRate({ ...empty, phoneLastMinute: 1, phoneLastDay: 1 });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("too_soon");
  });

  it("同一号码一天 5 次 → phone_daily", () => {
    const d = evaluateOtpRate({ phoneLastMinute: 0, phoneLastDay: OTP_LIMITS.maxPerPhonePerDay, ipLastHour: 1 });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("phone_daily");
  });

  it("同一来源一小时 10 次 → ip_hourly（刷很多号码才是攻击，不是一个人在重试）", () => {
    const d = evaluateOtpRate({ phoneLastMinute: 0, phoneLastDay: 0, ipLastHour: OTP_LIMITS.maxPerIpPerHour });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("ip_hourly");
  });

  it("边界值必须恰好放行（差一位就该换一条提示，这条防的是 >= 写成 >）", () => {
    expect(evaluateOtpRate({
      phoneLastMinute: 0,
      phoneLastDay: OTP_LIMITS.maxPerPhonePerDay - 1,
      ipLastHour: OTP_LIMITS.maxPerIpPerHour - 1,
    })).toEqual({ allow: true });
  });
});

describe("时间窗统计", () => {
  const now = new Date("2026-09-22T12:00:00Z");

  it("只数窗口内的", () => {
    const ts = [new Date("2026-09-22T11:59:30Z"), new Date("2026-09-22T11:30:00Z")];
    expect(countInWindow(ts, 60_000, now)).toBe(1);
    expect(countInWindow(ts, 3600_000, now)).toBe(2);
  });

  it("恰好落在窗口边界上的不计入（否则 60 秒的间隔会被算成两次）", () => {
    expect(countInWindow([new Date("2026-09-22T11:59:00Z")], 60_000, now)).toBe(0);
  });

  it("快照把两个窗口分开算", () => {
    const s = snapshotOtpUse([new Date("2026-09-22T11:59:55Z")], [new Date("2026-09-22T11:10:00Z")], now);
    expect(s).toEqual({ phoneLastMinute: 1, phoneLastDay: 1, ipLastHour: 1 });
  });
});

describe("短信文案与脱敏", () => {
  it("验证码出现两次（马来语 + 英语），且不含任何链接", () => {
    const body = buildOtpSms("123456", 5);
    expect(body.match(/123456/g)?.length).toBe(2);
    expect(body).not.toMatch(/https?:\/\//);
  });

  it("全部落在 GSM-7 可打印范围（emoji / 智能引号会把它变成多条短信）", () => {
    expect(buildOtpSms("123456", 5)).toMatch(/^[\x20-\x7E\n]*$/);
  });

  it("日志里只出现脱敏号码", () => {
    expect(maskPhone("+60131252832")).toBe("+6013****832");
    expect(maskPhone(null)).toBe("");
  });
});
