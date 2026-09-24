import { db } from "@/lib/db";
import {
  CUSTOMERS_SHEET, CAMPAIGNS_SHEET, MOTORCYCLES_SHEET, PACKAGES_SHEET, PACKAGE_ITEMS_SHEET,
  PRODUCTS_SHEET, SERVICE_TYPES_SHEET, SHEETS, SUPPLIERS_SHEET, normalizePhone, type FieldType,
} from "./sheets";

/**
 * 「现状行」的**唯一**构造处。
 *
 * 为什么必须只有一份：差异计算是拿「文件里的值」对「现状里的值」。现状行少一个字段，
 * 每个有那个字段的行都会被误报成「有改动」——**假差异比不预览更糟**：
 * 老板会以为要改的东西比实际多，从而批准一堆其实没变、但他没细看的行。
 * 这个坑真踩过两次（导出写了 supplierName 而现状没有；车辆表的手机号一边归一化一边没有）。
 *
 * 所以：界面（Server Action）、验收脚本、将来的测试，全部走这里。
 */

export interface BulkScope {
  organisationId: string;
  /** 套餐/促销/套餐明细按分店；其余是组织级 */
  branchId: string;
}

/** 按 sheet 取现状行（字段名与列定义一致） */
export async function buildExistingRows(scope: BulkScope): Promise<Record<string, Record<string, unknown>[]>> {
  const { organisationId, branchId } = scope;
  const [products, packages, packageItems, campaigns, suppliers, serviceTypes, motorcycles, customers] =
    await Promise.all([
      db.product.findMany({
        where: { organisationId },
        // **必须带上供应商名**：文件里写着供应商名，现状里没有的话，
        // 每个有供应商的零件都会被误报成「有改动」
        include: { supplier: { select: { name: true } } },
      }),
      db.servicePackage.findMany({
        where: { branchId },
        select: { name: true, tier: true, priceSen: true, description: true, isBestValue: true },
      }),
      db.servicePackageItem.findMany({
        where: { package: { branchId } },
        include: { package: { select: { name: true } }, product: { select: { sku: true } } },
      }),
      db.campaign.findMany({
        where: { branchId },
        select: { name: true, type: true, status: true, startDate: true, endDate: true, discountPercent: true, pointsBonus: true, audience: true },
      }),
      db.supplier.findMany({
        where: { organisationId },
        select: { name: true, contactName: true, phone: true, email: true, address: true, leadTimeDays: true },
      }),
      // 服务目录只比对有 code 的行（没有 code 的无法作为键，也确实不该被 Excel 改）
      db.serviceType.findMany({
        where: { organisationId, code: { not: null } },
        select: { code: true, name: true, category: true, durationMin: true, priceSen: true, active: true },
      }),
      db.motorcycle.findMany({
        where: { customer: { organisationId } },
        include: { customer: { select: { phone: true } } },
      }),
      db.customer.findMany({
        where: { organisationId },
        select: { id: true, name: true, phone: true, email: true, address: true, tags: true, notes: true },
      }),
    ]);

  return {
    [PRODUCTS_SHEET.key]: products.map((p) => ({ ...p, supplierName: p.supplier?.name ?? "" })),
    [PACKAGES_SHEET.key]: packages,
    [PACKAGE_ITEMS_SHEET.key]: packageItems.map((i) => ({
      packageName: i.package.name, itemName: i.name, kind: i.kind, productSku: i.product?.sku ?? "",
      defaultQty: i.defaultQty, priceSen: i.priceSen,
    })),
    [CAMPAIGNS_SHEET.key]: campaigns,
    [SUPPLIERS_SHEET.key]: suppliers,
    [SERVICE_TYPES_SHEET.key]: serviceTypes,
    // 手机号在这里也归一化 —— 导入时会归一化文件里的值，两边必须同一套算法才比得上
    [MOTORCYCLES_SHEET.key]: motorcycles.map((m) => ({
      plate: m.plate, type: m.type, customerPhone: normalizePhone(m.customer.phone ?? ""),
      brand: m.brand, model: m.model, year: m.year, currentMileage: m.currentMileage,
      vin: m.vin ?? "", engineNo: m.engineNo ?? "", color: m.color ?? "",
    })),
    [CUSTOMERS_SHEET.key]: customers,
  };
}

/** 给界面渲染「就地修改」的输入控件用的列元数据 */
export interface SheetColumnMeta {
  field: string;
  header: string;
  zh: string;
  type: FieldType;
  required: boolean;
  options?: string[];
}

export function sheetColumns(): Record<string, SheetColumnMeta[]> {
  const out: Record<string, SheetColumnMeta[]> = {};
  for (const def of SHEETS) {
    out[def.key] = def.columns.map((c) => ({
      field: c.field,
      header: c.header,
      zh: c.zh,
      type: c.type,
      required: c.required ?? false,
      // 枚举列把 enumMap 的**取值**去重后给界面当选项（界面只看得到规范值，与库里一致）
      options: c.type === "enum" ? [...new Set(Object.values(c.enumMap ?? {}))] : undefined,
    }));
  }
  return out;
}
