import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { ACTION_COLUMN } from "./diff";
import {
  META_SHEET, SHEETS, PRODUCTS_SHEET, PACKAGES_SHEET, PACKAGE_ITEMS_SHEET, CAMPAIGNS_SHEET,
  SUPPLIERS_SHEET, SERVICE_TYPES_SHEET, MOTORCYCLES_SHEET, CUSTOMERS_SHEET, WORKBOOK_VERSION, type SheetDef,
} from "./sheets";

/**
 * 导出「当前配置」工作簿（P2）。
 *
 * **导出的不是空模板，是现状**：老板要的是"下载我现在的配置、改几个数、传回去"，
 * 空模板逼他重录一遍，而且没填的字段很容易被当成"要清空"。
 *
 * **分店写进文件里**（隐藏 _meta sheet）：套餐与促销是按分店存的，老板看得到全部分店，
 * 所以"这份文件属于哪个分店"必须**跟着文件走** —— 否则把 A 店的文件导进 B 店，
 * 没有任何人会察觉，直到客户看到不该看到的套餐。产品是组织级，不分店。
 *
 * 金额在文件里是 **RM**（与他现有模板一致），系统里是 sen —— 转换只在这一层做。
 */

function toDisplay(def: SheetDef, field: string, value: unknown): unknown {
  const col = def.columns.find((c) => c.field === field);
  if (!col) return value;
  if (col.type === "money" && typeof value === "number") return value / 100;
  if (col.type === "bool") return value ? "Yes" : "No";
  if (col.type === "date" && value instanceof Date) return value.toISOString().slice(0, 10);
  if (value === null || value === undefined) return "";
  return value;
}

function addDataSheet(wb: ExcelJS.Workbook, def: SheetDef, rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(def.title.slice(0, 31));
  // **_action 放第一列**：它原本在最右边，老板删了一行却「没检测到」——
  // 因为规则是「删行要在这里写 delete」，而那一列太容易被滑过去（这一条是真实反馈）。
  ws.addRow([ACTION_COLUMN, ...def.columns.map((c) => c.header)]);
  ws.getRow(1).font = { bold: true };
  ws.getCell(1, 1).font = { bold: true, color: { argb: "FFB45309" } };
  // **不要在数据表里加第二行中文表头** —— 解析器把表头之后的一切都当数据，
  // 那一行会变成一条假记录（闭环测试第一次跑就是这么红的）。
  // 中文列名统一放在「列对照」sheet 里，与老板现有模板的写法一致。
  for (const r of rows) {
    // 第一格留空 = 新增或修改；写 delete 才删
    ws.addRow(["", ...def.columns.map((c) => toDisplay(def, c.field, r[c.field]))]);
  }
  ws.columns.forEach((col) => {
    col.width = 18;
  });
  return ws;
}

function addMappingSheet(wb: ExcelJS.Workbook, sheets: SheetDef[]) {
  const ws = wb.addWorksheet("列对照");
  ws.addRow(["Sheet", "Column (EN)", "Column (中文)", "System field", "Note"]);
  ws.getRow(1).font = { bold: true };
  for (const def of sheets) {
    for (const c of def.columns) {
      ws.addRow([def.title, c.header, c.zh, c.field, c.note ?? ""]);
    }
    ws.addRow([
      def.title, "_action", "操作（第一列）", "_action",
      "留空=新增/修改；写 delete 才删除。文件里没有的行永远不会被删除（只看这一列）",
    ]);
  }
  ws.columns.forEach((c) => {
    c.width = 22;
  });
}

export interface ExportScope {
  organisationId: string;
  /** 套餐/促销所属分店（产品不需要） */
  branchId: string;
  /**
   * 只导出这几张 sheet（缺省＝全部）。
   * **这份清单会写进文件的元数据** —— 导入时只处理文件里有的部分：
   * 「没包含」是「这次不涉及」，不是「这张表是空的」。
   */
  sheets?: string[];
  /** 只要模板：只有表头与列对照，不带任何数据行 */
  templateOnly?: boolean;
}

export async function buildSetupWorkbook(scope: ExportScope): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "D&Z Workshop OS";
  wb.created = new Date();

  const branch = await db.branch.findUnique({ where: { id: scope.branchId }, select: { name: true, organisationId: true } });
  if (!branch || branch.organisationId !== scope.organisationId) throw new Error("Branch not found in this organisation");

  // 这次导出包含哪些 sheet（导入时按它判断"这份文件覆盖了哪些部分"）
  const wanted = scope.sheets && scope.sheets.length > 0 ? SHEETS.filter((s) => scope.sheets!.includes(s.key)) : SHEETS;
  if (wanted.length === 0) throw new Error("Pick at least one sheet to export");

  const meta = wb.addWorksheet(META_SHEET);
  meta.state = "hidden";
  meta.addRow(["version", WORKBOOK_VERSION]);
  meta.addRow(["exportedAt", new Date().toISOString()]);
  meta.addRow(["branchId", scope.branchId]);
  meta.addRow(["branchName", branch.name]);
  meta.addRow(["sheets", wanted.map((s) => s.key).join(",")]);
  meta.addRow(["templateOnly", scope.templateOnly ? "1" : "0"]);

  const [products, packages, packageItems, campaigns, suppliers, serviceTypes, motorcycles, customers] = await Promise.all([
    db.product.findMany({
      where: { organisationId: scope.organisationId },
      include: { supplier: { select: { name: true } } },
      orderBy: { sku: "asc" },
    }),
    db.servicePackage.findMany({ where: { branchId: scope.branchId }, orderBy: { name: "asc" } }),
    db.servicePackageItem.findMany({
      where: { package: { branchId: scope.branchId } },
      include: { package: { select: { name: true } }, product: { select: { sku: true } } },
      orderBy: { name: "asc" },
    }),
    db.campaign.findMany({ where: { branchId: scope.branchId }, orderBy: { name: "asc" } }),
    db.supplier.findMany({ where: { organisationId: scope.organisationId }, orderBy: { name: "asc" } }),
    // 服务目录由代码同步进库；没有 code 的行无法作为键，导出时跳过（它们也不该被 Excel 改）
    db.serviceType.findMany({ where: { organisationId: scope.organisationId, code: { not: null } }, orderBy: { code: "asc" } }),
    // 车辆挂在客户身上，客户是组织级的 → 用 customer.organisationId 收窄
    db.motorcycle.findMany({
      where: { customer: { organisationId: scope.organisationId } },
      include: { customer: { select: { phone: true } } },
      orderBy: { plate: "asc" },
    }),
    // **手机号是键**：没有手机号的客户导出了也无法被识别（会变成一行错误，把整份文件挡住），
    // 所以不导出它们 —— 与服务目录里"没有 code 的行不导出"同一条处理
    db.customer.findMany({
      where: { organisationId: scope.organisationId, phone: { not: null } },
      orderBy: { name: "asc" },
    }),
  ]);

  // ── 只导出被勾选的 sheet；「只要模板」时不带数据行 ───────────────────────
  const dataBySheet: { def: SheetDef; rows: Record<string, unknown>[] }[] = [
    { def: PRODUCTS_SHEET, rows: products.map((p) => ({
      sku: p.sku, name: p.name, category: p.category ?? "", brand: p.brand ?? "", unit: p.unit,
      sellPriceSen: p.sellPriceSen, costPriceSen: p.costPriceSen, minStock: p.minStock, safetyStock: p.safetyStock,
      leadTimeDays: p.leadTimeDays, barcode: p.barcode ?? "", manufacturerPartNo: p.manufacturerPartNo ?? "",
      compatibleModels: p.compatibleModels ?? "", supplierName: p.supplier?.name ?? "",
    })) },
    { def: PACKAGES_SHEET, rows: packages.map((p) => ({
      name: p.name, tier: p.tier, priceSen: p.priceSen, description: p.description ?? "", isBestValue: p.isBestValue,
    })) },
    { def: PACKAGE_ITEMS_SHEET, rows: packageItems.map((i) => ({
      packageName: i.package.name, itemName: i.name, kind: i.kind, productSku: i.product?.sku ?? "",
      defaultQty: i.defaultQty, priceSen: i.priceSen,
    })) },
    { def: CAMPAIGNS_SHEET, rows: campaigns.map((c) => ({
      name: c.name, type: c.type, status: c.status, startDate: c.startDate, endDate: c.endDate,
      discountPercent: c.discountPercent ?? "", pointsBonus: c.pointsBonus ?? "", audience: c.audience ?? "",
    })) },
    { def: SUPPLIERS_SHEET, rows: suppliers.map((s) => ({
      name: s.name, contactName: s.contactName ?? "", phone: s.phone ?? "", email: s.email ?? "",
      address: s.address ?? "", leadTimeDays: s.leadTimeDays,
    })) },
    { def: SERVICE_TYPES_SHEET, rows: serviceTypes.map((s) => ({
      code: s.code, name: s.name, category: s.category ?? "", durationMin: s.durationMin ?? "",
      priceSen: s.priceSen ?? "", active: s.active,
    })) },
    { def: CUSTOMERS_SHEET, rows: customers.filter((c) => (c.phone ?? "").trim() !== "").map((c) => ({
      name: c.name, phone: c.phone ?? "", email: c.email ?? "",
      address: c.address ?? "", tags: c.tags ?? "", notes: c.notes ?? "",
    })) },
    { def: MOTORCYCLES_SHEET, rows: motorcycles.map((m) => ({
      plate: m.plate, type: m.type, customerPhone: m.customer.phone ?? "",
      brand: m.brand, model: m.model, year: m.year, currentMileage: m.currentMileage,
      vin: m.vin ?? "", engineNo: m.engineNo ?? "", color: m.color ?? "",
    })) },
  ];
  for (const entry of dataBySheet) {
    if (!wanted.some((w) => w.key === entry.def.key)) continue;
    addDataSheet(wb, entry.def, scope.templateOnly ? [] : entry.rows);
  }

  addMappingSheet(wb, wanted);
  const out = await wb.xlsx.writeBuffer();
  return new Uint8Array(out as ArrayBuffer);
}
