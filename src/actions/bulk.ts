"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/session-user";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { planSheet, type RowPlan, type SheetSummary } from "@/modules/bulk/diff";
import { PRODUCTS_SHEET } from "@/modules/bulk/sheets";
import { buildSetupWorkbook } from "@/modules/bulk/export";
import { parseSetupWorkbook } from "@/modules/bulk/parse";
import { applyProductPlans } from "@/modules/bulk/apply";

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

/** 下载当前配置（工作簿）。 */
export async function exportSetupWorkbook(): Promise<{ ok: true; base64: string; fileName: string } | { ok: false; error: string }> {
  const me = await actor();
  if (!me) return { ok: false, error: "Not signed in" };
  const allowed = await can({ id: me.userId, role: me.role as never, organisationId: me.organisationId }, "PARTS", "edit");
  if (!allowed) return { ok: false, error: "No permission to export configuration" };
  const bytes = await buildSetupWorkbook(me.organisationId);
  const date = new Date().toISOString().slice(0, 10);
  return { ok: true, base64: Buffer.from(bytes).toString("base64"), fileName: "workshop-setup-" + date + ".xlsx" };
}

export interface PreviewResult {
  ok: true;
  versionOk: boolean;
  warnings: string[];
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

  const products = await db.product.findMany({
    where: { organisationId: me.organisationId },
    select: { sku: true, name: true, category: true, brand: true, unit: true, sellPriceSen: true, costPriceSen: true, minStock: true, safetyStock: true, leadTimeDays: true, barcode: true, manufacturerPartNo: true, compatibleModels: true, active: true },
  });
  const productRows = products.map((p) => ({ ...p, supplierName: "" }));

  const plans: RowPlan[] = [];
  const sheets: PreviewResult["sheets"] = [];
  for (const s of parsed.sheets) {
    if (s.key !== PRODUCTS_SHEET.key) continue;
    const { plans: sheetPlans, summary } = planSheet({
      def: PRODUCTS_SHEET,
      incoming: s.rows,
      existing: productRows,
      allowDelete: ORG_LEVEL.includes(me.role),
    });
    // 非 OWNER 的删除行会被 planSheet 标成 error（allowDelete=false），提示要说人话
    for (const p of sheetPlans) {
      if (p.action === "error" && p.errors.some((e) => e.includes("cannot be deleted"))) {
        p.errors = ["Only the owner can delete rows"];
      }
    }
    plans.push(...sheetPlans);
    sheets.push({ key: s.key, title: s.title, found: s.found, summary: { ...summary, error: sheetPlans.filter((p) => p.action === "error").length }, warnings: s.warnings });
  }
  if (sheets.length === 0 || sheets.every((s) => !s.found)) {
    return { ok: false, error: "This file has no sheet I can read (expected the Products sheet)" };
  }

  return { ok: true, versionOk: parsed.versionOk, warnings: parsed.warnings, sheets, plans };
}

/** 应用（只有点击确认才会走到这里）。 */
export async function applySetupImport(input: { plans: RowPlan[] }): Promise<{ ok: true; summary: { created: number; updated: number; deleted: number; deactivated: number; skipped: number } } | { ok: false; error: string }> {
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

  const res = await applyProductPlans({ organisationId: me.organisationId, userId: me.userId, branchId: me.branchId, plans: input.plans });
  if (res.ok) {
    revalidatePath("/workshop/inventory/products");
    revalidatePath("/workshop/setup");
  }
  return res;
}
