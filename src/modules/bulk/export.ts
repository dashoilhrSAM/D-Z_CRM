import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import {
  META_SHEET, SHEETS, PRODUCTS_SHEET, PACKAGES_SHEET, PACKAGE_ITEMS_SHEET, CAMPAIGNS_SHEET,
  WORKBOOK_VERSION, type SheetDef,
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
  ws.addRow(def.columns.map((c) => c.header));
  ws.getRow(1).font = { bold: true };
  // **不要在数据表里加第二行中文表头** —— 解析器把表头之后的一切都当数据，
  // 那一行会变成一条假记录（闭环测试第一次跑就是这么红的）。
  // 中文列名统一放在「列对照」sheet 里，与老板现有模板的写法一致。
  for (const r of rows) {
    ws.addRow(def.columns.map((c) => toDisplay(def, c.field, r[c.field])));
  }
  ws.columns.forEach((col) => {
    col.width = 18;
  });
  // _action 列：留空=新增或修改；写 delete 才删
  ws.getCell(1, def.columns.length + 1).value = "_action";
  ws.getCell(1, def.columns.length + 1).font = { bold: true, color: { argb: "FFB45309" } };
  return ws;
}

function addMappingSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("列对照");
  ws.addRow(["Sheet", "Column (EN)", "Column (中文)", "System field", "Note"]);
  ws.getRow(1).font = { bold: true };
  for (const def of SHEETS) {
    for (const c of def.columns) {
      ws.addRow([def.title, c.header, c.zh, c.field, c.note ?? ""]);
    }
    ws.addRow([def.title, "_action", "操作", "_action", "留空=新增/修改; delete=删除"]);
  }
  ws.columns.forEach((c) => {
    c.width = 22;
  });
}

export interface ExportScope {
  organisationId: string;
  /** 套餐/促销所属分店（产品不需要） */
  branchId: string;
}

export async function buildSetupWorkbook(scope: ExportScope): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "D&Z Workshop OS";
  wb.created = new Date();

  const branch = await db.branch.findUnique({ where: { id: scope.branchId }, select: { name: true, organisationId: true } });
  if (!branch || branch.organisationId !== scope.organisationId) throw new Error("Branch not found in this organisation");

  const meta = wb.addWorksheet(META_SHEET);
  meta.state = "hidden";
  meta.addRow(["version", WORKBOOK_VERSION]);
  meta.addRow(["exportedAt", new Date().toISOString()]);
  meta.addRow(["branchId", scope.branchId]);
  meta.addRow(["branchName", branch.name]);

  const [products, packages, packageItems, campaigns] = await Promise.all([
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
  ]);

  addDataSheet(wb, PRODUCTS_SHEET, products.map((p) => ({
    sku: p.sku, name: p.name, category: p.category ?? "", brand: p.brand ?? "", unit: p.unit,
    sellPriceSen: p.sellPriceSen, costPriceSen: p.costPriceSen, minStock: p.minStock, safetyStock: p.safetyStock,
    leadTimeDays: p.leadTimeDays, barcode: p.barcode ?? "", manufacturerPartNo: p.manufacturerPartNo ?? "",
    compatibleModels: p.compatibleModels ?? "", supplierName: p.supplier?.name ?? "",
  })));

  addDataSheet(wb, PACKAGES_SHEET, packages.map((p) => ({
    name: p.name, tier: p.tier, priceSen: p.priceSen, description: p.description ?? "", isBestValue: p.isBestValue,
  })));

  addDataSheet(wb, PACKAGE_ITEMS_SHEET, packageItems.map((i) => ({
    packageName: i.package.name, itemName: i.name, kind: i.kind, productSku: i.product?.sku ?? "",
    defaultQty: i.defaultQty, priceSen: i.priceSen,
  })));

  addDataSheet(wb, CAMPAIGNS_SHEET, campaigns.map((c) => ({
    name: c.name, type: c.type, status: c.status, startDate: c.startDate, endDate: c.endDate,
    discountPercent: c.discountPercent ?? "", pointsBonus: c.pointsBonus ?? "", audience: c.audience ?? "",
  })));

  addMappingSheet(wb);
  const out = await wb.xlsx.writeBuffer();
  return new Uint8Array(out as ArrayBuffer);
}
