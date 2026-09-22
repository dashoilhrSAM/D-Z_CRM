// Phone OTP 策略（纯函数，无 DB / 无网络 —— 可单测，且被 action 与 hook 共用以避免两份实现）。
//
// 为什么单独成文件：验证码链路上有三处"必须一致"的规则——
//   ① 允许的国家码（注册端拦一次，hook 再拦一次，两层必须同一份判据）；
//   ② 频率限制（Supabase 的 max frequency 只在"它决定发送"之后生效，
//      既不区分号码也不区分来源，因此真正的风控只能靠自己）；
//   ③ 短信文案（客户唯一能看到的东西）。
// 三处各写一遍就会出现"页面上拦住了、hook 没拦住"这类漂移。

import { combinePhone } from "@/lib/phone";

/** 默认只允许马来西亚号段。**这是 SMS pumping（批量刷国际号码）的第一道防线**：
 *  短信按条计费，攻击者用境外号码刷 OTP 是短信通道最常见的真实损失。 */
const DEFAULT_ALLOWED = ["+60"];

/** 允许的国家码（env OTP_ALLOWED_COUNTRY_CODES，逗号分隔，如 "+60,+65"）。 */
export function allowedCountryCodes(): string[] {
  const raw = process.env.OTP_ALLOWED_COUNTRY_CODES;
  if (!raw) return DEFAULT_ALLOWED;
  const list = raw.split(",").map((s) => s.trim()).filter((s) => /^\+\d{1,3}$/.test(s));
  return list.length ? list : DEFAULT_ALLOWED;
}

/**
 * E.164 号码是否落在允许的国家码内。
 * 用**最长前缀优先**比较：允许 +1 时不能把 +186（中国联通）也算进去——两者都以 "+1" 开头，
 * 取最长匹配才能区分。数字长度另做 7–15 位的基本校验（E.164 上限 15 位）。
 */
export function isAllowedPhone(e164: string, allowed: string[] = allowedCountryCodes()): boolean {
  const digits = e164.replace(/[^\d]/g, "");
  if (!e164.startsWith("+") || digits.length < 7 || digits.length > 15) return false;
  const matched = allowed.filter((cc) => e164.startsWith(cc));
  if (matched.length === 0) return false;
  const longest = matched.reduce((a, b) => (b.length > a.length ? b : a));
  return digits.length > longest.replace(/[^\d]/g, "").length;
}

/**
 * 注册/登录输入 → E.164，位数不合理时返回 ""（调用方据此报错，不要把半成品丢给 Supabase）。
 * 归一化本身委托给 lib/phone 的 combinePhone —— 它同时服务密码登录，两处必须是同一套规则。
 */
export function normalizeToE164(countryCode: string, local: string): string {
  const e164 = combinePhone(countryCode, local);
  const digits = e164.replace(/[^\d]/g, "");
  if (digits.length < 9 || digits.length > 15) return "";
  return e164;
}

/** 日志/审计里用的脱敏号码：+60131252832 → +6013****832（保留可追溯的国家码与尾号）。 */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const d = e164.replace(/[^\d]/g, "");
  if (d.length <= 6) return "+" + d;
  return "+" + d.slice(0, 4) + "*".repeat(Math.max(0, d.length - 7)) + d.slice(-3);
}

/** OTP 短信文案。双语一行：马来语是本地主语言，英语通用，且此时还读不到用户的语言偏好
 *  （注册前 session 尚不存在），所以不接 i18n 是有意的。
 *  只用 GSM-7 字符、不含链接（部分运营商会拦带链接的短信）。 */
export function buildOtpSms(otp: string, expireMinutes: number): string {
  return "D&Z: " + otp + " ialah kod pengesahan anda. Sah " + expireMinutes + " minit. Jangan kongsi kod ini.\n" +
    "D&Z: " + otp + " is your verification code. Valid " + expireMinutes + " minutes. Never share it.";
}

/** 与 Supabase dashboard 的 SMS OTP Expiry 必须一致（默认 5 分钟）。 */
export function otpExpireMinutes(): number {
  const raw = Number(process.env.OTP_EXPIRE_MINUTES);
  if (!Number.isFinite(raw) || raw < 1 || raw > 60) return 5;
  return Math.floor(raw);
}

// ---------- 频率限制 ----------

export const OTP_LIMITS = {
  /** 同一号码两次请求的最小间隔（Supabase 侧默认也是 60s） */
  minIntervalSec: 60,
  /** 同一号码 24 小时内的上限 */
  maxPerPhonePerDay: 5,
  /** 同一来源 1 小时内的上限（一条 IP 刷很多号码 = 攻击，不是一个用户在重试） */
  maxPerIpPerHour: 10,
} as const;

/**
 * 全局每日投递预算。**这是防「换号刷短信」的那道闸门**：
 * 直连攻击的杠杆不是重复打同一个号码（Supabase 自己有 per-phone 间隔），
 * 而是拿几千个不同的 +60 号码各发一次 —— 那种模式 per-phone 限制完全看不见。
 * 超过预算就整条链路停发（宁可挡下真实用户并报警，也不要一夜之间账单失控）。
 */
export function otpDailyBudget(): number {
  const raw = Number(process.env.OTP_DAILY_BUDGET);
  if (!Number.isFinite(raw) || raw < 0) return 300;
  return Math.floor(raw);
}

/** UTC 当天零点（与项目其它业务时间口径一致，避免服务器时区漂移）。 */
export function utcDayStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export interface OtpRateSnapshot {
  /** 同一号码最近 minIntervalSec 秒内的请求数 */
  phoneLastMinute: number;
  /** 同一号码最近 24 小时内的请求数 */
  phoneLastDay: number;
  /** 同一来源最近 1 小时内的请求数 */
  ipLastHour: number;
}

export type OtpRateDecision =
  | { allow: true }
  | { allow: false; reason: "too_soon" | "phone_daily" | "ip_hourly"; retryAfterSec: number; message: string };

/** 统计时间窗内的条数（纯函数：调用方只负责把时间戳喂进来，判定逻辑才可测）。 */
export function countInWindow(timestamps: Date[], windowMs: number, now: Date): number {
  const from = now.getTime() - windowMs;
  return timestamps.filter((t) => t.getTime() > from).length;
}

/**
 * 频率判定。顺序是刻意的：先"太快"（最常见的正常重试），再号码日限，最后来源小时限——
 * 这样用户看到的提示总是最贴近他真实原因的那条。
 */
export function evaluateOtpRate(s: OtpRateSnapshot): OtpRateDecision {
  if (s.phoneLastMinute > 0) {
    return {
      allow: false,
      reason: "too_soon",
      retryAfterSec: OTP_LIMITS.minIntervalSec,
      message: "A code was just sent. Please wait " + OTP_LIMITS.minIntervalSec + " seconds before requesting another.",
    };
  }
  if (s.phoneLastDay >= OTP_LIMITS.maxPerPhonePerDay) {
    return {
      allow: false,
      reason: "phone_daily",
      retryAfterSec: 3600,
      message: "Too many codes requested for this number today. Please try again tomorrow or contact the workshop.",
    };
  }
  if (s.ipLastHour >= OTP_LIMITS.maxPerIpPerHour) {
    return {
      allow: false,
      reason: "ip_hourly",
      retryAfterSec: 600,
      message: "Too many requests from this connection. Please try again in a few minutes.",
    };
  }
  return { allow: true };
}

/** 从事件时间戳算出快照（保持 evaluateOtpRate 纯函数化的配套）。 */
export function snapshotOtpUse(phoneEvents: Date[], ipEvents: Date[], now: Date = new Date()): OtpRateSnapshot {
  return {
    phoneLastMinute: countInWindow(phoneEvents, OTP_LIMITS.minIntervalSec * 1000, now),
    phoneLastDay: countInWindow(phoneEvents, 24 * 3600 * 1000, now),
    ipLastHour: countInWindow(ipEvents, 3600 * 1000, now),
  };
}
