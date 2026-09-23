"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/session-user";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { planSheet, type RowPlan, type SheetSummary } from "@/modules/bulk/diff";
import { PRODUCTS_SHEET, PACKAGES_SHEET, PACKAGE_ITEMS_SHEET, CAMPAIGNS_SHEET } from "@/modules/bulk/sheets";
import { buildSetupWorkbook } from "@/modules/bulk/export";
import { parseSetupWorkbook } from "@/modules/bulk/parse";
import { applyPlans } from "@/modules/bulk/apply";

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

/** 下载当前配置（工作簿）。套餐/促销按分店，所以必须指定分店 —— 文件里会写明是哪一个。 */
export async function exportSetupWorkbook(input: { branchId?: string }): Promise<
  { ok: true; base64: string; fileName: string } | { ok: false; error: string }
> {
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

  const bytes = await buildSetupWorkbook({ organisationId: me.organisationId, branchId });
  const date = new Date().toISOString().slice(0, 10);
  const slug = branch.name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "branch";
  return { ok: true, base64: Buffer.from(bytes).toString("base64"), fileName: "workshop-setup-" + slug + "-" + date + ".xlsx" };
}

export interface PreviewResult {
  ok: true;
  versionOk: boolean;
  warnings: string[];
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

  const [products, packages, packageItems, campaigns] = await Promise.all([
    db.product.findMany({
      where: { organisationId: me.organisationId },
      // **必须带上供应商名**：导出的文件里写着供应商名，现状里没有的话，
      // 每个有供应商的零件都会被误报成"有改动"（假差异比不预览更糟）
      include: { supplier: { select: { name: true } } },
    }),
    db.servicePackage.findMany({ where: { branchId }, select: { name: true, tier: true, priceSen: true, description: true, isBestValue: true } }),
    db.servicePackageItem.findMany({
      where: { package: { branchId } },
      include: { package: { select: { name: true } }, product: { select: { sku: true } } },
    }),
    db.campaign.findMany({
      where: { branchId },
      select: { name: true, type: true, status: true, startDate: true, endDate: true, discountPercent: true, pointsBonus: true, audience: true },
    }),
  ]);
  const existingBySheet: Record<string, Record<string, unknown>[]> = {
    [PRODUCTS_SHEET.key]: products.map((p) => ({ ...p, supplierName: p.supplier?.name ?? "" })),
    [PACKAGES_SHEET.key]: packages,
    [PACKAGE_ITEMS_SHEET.key]: packageItems.map((i) => ({
      packageName: i.package.name, itemName: i.name, kind: i.kind, productSku: i.product?.sku ?? "",
      defaultQty: i.defaultQty, priceSen: i.priceSen,
    })),
    [CAMPAIGNS_SHEET.key]: campaigns,
  };
  const defBySheet: Record<string, typeof PRODUCTS_SHEET> = {
    [PRODUCTS_SHEET.key]: PRODUCTS_SHEET,
    [PACKAGES_SHEET.key]: PACKAGES_SHEET,
    [PACKAGE_ITEMS_SHEET.key]: PACKAGE_ITEMS_SHEET,
    [CAMPAIGNS_SHEET.key]: CAMPAIGNS_SHEET,
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
    plans.push(...sheetPlans);
    sheets.push({ key: s.key, title: s.title, found: true, summary: { ...summary, error: sheetPlans.filter((p) => p.action === "error").length }, warnings: s.warnings });
  }
  if (sheets.length === 0 || sheets.every((s) => !s.found)) {
    return { ok: false, error: "This file has no sheet I can read — export a fresh copy from this page" };
  }

  return { ok: true, versionOk: parsed.versionOk, warnings: parsed.warnings, branchId, branchName: branch.name, sheets, plans };
}

/** 应用（只有点击确认才会走到这里）。 */
export async function applySetupImport(input: { plans: RowPlan[]; branchId: string }): Promise<{ ok: true; summary: Record<string, { created: number; updated: number; deleted: number; deactivated: number; skipped: number }> } | { ok: false; error: string }> {
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
  });
  if (res.ok) {
    revalidatePath("/workshop/inventory/products");
    revalidatePath("/workshop/setup");
  }
  return res;
}
