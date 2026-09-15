import "server-only";

/**
 * 业务日（一天）的**唯一定义**。
 *
 * 约定（项目既有）：业务日期存 UTC 零点，显示时用 toISOString().slice(0,10) 或 fmtDate。
 * 关键在于「哪一天」是按**组织时区**算的，不是按服务器时区——本地 +8 与生产 Vercel UTC
 * 差 8 小时，跨零点时两端会算出不同的日期（历史上 rider/workshop 的时间就是这么偏掉的）。
 *
 * 这个函数此前在两个地方各写了一份（src/actions/attendance.ts 与考勤页），
 * 考勤要按天汇总，两份实现必然漂移，所以收敛到这里。
 */

export const DEFAULT_TIMEZONE = "Asia/Kuala_Lumpur";

/** 时区字符串坏掉时（DB 里是自由文本）不要让整页崩掉，退回默认时区。 */
export function safeTimezone(timeZone?: string | null): string {
  if (!timeZone) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** 某时刻属于哪个业务日：返回该业务日的 UTC 零点。 */
export function businessDayUtc(at: Date = new Date(), timeZone?: string | null): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimezone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return new Date(ymd + "T00:00:00Z");
}

/** 业务日的 "YYYY-MM-DD" 键（报告分组、URL 参数用）。 */
export function businessDayKey(at: Date = new Date(), timeZone?: string | null): string {
  return businessDayUtc(at, timeZone).toISOString().slice(0, 10);
}
