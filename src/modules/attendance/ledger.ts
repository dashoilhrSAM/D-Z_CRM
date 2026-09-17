/**
 * 一段时间的考勤台账 —— **纯函数**，没有 DB、没有网络。
 *
 * 为什么单独抽出来：把「多天、多人、多段进出」压成一张报表，是本功能里
 * 最容易算错又最看不出来的部分——数字小了一点、某天少算一个人、工时不等于
 * 各天之和，界面上都只是一个看起来正常的数字。抽成纯函数才能在单测里把
 * 跨天、未闭合区间、已处置/未处置这些组合逐个钉死。
 *
 * 三条口径（与 policy.ts 一致，不要在这里另立一套）：
 *  1. 工时按**天**配对算（policy.rollupDay），跨天的 IN 不会被算成通宵工时；
 *  2. 未闭合的那一段**不计入**工时（人还在上班，不能显示"已经干了 3 小时"）；
 *  3. 处置**不改变**异常数：exceptionCount 是系统当时的判定（事实），
 *     pendingCount 才是"还要人看一眼"的量。
 */
import { isException, rollupDay } from "./policy";

export type ReviewDecision = "CONFIRMED" | "DISMISSED";

/** 全部处置结论（界面文案与它一一对应，tests/attendance.test.ts 会逐个检查 i18n 键）。 */
export const REVIEW_DECISIONS: ReviewDecision[] = ["CONFIRMED", "DISMISSED"];

export interface LedgerPunch {
  id: string;
  userId: string;
  kind: string;
  at: Date;
  businessDate: Date;
  verdict: string;
}

export interface LedgerReview {
  punchId: string;
  decision: string;
  reviewedBy: string;
  note?: string | null;
  createdAt: Date;
}

export interface PunchReview {
  decision: ReviewDecision;
  reviewedBy: string;
  note: string | null;
  reviewedAt: Date;
}

/**
 * 每笔打卡的**最新**处置。同一笔被处置多次时后写的算数（表是只追加的，
 * 反悔的办法是再写一条），结果与查询顺序无关——见下面同刻的并列处理。
 */
export function latestReviews(reviews: LedgerReview[]): Map<string, PunchReview> {
  const out = new Map<string, PunchReview>();
  for (const r of reviews) {
    const prev = out.get(r.punchId);
    if (prev) {
      if (prev.reviewedAt.getTime() > r.createdAt.getTime()) continue;
      // 同一毫秒的两条：按 decision 定序，避免结果取决于数据库的返回顺序
      if (prev.reviewedAt.getTime() === r.createdAt.getTime() && prev.decision >= r.decision) continue;
    }
    out.set(r.punchId, {
      decision: r.decision as ReviewDecision,
      reviewedBy: r.reviewedBy,
      note: r.note ?? null,
      reviewedAt: r.createdAt,
    });
  }
  return out;
}

export interface StaffDayRow {
  /** YYYY-MM-DD（业务日） */
  dateKey: string;
  firstInAt: Date | null;
  lastOutAt: Date | null;
  workedMinutes: number;
  /** 打了上班卡还没打下班卡 */
  open: boolean;
  punchCount: number;
  /** 系统判定的异常笔数（含已处置的） */
  exceptionCount: number;
  /** 其中还没人处置的 */
  pendingCount: number;
}

export interface StaffLedgerRow {
  userId: string;
  /** 按日期升序 */
  days: StaffDayRow[];
  presentDays: number;
  workedMinutes: number;
  exceptionCount: number;
  pendingCount: number;
  lastSeenAt: Date | null;
}

export interface LedgerTotals {
  presentDays: number;
  workedMinutes: number;
  exceptionCount: number;
  pendingCount: number;
  punchCount: number;
}

export interface Ledger {
  /** 按 userId 升序（稳定的顺序；界面要按名字排就自己再排一次） */
  staff: StaffLedgerRow[];
  totals: LedgerTotals;
  /** 还没处置的异常打卡 id，异常队列按它筛 */
  pendingPunchIds: string[];
}

/**
 * 把区间内的打卡明细压成台账。
 *
 * 只返回**有打卡记录**的人：没有记录的人由调用方决定补不补零行
 * （补零会让"这个人这周没来过"和"这个人不存在"看起来一样，是调用方的语义）。
 */
export function buildLedger(punches: LedgerPunch[], reviews: LedgerReview[]): Ledger {
  const reviewed = latestReviews(reviews);

  // userId → dateKey → punches
  const byUser = new Map<string, Map<string, LedgerPunch[]>>();
  for (const p of punches) {
    const dateKey = p.businessDate.toISOString().slice(0, 10);
    let days = byUser.get(p.userId);
    if (!days) {
      days = new Map();
      byUser.set(p.userId, days);
    }
    const list = days.get(dateKey);
    if (list) list.push(p);
    else days.set(dateKey, [p]);
  }

  const staff: StaffLedgerRow[] = [];
  const pendingPunchIds: string[] = [];

  for (const userId of [...byUser.keys()].sort()) {
    const dayMap = byUser.get(userId) as Map<string, LedgerPunch[]>;
    const days: StaffDayRow[] = [];
    let workedMinutes = 0;
    let exceptionCount = 0;
    let pendingCount = 0;
    let lastSeenAt: Date | null = null;

    for (const dateKey of [...dayMap.keys()].sort()) {
      const list = (dayMap.get(dateKey) as LedgerPunch[]).slice().sort((a, b) => a.at.getTime() - b.at.getTime());
      for (const p of list) {
        if (!lastSeenAt || p.at.getTime() > lastSeenAt.getTime()) lastSeenAt = p.at;
      }
      const roll = rollupDay(list);
      let dayExceptions = 0;
      let dayPending = 0;
      for (const p of list) {
        if (!isException(p.verdict)) continue;
        dayExceptions++;
        if (!reviewed.has(p.id)) {
          dayPending++;
          pendingPunchIds.push(p.id);
        }
      }
      workedMinutes += roll.workedMinutes;
      exceptionCount += dayExceptions;
      pendingCount += dayPending;
      days.push({
        dateKey,
        firstInAt: roll.checkInAt,
        lastOutAt: roll.checkOutAt,
        workedMinutes: roll.workedMinutes,
        open: roll.status === "INCOMPLETE",
        punchCount: list.length,
        exceptionCount: dayExceptions,
        pendingCount: dayPending,
      });
    }

    staff.push({
      userId,
      days,
      presentDays: days.length,
      workedMinutes,
      exceptionCount,
      pendingCount,
      lastSeenAt,
    });
  }

  const totals: LedgerTotals = {
    presentDays: staff.reduce((n, s) => n + s.presentDays, 0),
    workedMinutes: staff.reduce((n, s) => n + s.workedMinutes, 0),
    exceptionCount: staff.reduce((n, s) => n + s.exceptionCount, 0),
    pendingCount: staff.reduce((n, s) => n + s.pendingCount, 0),
    punchCount: punches.length,
  };

  // 队列按时间倒序：最新的异常排最前，主管先看刚发生的
  const byId = new Map(punches.map((p) => [p.id, p]));
  pendingPunchIds.sort((a, b) => {
    const pa = byId.get(a);
    const pb = byId.get(b);
    const ta = pa ? pa.at.getTime() : 0;
    const tb = pb ? pb.at.getTime() : 0;
    if (tb !== ta) return tb - ta;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  return { staff, totals, pendingPunchIds };
}

/** 分钟 → "7h 30m"（报表与 CSV 共用一个格式，避免两处措辞漂移）。 */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return rest + "m";
  if (rest === 0) return h + "h";
  return h + "h " + rest + "m";
}
