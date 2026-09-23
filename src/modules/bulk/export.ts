import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { META_SHEET, PRODUCTS_SHEET, WORKBOOK_VERSION, type SheetDef } from "./sheets";

/**
 * 导出「当前配置」工作簿（P2）。
 *
 * **导出的不是空模板，是现状**：老板要的是"下载我现在的配置、改几个数、传回去"，
 * 空模板逼他重录一遍，而且很容易把没填的字段当成"要清空"。
 *
 * 金额在文件里是 **RM**（与他现有模板一致），系统里是 sen —— 转换只在这一层做。
 */

function toDisplay(def: SheetDef, field: string, value: unknown): unknown {
  const col = def.columns.find((c) => c.field === field);
  if (!col) return value;
  if (col.type === "money" && typeof value === "number") return value / 100;
  if (col.type === "bool") return value ? "Yes" : "No";
  if (value === null || value === undefined) return "";
  return value;
}

function addDataSheet(wb: ExcelJS.Workbook, def: SheetDef, rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(def.title.slice(0, 31));
  ws.addRow(def.columns.map((c) => c.header));
  ws.getRow(1).font = { bold: true };
  // **不要在数据表里加第二行中文表头** —— 解析器把表头之后的一切都当数据，
  // 那一行会变成一条 sku="SKU" 的假产品（闭环测试第一次跑就是这么红的）。
  // 中文列名统一放在「列对照」sheet 里，与老板现有模板的写法一致。
  for (const r of rows) {
    ws.addRow(def.columns.map((c) => toDisplay(def, c.field, r[c.field])));
  }
  ws.columns.forEach((col) => {
    col.width = 18;
  });
  // _action 列：留空=新增或修改；写 delete 才删（第三列之外的地方不动它）
  ws.getCell(1, def.columns.length + 1).value = "_action";
  ws.getCell(1, def.columns.length + 1).font = { bold: true, color: { argb: "FFB45309" } };
  return ws;
}

/** 列对照表：与老板现有模板同一种写法（英文 / 中文 / 系统字段 / 说明）。 */
function addMappingSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("列对照");
  ws.addRow(["Sheet", "Column (EN)", "Column (中文)", "System field", "Note"]);
  ws.getRow(1).font = { bold: true };
  for (const def of [PRODUCTS_SHEET]) {
    for (const c of def.columns) {
      ws.addRow([def.title, c.header, c.zh, c.field, c.note ?? ""]);
    }
  }
  ws.columns.forEach((c) => {
    c.width = 22;
  });
}

export async function buildSetupWorkbook(organisationId: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "D&Z Workshop OS";
  wb.created = new Date();

  const meta = wb.addWorksheet(META_SHEET);
  meta.state = "hidden";
  meta.addRow(["version", WORKBOOK_VERSION]);
  meta.addRow(["exportedAt", new Date().toISOString()]);

  // **v1 只做 Products**（老板 2026-09-23 批准的 v1 是三张 sheet；动手时发现套餐/促销都按分店存，
  // 而 Product 是组织级、SKU 全局唯一 —— 没有"导出哪个分店"的歧义。先把最大的痛点做透：
  // 82 个 SKU、价格常改、一次改几十条。套餐与促销要等老板定"按哪个分店"再上。
  const products = await db.product.findMany({
    where: { organisationId },
    include: { supplier: { select: { name: true } } },
    orderBy: { sku: "asc" },
  });

  addDataSheet(wb, PRODUCTS_SHEET, products.map((p) => ({
    sku: p.sku, name: p.name, category: p.category ?? "", brand: p.brand ?? "", unit: p.unit,
    sellPriceSen: p.sellPriceSen, costPriceSen: p.costPriceSen, minStock: p.minStock, safetyStock: p.safetyStock,
    leadTimeDays: p.leadTimeDays, barcode: p.barcode ?? "", manufacturerPartNo: p.manufacturerPartNo ?? "",
    compatibleModels: p.compatibleModels ?? "", supplierName: p.supplier?.name ?? "",
  })));

  addMappingSheet(wb);
  const out = await wb.xlsx.writeBuffer();
  return new Uint8Array(out as ArrayBuffer);
}
