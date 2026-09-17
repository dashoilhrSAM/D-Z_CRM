import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth/audit";
import { EXCEPTION_VERDICTS, isException } from "./policy";
import { buildLedger, type Ledger, type LedgerTotals, type ReviewDecision, REVIEW_DECISIONS } from "./ledger";
import type { AttendanceRange } from "./range";

/**
 * 考勤报表与异常处置（HRM P2）—— 只有读，以及「追加一条处置」。
 *
 * 与 service.ts 的分工：那边是**打卡写入**（证据链的产生），这边是**回看与处置**。
 * 分开是因为两者的规则完全不同：打卡只信服务端，处置只信有权限的人。
 *
 * 一条不会让步的规则：**处置不改任何原始行**。AttendancePunch 不更新，
 * Attendance.exceptionCount 也不重算——那个数字回答的是"系统当时判了几笔异常"。
 * 处置是"人对这个判定的看法"，另存一张只追加的表（AttendanceReview）。
 */

export interface ReportScope {
  organisationId: string;
  /** null = 全部分行（org 级角色）；否则锁到本店 */
  branchId: string | null;
}

export interface PunchReviewView {
  decision: string;
  reviewedByName: string;
  note: string | null;
  reviewedAt: string;
}

export interface PunchView {
  id: string;
  kind: string;
  at: string;
  dateKey: string;
  verdict: string;
  distanceM: number | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  source: string;
  review: PunchReviewView | null;
  /** 异常且还没人处置 —— 异常队列就是按它筛的 */
  pending: boolean;
}

export interface DayView {
  dateKey: string;
  firstInAt: string | null;
  lastOutAt: string | null;
  workedMinutes: number;
  open: boolean;
  punchCount: number;
  exceptionCount: number;
  pendingCount: number;
}

export interface StaffReportRow {
  id: string;
  name: string;
  role: string;
  branchName: string | null;
  active: boolean;
  days: DayView[];
  punches: PunchView[];
  presentDays: number;
  workedMinutes: number;
  exceptionCount: number;
  pendingCount: number;
  lastSeenAt: string | null;
}

/** 队列里的一项：一笔还没人处置的异常打卡，附上归属人。 */
export interface ReviewQueueEntry extends PunchView {
  userId: string;
  staffName: string;
  /** 不在所选区间内 —— 队列是全时段的，界面必须标出来，否则会被当成"这段时间的异常" */
  outsidePeriod: boolean;
}

export interface AttendanceReport {
  staff: StaffReportRow[];
  totals: LedgerTotals;
  /**
   * 待处置队列。**与所选区间无关**——它是一份工作队列，不是报表：
   * 老板默认看「今天」，若队列也跟着只看今天，上周留下的异常就会**永远没人看见**。
   * （这类"功能在但没人找得到"的缺口，本项目已经栽过一次，见 docs/changes 的权限矩阵那条。）
   */
  reviewQueue: ReviewQueueEntry[];
  /** 待处置的**真实**总数（队列超过上限时界面要说明只列了最近的） */
  reviewQueueTotal: number;
  /** 队列被截断（只列了最近的 N 条） */
  reviewQueueTruncated: boolean;
}

/** 一次最多列多少条待处置。工作队列不是报表：先处理最新的，清完再往下看。 */
export const REVIEW_QUEUE_LIMIT = 200;

/**
 * 读一段时间的考勤。
 *
 * **列出作用域内的所有人**（包括一条记录都没有的）：报表要回答的第一个问题
 * 往往就是"这周谁没来"，没有打卡记录的人如果直接不出现，这个问题就答不了。
 */
export async function loadAttendanceReport(scope: ReportScope, range: AttendanceRange): Promise<AttendanceReport> {
  const branchWhere = scope.branchId ? { branchId: scope.branchId } : {};

  // 待处置队列：全时段（不受 range 限制），"哪些异常还没人处置"由 reviews:{none:{}}
  // 在数据库里直接问出来（这段关系就是为此建的 FK），不把 id 拉回内存里比。
  const openWhere = {
    verdict: { in: [...EXCEPTION_VERDICTS] },
    reviews: { none: {} },
    user: { organisationId: scope.organisationId },
    ...branchWhere,
  };
  const [reviewQueueTotal, openPunches] = await Promise.all([
    db.attendancePunch.count({ where: openWhere }),
    db.attendancePunch.findMany({
      where: openWhere,
      orderBy: { at: "desc" },
      take: REVIEW_QUEUE_LIMIT,
      select: {
        id: true, userId: true, kind: true, at: true, businessDate: true, verdict: true,
        distanceM: true, lat: true, lng: true, accuracyM: true, source: true,
      },
    }),
  ]);

  const punches = await db.attendancePunch.findMany({
    where: {
      businessDate: { gte: range.from, lte: range.to },
      // 组织隔离走 relation：AttendancePunch 本身没有 organisationId，
      // 只看 branchId 的话 org 级角色会把别的组织的打卡也读进来。
      user: { organisationId: scope.organisationId },
      ...branchWhere,
    },
    orderBy: { at: "asc" },
    select: {
      id: true, userId: true, kind: true, at: true, businessDate: true, verdict: true,
      distanceM: true, lat: true, lng: true, accuracyM: true, source: true,
    },
  });

  const punchIds = punches.map((p) => p.id);
  const reviews = punchIds.length
    ? await db.attendanceReview.findMany({
        where: { punchId: { in: punchIds } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { punchId: true, decision: true, reviewedBy: true, note: true, createdAt: true },
      })
    : [];

  // 处置人可能不是当前作用域里的活跃员工（离职主管留下的记录），所以单独取名字
  const reviewerIds = [...new Set(reviews.map((r) => r.reviewedBy))];
  const reviewers = reviewerIds.length
    ? await db.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, name: true } })
    : [];
  const reviewerName = new Map(reviewers.map((u) => [u.id, u.name]));

  const ledger = buildLedger(
    punches.map((p) => ({ id: p.id, userId: p.userId, kind: p.kind, at: p.at, businessDate: p.businessDate, verdict: p.verdict })),
    reviews,
  );
  const perStaff = new Map(ledger.staff.map((s) => [s.userId, s]));
  const pendingSet = new Set(ledger.pendingPunchIds);

  // 作用域内的所有人（含离职/停用）：停用的人若本区间有记录，必须出现，否则数据对不上
  const users = await db.user.findMany({
    where: { organisationId: scope.organisationId, ...branchWhere },
    select: { id: true, name: true, role: true, active: true, branch: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  const reviewByPunch = new Map(
    reviews.map((r) => [
      r.punchId,
      { decision: r.decision, reviewedByName: reviewerName.get(r.reviewedBy) ?? "—", note: r.note, reviewedAt: r.createdAt.toISOString() },
    ]),
  );

  const seen = new Set<string>();
  const rows: StaffReportRow[] = [];
  for (const u of users) {
    seen.add(u.id);
    rows.push(toRow(u, punches, perStaff.get(u.id)?.days ?? [], pendingSet, reviewByPunch));
  }
  // 有记录但不在员工表里的人（历史数据/已删账号）：宁可显示一个无名行，也不要静默丢数据
  for (const s of ledger.staff) {
    if (seen.has(s.userId)) continue;
    rows.push(
      toRow({ id: s.userId, name: "—", role: "—", active: false, branch: null }, punches, s.days, pendingSet, reviewByPunch),
    );
  }

  rows.sort((a, b) => {
    // 有记录的在前（老板先看有动静的人），同组按名字
    const aHas = a.punches.length > 0 ? 0 : 1;
    const bHas = b.punches.length > 0 ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    return a.name.localeCompare(b.name);
  });

  const nameById = new Map(rows.map((r) => [r.id, r.name]));
  const reviewQueue: ReviewQueueEntry[] = openPunches.map((p) => {
    const dateKey = p.businessDate.toISOString().slice(0, 10);
    return {
      id: p.id,
      kind: p.kind,
      at: p.at.toISOString(),
      dateKey,
      verdict: p.verdict,
      distanceM: p.distanceM,
      lat: p.lat,
      lng: p.lng,
      accuracyM: p.accuracyM,
      source: p.source,
      // 队列里的每一项都还没处置，否则它不会在这里
      review: null,
      pending: true,
      userId: p.userId,
      staffName: nameById.get(p.userId) ?? "—",
      outsidePeriod: dateKey < range.fromKey || dateKey > range.toKey,
    };
  });

  return {
    staff: rows,
    totals: ledger.totals,
    reviewQueue,
    reviewQueueTotal,
    reviewQueueTruncated: reviewQueueTotal > reviewQueue.length,
  };
}

function toRow(
  u: { id: string; name: string; role: string; active: boolean; branch: { name: string } | null },
  punches: { id: string; userId: string; kind: string; at: Date; businessDate: Date; verdict: string; distanceM: number | null; lat: number | null; lng: number | null; accuracyM: number | null; source: string }[],
  days: { dateKey: string; firstInAt: Date | null; lastOutAt: Date | null; workedMinutes: number; open: boolean; punchCount: number; exceptionCount: number; pendingCount: number }[],
  pendingSet: Set<string>,
  reviewByPunch: Map<string, PunchReviewView>,
): StaffReportRow {
  const mine = punches.filter((p) => p.userId === u.id);
  const dayViews: DayView[] = days.map((d) => ({
    dateKey: d.dateKey,
    firstInAt: d.firstInAt?.toISOString() ?? null,
    lastOutAt: d.lastOutAt?.toISOString() ?? null,
    workedMinutes: d.workedMinutes,
    open: d.open,
    punchCount: d.punchCount,
    exceptionCount: d.exceptionCount,
    pendingCount: d.pendingCount,
  }));
  const punchViews: PunchView[] = mine.map((p) => ({
    id: p.id,
    kind: p.kind,
    at: p.at.toISOString(),
    dateKey: p.businessDate.toISOString().slice(0, 10),
    verdict: p.verdict,
    distanceM: p.distanceM,
    lat: p.lat,
    lng: p.lng,
    accuracyM: p.accuracyM,
    source: p.source,
    review: reviewByPunch.get(p.id) ?? null,
    pending: pendingSet.has(p.id),
  }));
  const last = punchViews.length ? punchViews[punchViews.length - 1].at : null;
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    branchName: u.branch?.name ?? null,
    active: u.active,
    days: dayViews,
    punches: punchViews,
    presentDays: dayViews.length,
    workedMinutes: dayViews.reduce((n, d) => n + d.workedMinutes, 0),
    exceptionCount: dayViews.reduce((n, d) => n + d.exceptionCount, 0),
    pendingCount: dayViews.reduce((n, d) => n + d.pendingCount, 0),
    lastSeenAt: last,
  };
}

export interface ReviewActor {
  id: string;
  organisationId: string;
  /** null = org 级（可处置全部分行）；否则只允许本店 */
  branchId: string | null;
  isOrgLevel: boolean;
}

export interface ReviewInput {
  actor: ReviewActor;
  punchId: string;
  decision: string;
  note?: string | null;
  now?: Date;
}

export type ReviewResult =
  | { ok: true; decision: ReviewDecision }
  | { ok: false; code: "NOT_FOUND" | "OUT_OF_SCOPE" | "NOT_AN_EXCEPTION" | "BAD_DECISION" | "NOTE_TOO_LONG"; message: string };

export const MAX_REVIEW_NOTE = 500;

/**
 * 处置一笔异常打卡（判定成立 / 判定不成立）。**只追加**，不修改任何原始行。
 *
 * 校验按「这是谁、能对哪一行做」来写——权限靠调用方已经用 can(...,"edit") 判过，
 * 这里负责的是**这一行是不是他的**：跨店处置必须被挡住，否则分行隔离在这个入口破功。
 */
export async function reviewPunch(input: ReviewInput): Promise<ReviewResult> {
  const decision = REVIEW_DECISIONS.includes(input.decision as ReviewDecision) ? (input.decision as ReviewDecision) : null;
  if (!decision) return { ok: false, code: "BAD_DECISION", message: "Unknown decision" };

  const note = (input.note ?? "").trim();
  if (note.length > MAX_REVIEW_NOTE) return { ok: false, code: "NOTE_TOO_LONG", message: "Note is too long" };

  const punch = await db.attendancePunch.findUnique({
    where: { id: input.punchId },
    select: { id: true, userId: true, branchId: true, verdict: true, kind: true, at: true, user: { select: { organisationId: true } } },
  });
  if (!punch || punch.user.organisationId !== input.actor.organisationId) {
    return { ok: false, code: "NOT_FOUND", message: "Punch not found" };
  }
  if (!input.actor.isOrgLevel && punch.branchId !== input.actor.branchId) {
    return { ok: false, code: "OUT_OF_SCOPE", message: "This punch belongs to another branch" };
  }
  if (!isException(punch.verdict)) {
    return { ok: false, code: "NOT_AN_EXCEPTION", message: "Only flagged punches need a review" };
  }

  const now = input.now ?? new Date();
  const row = await db.attendanceReview.create({
    data: { punchId: punch.id, decision, reviewedBy: input.actor.id, note: note || null, createdAt: now },
  });

  await audit({
    organisationId: input.actor.organisationId,
    branchId: punch.branchId,
    userId: input.actor.id,
    action: "ATTENDANCE_REVIEW_" + decision,
    entity: "AttendancePunch",
    entityId: punch.id,
    after: { reviewId: row.id, decision, verdict: punch.verdict, subjectUserId: punch.userId, note: note || null },
  });

  return { ok: true, decision };
}
