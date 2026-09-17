import "server-only";
import { businessDayKey, safeTimezone } from "@/lib/business-day";

/**
 * 考勤区间（「看哪一段」）—— **纯函数**，没有 DB。
 *
 * 为什么单独抽出来：日期算术是本功能里最容易「看起来对」的部分。一周从周几开始、
 * 月末是 28 还是 31、闰年、非法日期（2026-02-30）、时区——每一处都能悄悄偏一天，
 * 而界面上照样显示一个日期，没人会发现。抽成纯函数才能把边界钉死在单测里
 * （见 tests/attendance.test.ts 的「区间」段落）。
 *
 * 约定与项目既有完全一致：业务日是**组织时区**下的那一天，存成 UTC 零点。
 * 因此这里所有算术都在 "YYYY-MM-DD" 键与 UTC 零点上做，**绝不碰服务器本地时区**。
 */

export type RangePreset = "today" | "week" | "month" | "custom";

export const RANGE_PRESETS: RangePreset[] = ["today", "week", "month", "custom"];

/** 一次能看多久。报告页不是「导出全库」的入口：更长的区间既慢又没人看。 */
export const MAX_RANGE_DAYS = 366;

export interface AttendanceRange {
  preset: RangePreset;
  /** 起始业务日（含），YYYY-MM-DD */
  fromKey: string;
  /** 结束业务日（含） */
  toKey: string;
  /** 起始业务日的 UTC 零点 */
  from: Date;
  /** 结束业务日的 UTC 零点（含当天 —— 查询用 lte） */
  to: Date;
  /** 含首尾的天数 */
  days: number;
  /** 请求的区间不合法或被夹取过，界面据此提示，而不是静默给一段别的数据 */
  clamped: boolean;
}

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "YYYY-MM-DD" → 该日 UTC 零点；不是真实日期时返回 null。
 *
 * 回读比对是必需的：`new Date("2026-02-30T00:00:00Z")` 不会报错，它会**滚到 3 月 2 日**。
 * 不比对就会把用户输错的日期静默换成另一天。
 */
export function parseDayKey(key: string | null | undefined): Date | null {
  if (!key || !KEY_RE.test(key)) return null;
  const d = new Date(key + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === key ? d : null;
}

export function isDayKey(key: string | null | undefined): boolean {
  return parseDayKey(key) !== null;
}

/** 在键上加减天数（跨月、跨年、闰年都由 Date 处理）。 */
export function addDaysKey(key: string, days: number): string {
  const d = parseDayKey(key);
  if (!d) return key;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 周一为一周第一天（ISO，也是马来西亚习惯）。周日算上一周的最后一天。 */
export function startOfWeekKey(key: string): string {
  const d = parseDayKey(key);
  if (!d) return key;
  return addDaysKey(key, -((d.getUTCDay() + 6) % 7));
}

export function startOfMonthKey(key: string): string {
  return key.slice(0, 8) + "01";
}

/** 当月最后一天。用「下月第 0 天」而不是 28/30/31 的判断。 */
export function endOfMonthKey(key: string): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** 含首尾的天数；任一键非法时返回 0。 */
export function dayCount(fromKey: string, toKey: string): number {
  const a = parseDayKey(fromKey);
  const b = parseDayKey(toKey);
  if (!a || !b) return 0;
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

export interface ResolveRangeInput {
  preset?: string | null;
  from?: string | null;
  to?: string | null;
  /** 测试可注入「今天」 */
  now?: Date;
  timezone?: string | null;
}

/**
 * 把 URL 参数解析成一段合法区间。**永不抛错**——参数是用户可改的，
 * 坏参数退回「今天」，超出上限就夹取并置 clamped 让界面说清楚。
 *
 * week / month 都以**今天**收尾（不是本周末/月末）：未来那些天没有数据，
 * 查出来只会在报表里多出一排空行。
 */
export function resolveRange(input: ResolveRangeInput = {}): AttendanceRange {
  const tz = safeTimezone(input.timezone);
  const todayKey = businessDayKey(input.now ?? new Date(), tz);

  const preset: RangePreset = (RANGE_PRESETS as string[]).includes(input.preset ?? "")
    ? (input.preset as RangePreset)
    : "today";

  let fromKey = todayKey;
  let toKey = todayKey;
  if (preset === "week") {
    fromKey = startOfWeekKey(todayKey);
  } else if (preset === "month") {
    fromKey = startOfMonthKey(todayKey);
  } else if (preset === "custom") {
    fromKey = isDayKey(input.from) ? (input.from as string) : todayKey;
    toKey = isDayKey(input.to) ? (input.to as string) : todayKey;
  }

  let clamped = false;
  // 反着填的两个日期不该报错，也不该给出空结果——交换并让界面知道
  if (fromKey > toKey) {
    const swap = fromKey;
    fromKey = toKey;
    toKey = swap;
    clamped = true;
  }
  if (dayCount(fromKey, toKey) > MAX_RANGE_DAYS) {
    fromKey = addDaysKey(toKey, -(MAX_RANGE_DAYS - 1));
    clamped = true;
  }

  const from = parseDayKey(fromKey) as Date;
  const to = parseDayKey(toKey) as Date;
  return { preset, fromKey, toKey, from, to, days: dayCount(fromKey, toKey), clamped };
}

/** 业务日键（页面分组、CSV 第一列都用它）。 */
export function dayKeyOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}
