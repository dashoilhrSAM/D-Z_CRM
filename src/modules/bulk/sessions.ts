import { db } from "@/lib/db";
import type { RowPlan } from "./diff";

/**
 * 导入会话（P3）—— 把「审到一半」这件事存下来。
 *
 * 为什么必须落库而不是只放浏览器：
 * 一次真实的批量录入常常有几十上百条要判，老板不会一口气审完。
 * 只放浏览器的话**关掉页面就全丢了**，而这恰恰是他最需要「管起来」的部分。
 *
 * 状态机（只有三条边，不允许别的转移）：
 *
 *     DRAFT ──应用成功──> APPLIED
 *       └────取消────────> CANCELLED
 *
 * APPLIED / CANCELLED 都是终态：**应用过的会话不能再改**（否则历史就成了假的）。
 */

export type SessionStatus = "DRAFT" | "APPLIED" | "CANCELLED";

export interface SessionDecisions {
  /** 键是 "sheet#行号" —— 与差异计划的行标识一致 */
  [rowKey: string]: {
    decision: "approved" | "declined";
    /** 就地修改过的原始值（金额是 RM、日期是 YYYY-MM-DD），应用时由服务端解析并复验 */
    edits?: Record<string, unknown>;
  };
}

export interface SessionView {
  id: string;
  fileName: string;
  fileHash: string;
  branchId: string;
  uploadedBy: string;
  uploadedAt: string;
  status: SessionStatus;
  declaredSheets: string[];
  plans: RowPlan[];
  decisions: SessionDecisions;
  appliedSummary: unknown;
}

const KEY_SEP = "#";
export const rowKeyOf = (sheet: string, rowNumber: number) => sheet + KEY_SEP + rowNumber;

function toView(row: {
  id: string; fileName: string; fileHash: string; branchId: string; uploadedBy: string;
  uploadedAt: Date; status: string; declaredSheets: string | null; plans: unknown;
  decisions: unknown; appliedSummary: unknown;
}): SessionView {
  return {
    id: row.id,
    fileName: row.fileName,
    fileHash: row.fileHash,
    branchId: row.branchId,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt.toISOString(),
    status: row.status as SessionStatus,
    declaredSheets: row.declaredSheets ? row.declaredSheets.split(",").filter(Boolean) : [],
    plans: (row.plans as RowPlan[] | null) ?? [],
    decisions: (row.decisions as SessionDecisions | null) ?? {},
    appliedSummary: row.appliedSummary,
  };
}

/** 上传即建草稿：把「解析 + 差异」的结果整份存下来，之后每次回来审的都是同一份快照 */
export async function createImportSession(input: {
  organisationId: string;
  branchId: string;
  fileName: string;
  fileHash: string;
  uploadedBy: string;
  declaredSheets: string[] | null;
  plans: RowPlan[];
}): Promise<SessionView> {
  const row = await db.bulkImportSession.create({
    data: {
      organisationId: input.organisationId,
      branchId: input.branchId,
      fileName: input.fileName,
      fileHash: input.fileHash,
      uploadedBy: input.uploadedBy,
      declaredSheets: input.declaredSheets?.join(",") ?? null,
      plans: input.plans as never,
      decisions: {} as never,
    },
  });
  return toView(row);
}

export async function loadImportSession(id: string, organisationId: string): Promise<SessionView | null> {
  const row = await db.bulkImportSession.findFirst({ where: { id, organisationId } });
  return row ? toView(row) : null;
}

/** 还没审完的那一份（同一个人、同一个分店）—— 打开页面时自动接上 */
export async function findDraftSession(
  organisationId: string,
  branchId: string,
  uploadedBy: string,
): Promise<SessionView | null> {
  const row = await db.bulkImportSession.findFirst({
    where: { organisationId, branchId, uploadedBy, status: "DRAFT" },
    orderBy: { uploadedAt: "desc" },
  });
  return row ? toView(row) : null;
}

/**
 * 存决定。**只在 DRAFT 状态允许** —— 已应用/已取消的会话改决定会让历史失真。
 * 返回 false 表示这个会话已经不是草稿了（界面该提示刷新）。
 */
export async function saveImportDecisions(
  id: string,
  organisationId: string,
  decisions: SessionDecisions,
): Promise<boolean> {
  const res = await db.bulkImportSession.updateMany({
    where: { id, organisationId, status: "DRAFT" },
    data: { decisions: decisions as never },
  });
  return res.count === 1;
}

export async function markImportApplied(
  id: string,
  organisationId: string,
  appliedSummary: unknown,
): Promise<boolean> {
  const res = await db.bulkImportSession.updateMany({
    where: { id, organisationId, status: "DRAFT" },
    data: { status: "APPLIED", appliedSummary: appliedSummary as never, appliedAt: new Date() },
  });
  return res.count === 1;
}

export async function cancelImportSession(id: string, organisationId: string): Promise<boolean> {
  const res = await db.bulkImportSession.updateMany({
    where: { id, organisationId, status: "DRAFT" },
    data: { status: "CANCELLED" },
  });
  return res.count === 1;
}

export interface SessionHistoryRow {
  id: string;
  fileName: string;
  uploadedAt: string;
  status: SessionStatus;
  uploadedBy: string;
  uploadedByName: string;
  /** 这次文件覆盖了哪些表 */
  declaredSheets: string[];
  /** 计划里有多少条要判、其中批准/拒绝各多少（从存下来的决定算） */
  total: number;
  approved: number;
  declined: number;
  appliedSummary: { created: number; updated: number; deleted: number; deactivated: number; refused: number } | null;
}

/** 历史：谁、什么时候、哪个文件、几条、批了多少 */
export async function listImportSessions(organisationId: string, limit = 30): Promise<SessionHistoryRow[]> {
  const rows = await db.bulkImportSession.findMany({
    where: { organisationId },
    orderBy: { uploadedAt: "desc" },
    take: limit,
  });
  const userIds = [...new Set(rows.map((r) => r.uploadedBy))];
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return rows.map((r) => {
    const plans = (r.plans as RowPlan[] | null) ?? [];
    const decisions = (r.decisions as SessionDecisions | null) ?? {};
    const actionable = plans.filter((p) => p.action !== "skip");
    let approved = 0;
    let declined = 0;
    for (const p of actionable) {
      const d = decisions[rowKeyOf(p.sheet, p.rowNumber)]?.decision;
      if (d === "approved") approved += 1;
      else if (d === "declined") declined += 1;
    }
    const applied = r.appliedSummary as
      | { summary?: Record<string, { created: number; updated: number; deleted: number; deactivated: number }>; refused?: unknown[] }
      | null;
    const totals = applied?.summary
      ? Object.values(applied.summary).reduce(
          (a, s) => ({
            created: a.created + s.created,
            updated: a.updated + s.updated,
            deleted: a.deleted + s.deleted,
            deactivated: a.deactivated + s.deactivated,
          }),
          { created: 0, updated: 0, deleted: 0, deactivated: 0 },
        )
      : { created: 0, updated: 0, deleted: 0, deactivated: 0 };

    return {
      id: r.id,
      fileName: r.fileName,
      uploadedAt: r.uploadedAt.toISOString(),
      status: r.status as SessionStatus,
      uploadedBy: r.uploadedBy,
      uploadedByName: nameById.get(r.uploadedBy) ?? "—",
      declaredSheets: r.declaredSheets ? r.declaredSheets.split(",").filter(Boolean) : [],
      total: actionable.length,
      approved,
      declined,
      appliedSummary: applied ? { ...totals, refused: applied.refused?.length ?? 0 } : null,
    };
  });
}
