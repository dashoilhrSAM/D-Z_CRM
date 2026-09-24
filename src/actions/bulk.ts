"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/session-user";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { planSheet, type RowPlan, type SheetSummary } from "@/modules/bulk/diff";
import { PRODUCTS_SHEET, PACKAGES_SHEET, PACKAGE_ITEMS_SHEET, CAMPAIGNS_SHEET, SUPPLIERS_SHEET, SERVICE_TYPES_SHEET, MOTORCYCLES_SHEET, CUSTOMERS_SHEET, normalizePhone } from "@/modules/bulk/sheets";
import { buildSetupWorkbook } from "@/modules/bulk/export";
import { buildExistingRows, sheetColumns, type SheetColumnMeta } from "@/modules/bulk/existing";
import { parseSetupWorkbook } from "@/modules/bulk/parse";
import { applyPlans } from "@/modules/bulk/apply";
import { audit } from "@/lib/auth/audit";
import {
  createImportSession, findDraftSession, loadImportSession, saveImportDecisions,
  markImportApplied, cancelImportSession, listImportSessions, rowKeyOf,
  type SessionView, type SessionHistoryRow,
} from "@/modules/bulk/sessions";

/**
 * 批量配置（P2）的写入口。
 *
 * **预览与应用是两个动作**：预览只读（解析 + 算差异，不写库），应用才写。
 * 老板要能在"看清楚之后"才决定 —— 这也是这一期唯一真正的设计。
 *
 * 权限：导入是**高危动作** —— 要 P ARTS:edit（零件配置的同一个权限）；
 * **删除行只允许 OWNER / SUPER_ADMIN**（与文档删除同一口径）。
 */

const ORG_LEVEL = ["OWNER", "SUPER_ADMIN"];

async function actor() {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return null;
  return {
    session,
    userId: session.user.id,
    role: session.role as string,
    organisationId: session.orgId,
    branchId: session.branchId ?? null,
  };
}

/** 可导出的分店列表（只列本会话看得到的）。 */
export async function setupBranches(): Promise<{ id: string; name: string }[]> {
  const me = await actor();
  if (!me) return [];
  // 分行级用户只能看到自己的分店（与全站一致的口径）
  const where = me.branchId ? { id: me.branchId } : { organisationId: me.organisationId };
  return db.branch.findMany({ where, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/**
 * 下载当前配置（工作簿）。
 *
 * @param input.sheets 只导出这几张（缺省＝全部）—— 这份清单会写进文件元数据，导入时只处理文件里有的部分
 * @param input.templateOnly 只要模板（只有表头与列对照，适合全新配置）
 */
export async function exportSetupWorkbook(input: {
  branchId?: string;
  sheets?: string[];
  templateOnly?: boolean;
}): Promise<{ ok: true; base64: string; fileName: string } | { ok: false; error: string }> {
  const me = await actor();
  if (!me) return { ok: false, error: "Not signed in" };
  const allowed = await can({ id: me.userId, role: me.role as never, organisationId: me.organisationId }, "PARTS", "edit");
  if (!allowed) return { ok: false, error: "No permission to export configuration" };

  // 分行级用户不能导别的分店（org 级可以选）
  const branchId = me.branchId ?? input.branchId;
  if (!branchId) return { ok: false, error: "Pick a branch first" };
  if (me.branchId && input.branchId && input.branchId !== me.branchId) {
    return { ok: false, error: "You can only export your own branch" };
  }
  const branch = await db.branch.findUnique({ where: { id: branchId }, select: { name: true, organisationId: true } });
  if (!branch || branch.organisationId !== me.organisationId) return { ok: false, error: "Branch not found" };

  const bytes = await buildSetupWorkbook({
    organisationId: me.organisationId,
    branchId,
    sheets: input.sheets,
    templateOnly: input.templateOnly,
  });
  const date = new Date().toISOString().slice(0, 10);
  const slug = branch.name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "branch";
  return { ok: true, base64: Buffer.from(bytes).toString("base64"), fileName: "workshop-setup-" + slug + "-" + date + ".xlsx" };
}

export type { SheetColumnMeta } from "@/modules/bulk/existing";
export type { SessionHistoryRow } from "@/modules/bulk/sessions";

export interface PreviewResult {
  ok: true;
  versionOk: boolean;
  warnings: string[];
  /** 文件声明包含哪些 sheet（null＝老文件没写，按全都算处理） */
  declaredSheets: string[] | null;
  /** 每张表的列定义 —— 界面据此渲染「就地修改」的输入控件 */
  columns: Record<string, SheetColumnMeta[]>;
  /** 文件属于哪个分店（套餐/促销按它落库） */
  branchId: string;
  branchName: string | null;
  sheets: { key: string; title: string; found: boolean; summary: SheetSummary; warnings: string[] }[];
  /** 逐行计划（前端只展示有问题与有改动的行） */
  plans: RowPlan[];
}

/** 上传 → 只解析与校验，**不写库**。 */
export async function previewSetupImport(formData: FormData): Promise<PreviewResult | { ok: false; error: string }> {
  const me = await actor();
  if (!me) return { ok: false, error: "Not signed in" };
  const allowed = await can({ id: me.userId, role: me.role as never, organisationId: me.organisationId }, "PARTS", "edit");
  if (!allowed) return { ok: false, error: "No permission to import configuration" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file" };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: "File is larger than 10MB" };

  const parsed = await parseSetupWorkbook(new Uint8Array(await file.arrayBuffer()));
  if (!parsed.versionOk) {
    return { ok: false, error: parsed.warnings.join("; ") || "Workbook version mismatch" };
  }

  // 分店：套餐/促销按分店存，所以文件必须写明是哪个分店，且必须是本人有权写的分店
  const branchId = parsed.branchId ?? me.branchId;
  if (!branchId) return { ok: false, error: "This file does not say which branch it belongs to — export a fresh copy from this page" };
  if (me.branchId && branchId !== me.branchId) return { ok: false, error: "This file belongs to another branch" };
  const branch = await db.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true, organisationId: true } });
  if (!branch || branch.organisationId !== me.organisationId) return { ok: false, error: "The branch in this file is not in your organisation" };

  const existingBySheet = await buildExistingRows({ organisationId: me.organisationId, branchId });

  const defBySheet: Record<string, typeof PRODUCTS_SHEET> = {
    [PRODUCTS_SHEET.key]: PRODUCTS_SHEET,
    [PACKAGES_SHEET.key]: PACKAGES_SHEET,
    [PACKAGE_ITEMS_SHEET.key]: PACKAGE_ITEMS_SHEET,
    [CAMPAIGNS_SHEET.key]: CAMPAIGNS_SHEET,
    [SUPPLIERS_SHEET.key]: SUPPLIERS_SHEET,
    [SERVICE_TYPES_SHEET.key]: SERVICE_TYPES_SHEET,
    [MOTORCYCLES_SHEET.key]: MOTORCYCLES_SHEET,
    [CUSTOMERS_SHEET.key]: CUSTOMERS_SHEET,
  };

  const canDelete = ORG_LEVEL.includes(me.role);
  const plans: RowPlan[] = [];
  const sheets: PreviewResult["sheets"] = [];
  for (const s of parsed.sheets) {
    if (!s.found) {
      sheets.push({ key: s.key, title: s.title, found: false, summary: { create: 0, update: 0, delete: 0, skip: 0, error: 0 }, warnings: s.warnings });
      continue;
    }
    const { plans: sheetPlans, summary } = planSheet({
      def: defBySheet[s.key],
      incoming: s.rows,
      existing: existingBySheet[s.key] ?? [],
      allowDelete: canDelete,
    });
    // 非 OWNER 的删除行会被 planSheet 标成 error（allowDelete=false），提示要说人话
    for (const p of sheetPlans) {
      if (p.action === "error" && p.errors.some((e) => e.includes("cannot be deleted"))) {
        p.errors = ["Only the owner can delete rows"];
      }
    }
    // 客户：邮箱**不做键**，但两个人不能共用 —— 在预览里就说清楚（而不是等到应用才炸）。
    // 自动合并会在"换号写错一次"时并错人，所以这里只报错、不合并。
    if (s.key === CUSTOMERS_SHEET.key) {
      const customerRows = existingBySheet[CUSTOMERS_SHEET.key] ?? [];
      const emailOwner = new Map(
        customerRows.filter((c) => c.email).map((c) => [String(c.email).trim().toLowerCase(), c]),
      );
      for (const p of sheetPlans) {
        if (p.action !== "create" && p.action !== "update") continue;
        const email = typeof p.values.email === "string" ? p.values.email.trim().toLowerCase() : "";
        if (!email) continue;
        const mine = customerRows.find((c) => c.phone && normalizePhone(String(c.phone)) === normalizePhone(p.key));
        const owner = emailOwner.get(email);
        if (owner && owner.id !== mine?.id) {
          p.action = "error";
          p.errors.push('Email ' + p.values.email + " already belongs to " + owner.name + " — if they really share it, leave the Email cell blank");
        }
      }
    }
    plans.push(...sheetPlans);
    sheets.push({ key: s.key, title: s.title, found: true, summary: { ...summary, error: sheetPlans.filter((p) => p.action === "error").length }, warnings: s.warnings });
  }
  if (sheets.length === 0 || sheets.every((s) => !s.found)) {
    return { ok: false, error: "This file has no sheet I can read — export a fresh copy from this page" };
  }

  const columns = sheetColumns();

  return {
    ok: true,
    versionOk: parsed.versionOk,
    warnings: parsed.warnings,
    declaredSheets: parsed.declaredSheets,
    columns,
    branchId,
    branchName: branch.name,
    sheets,
    plans,
  };
}

/** 应用（只有点击确认才会走到这里）。 */
export async function applySetupImport(input: {
  plans: RowPlan[];
  branchId: string;
  /** 界面里「就地修改」的原始值（键 "sheet#行号"）——由服务端解析与复验 */
  edits?: Record<string, Record<string, unknown>>;
}): Promise<
  {
    ok: true;
    summary: Record<string, { created: number; updated: number; deleted: number; deactivated: number; skipped: number; stale: number }>;
    /** 服务端拒绝的行（值不合法 / 预览已过期）—— 界面要把它显示出来 */
    refused: { sheet: string; key: string; fields: string[] }[];
  }
  | { ok: false; error: string }
> {
  const me = await actor();
  if (!me) return { ok: false, error: "Not signed in" };
  const allowed = await can({ id: me.userId, role: me.role as never, organisationId: me.organisationId }, "PARTS", "edit");
  if (!allowed) return { ok: false, error: "No permission to import configuration" };

  // 边界检查放在**这里**（应用时），不是只放在预览里：
  // 预览是给人看的，不能当门禁 —— 客户端能构造任意 plans 发给服务端。
  if (input.plans.length > 5000) return { ok: false, error: "Too many rows in one import (5000 max)" };
  if (!ORG_LEVEL.includes(me.role) && input.plans.some((p) => p.action === "delete")) {
    return { ok: false, error: "Only the owner can delete rows" };
  }
  // 分店也在这里把住：分行级用户只能写自己的分店（org 级可以写本组织的任一分店，且会写进审计）
  if (me.branchId && input.branchId !== me.branchId) return { ok: false, error: "You can only write to your own branch" };

  const res = await applyPlans({
    organisationId: me.organisationId,
    branchId: input.branchId,
    userId: me.userId,
    sessionBranchId: me.branchId,
    plans: input.plans,
    edits: input.edits,
  });
  if (res.ok) {
    revalidatePath("/workshop/inventory/products");
    revalidatePath("/workshop/setup");
  }
  return res;
}


// ─────────────────────────────────────────────────────────────────────────────
// P3：导入会话（审到一半可以关掉页面，回来接着审）
// ─────────────────────────────────────────────────────────────────────────────

/** 本会话默认盯着的分店（分行级用户＝自己的店，org 级＝主店） */
async function defaultBranchId(me: { organisationId: string; branchId: string | null }) {
  if (me.branchId) return me.branchId;
  const main = await db.branch.findFirst({
    where: { organisationId: me.organisationId, isMain: true },
    select: { id: true },
  });
  return main?.id ?? null;
}

/** 打开页面时接上「上次没审完的那一份」 */
export async function resumeSetupImport(): Promise<
  { ok: true; session: SessionView | null; columns: Record<string, SheetColumnMeta[]> } | { ok: false; error: string }
> {
  const me = await actor();
  if (!me) return { ok: false, error: "Not signed in" };
  if (!(await can({ id: me.userId, role: me.role as never, organisationId: me.organisationId }, "PARTS", "edit")))
    return { ok: false, error: "No permission to import" };
  const branchId = await defaultBranchId(me);
  if (!branchId) return { ok: false, error: "No branch" };
  return { ok: true, session: await findDraftSession(me.organisationId, branchId, me.userId), columns: sheetColumns() };
}

/** 载入某一份会话（历史里点进去） */
export async function loadSetupImport(sessionId: string): Promise<
  { ok: true; session: SessionView; columns: Record<string, SheetColumnMeta[]> } | { ok: false; error: string }
> {
  const me = await actor();
  if (!me) return { ok: false, error: "Not signed in" };
  if (!(await can({ id: me.userId, role: me.role as never, organisationId: me.organisationId }, "PARTS", "edit")))
    return { ok: false, error: "No permission to import" };
  const session = await loadImportSession(sessionId, me.organisationId);
  if (!session) return { ok: false, error: "Session not found" };
  return { ok: true, session, columns: sheetColumns() };
}

/** 上传即建草稿：解析 + 差异 → 整份存下来 */
export async function startSetupImport(formData: FormData): Promise<
  | { ok: true; sessionId: string; columns: Record<string, SheetColumnMeta[]>; preview: PreviewResult }
  | { ok: false; error: string }
> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  // 内容哈希：历史里看得出「这是同一份文件」重复上传过
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  const fileHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);

  // 复用同一套解析与差异（权限、分店、三条安全规则都在里面）
  const fd = new FormData();
  fd.set("file", new File([bytes], file.name, { type: file.type || "application/octet-stream" }));
  const preview = await previewSetupImport(fd);
  if (!preview.ok) return { ok: false, error: preview.error };

  const me = await actor();
  if (!me) return { ok: false, error: "Not signed in" };

  const session = await createImportSession({
    organisationId: me.organisationId,
    branchId: preview.branchId,
    fileName: file.name,
    fileHash,
    uploadedBy: me.userId,
    declaredSheets: preview.declaredSheets,
    plans: preview.plans,
  });
  return { ok: true, sessionId: session.id, columns: sheetColumns(), preview };
}

/** 存决定（关掉页面也不会丢） */
export async function saveSetupDecisions(input: {
  sessionId: string;
  decisions: Record<string, { decision?: "approved" | "declined"; edits?: Record<string, string> }>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await actor();
  if (!me) return { ok: false, error: "Not signed in" };
  if (!(await can({ id: me.userId, role: me.role as never, organisationId: me.organisationId }, "PARTS", "edit")))
    return { ok: false, error: "No permission to import" };
  const saved = await saveImportDecisions(input.sessionId, me.organisationId, input.decisions);
  if (!saved) return { ok: false, error: "This import is no longer a draft (already applied or cancelled)" };
  return { ok: true };
}

/** 应用：只写**已批准**的行，然后把这个会话标记成 APPLIED */
export async function applySetupSession(input: { sessionId: string }): Promise<
  | { ok: true; summary: Record<string, { created: number; updated: number; deleted: number; deactivated: number }>; refused: { sheet: string; key: string; fields: string[] }[] }
  | { ok: false; error: string }
> {
  const me = await actor();
  if (!me) return { ok: false, error: "Not signed in" };
  if (!(await can({ id: me.userId, role: me.role as never, organisationId: me.organisationId }, "PARTS", "edit")))
    return { ok: false, error: "No permission to import" };

  const session = await loadImportSession(input.sessionId, me.organisationId);
  if (!session) return { ok: false, error: "Session not found" };
  if (session.status !== "DRAFT") return { ok: false, error: "This import was already " + session.status.toLowerCase() };

  const approved: RowPlan[] = [];
  const edits: Record<string, Record<string, unknown>> = {};
  for (const p of session.plans) {
    if (p.action === "skip" || p.action === "error") continue;   // 出错的行不能被批准（界面上也按不了）
    const d = session.decisions[rowKeyOf(p.sheet, p.rowNumber)];
    if (d?.decision !== "approved") continue;
    approved.push(p);
    if (d.edits && Object.keys(d.edits).length > 0) edits[rowKeyOf(p.sheet, p.rowNumber)] = d.edits;
  }
  if (approved.length === 0) return { ok: false, error: "Nothing approved yet" };

  const res = await applyPlans({
    organisationId: me.organisationId,
    branchId: session.branchId,
    userId: me.userId,
    sessionBranchId: me.branchId,
    plans: approved,
    edits,
  });
  if (!res.ok) return { ok: false, error: res.error };

  await markImportApplied(session.id, me.organisationId, res);
  await audit({
    organisationId: me.organisationId,
    branchId: session.branchId,
    userId: me.userId,
    action: "bulk.import.applied",
    entity: "BulkImportSession",
    entityId: session.id,
    after: { file: session.fileName, approvedRows: approved.length, sheets: session.declaredSheets },
  });

  const summary: Record<string, { created: number; updated: number; deleted: number; deactivated: number }> = {};
  for (const [sheet, s] of Object.entries(res.summary)) {
    summary[sheet] = { created: s.created, updated: s.updated, deleted: s.deleted, deactivated: s.deactivated };
  }
  revalidatePath("/workshop/setup");
  return { ok: true, summary, refused: res.refused };
}

/** 取消：什么都不写 */
export async function cancelSetupSession(input: { sessionId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await actor();
  if (!me) return { ok: false, error: "Not signed in" };
  if (!(await can({ id: me.userId, role: me.role as never, organisationId: me.organisationId }, "PARTS", "edit")))
    return { ok: false, error: "No permission to import" };
  const done = await cancelImportSession(input.sessionId, me.organisationId);
  if (!done) return { ok: false, error: "This import is no longer a draft" };
  revalidatePath("/workshop/setup");
  return { ok: true };
}

/** 历史：每次导入改了什么、谁批的 */
export async function setupSessionHistory(): Promise<
  { ok: true; rows: SessionHistoryRow[] } | { ok: false; error: string }
> {
  const me = await actor();
  if (!me) return { ok: false, error: "Not signed in" };
  if (!(await can({ id: me.userId, role: me.role as never, organisationId: me.organisationId }, "PARTS", "edit")))
    return { ok: false, error: "No permission to import" };
  return { ok: true, rows: await listImportSessions(me.organisationId) };
}
