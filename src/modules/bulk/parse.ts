import ExcelJS from "exceljs";
import { META_SHEET, SHEETS, WORKBOOK_VERSION, type SheetDef } from "./sheets";
import { ACTION_COLUMN, type IncomingRow } from "./diff";

/**
 * 读工作簿 → 每张 sheet 的原始行（P2）。
 *
 * **刻意宽容**：老板可能拿自己的模板改（表头在第 3 行），也可能拿我们导出的（表头在第 1 行），
 * 所以这里是**扫描前 10 行找表头**，而不是假定第 1 行。列名也同时认英文、中文、系统字段名三种写法。
 * 宽容的是"怎么放"，不是"什么意思" —— 值的解析（金额/枚举）仍然严格。
 */

export interface ParsedSheet {
  key: string;
  title: string;
  found: boolean;
  headerRowNumber: number;
  rows: IncomingRow[];
  warnings: string[];
}

export interface ParsedWorkbook {
  version: number | null;
  versionOk: boolean;
  /** 文件属于哪个分店（套餐/促销按分店存 —— 以**文件里写的**为准，不信调用方传的） */
  branchId: string | null;
  branchName: string | null;
  /**
   * 这份文件**声明包含**哪些 sheet（导出时写进元数据）。
   * null ＝ 老文件没写，按「全都算包含」处理（向后兼容）。
   * 有值时：不在清单里的 sheet 是「**这次不涉及**」，不是「这张表是空的」——
   * 否则你只想改零件、传一份只含零件的文件，系统会把套餐/车辆当成全空。
   */
  declaredSheets: string[] | null;
  /** 只要模板导出的文件（没有数据行） */
  templateOnly: boolean;
  sheets: ParsedSheet[];
  warnings: string[];
}

/** exceljs 的单元格可能是字符串/数字/富文本/公式对象 —— 一律取成标量。 */
function cellScalar(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const v = value as { result?: unknown; text?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (v.result !== undefined) return cellScalar(v.result);
    if (typeof v.text === "string") return v.text;
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    return String(value);
  }
  return value;
}

function normalizeHeader(v: unknown): string {
  return String(cellScalar(v) ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** 找到这一 sheet 的表头行（前 10 行内命中最多列名的那个）。 */
function findHeaderRow(ws: ExcelJS.Worksheet, def: SheetDef): { rowNumber: number; map: Map<number, string>; actionCol: number | null } | null {
  const aliases = new Map<string, string>();
  for (const c of def.columns) {
    for (const name of [c.header, c.zh, c.field]) aliases.set(normalizeHeader(name), c.field);
  }
  let best: { rowNumber: number; map: Map<number, string>; actionCol: number | null; hits: number } | null = null;
  const maxRow = Math.min(ws.rowCount, 10);
  for (let r = 1; r <= maxRow; r++) {
    const map = new Map<number, string>();
    let actionCol: number | null = null;
    ws.getRow(r).eachCell((cell, colNumber) => {
      const h = normalizeHeader(cell.value);
      if (!h) return;
      if (h === ACTION_COLUMN || h === "action" || h === "操作") { actionCol = colNumber; return; }
      const field = aliases.get(h);
      if (field) map.set(colNumber, field);
    });
    if (map.size > (best?.hits ?? 0)) best = { rowNumber: r, map, actionCol, hits: map.size };
  }
  // 至少认出一半的列才算表头（避免把标题行误当表头）
  if (!best || best.hits < Math.max(2, Math.ceil(def.columns.length / 3))) return null;
  return { rowNumber: best.rowNumber, map: best.map, actionCol: best.actionCol };
}

export async function parseSetupWorkbook(data: Uint8Array): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  // 传 ArrayBuffer：Node 的 Buffer 泛型与 exceljs 的签名对不上（不是运行时问题，只是类型）
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  await wb.xlsx.load(buffer);
  const warnings: string[] = [];

  let version: number | null = null;
  let branchId: string | null = null;
  let branchName: string | null = null;
  let declaredSheets: string[] | null = null;
  let templateOnly = false;
  const meta = wb.getWorksheet(META_SHEET);
  if (meta) {
    meta.eachRow((row) => {
      const [k, v] = [String(cellScalar(row.getCell(1).value) ?? ""), String(cellScalar(row.getCell(2).value) ?? "")];
      if (k === "version") version = Number(v);
      if (k === "branchId") branchId = v || null;
      if (k === "branchName") branchName = v || null;
      if (k === "sheets") declaredSheets = v ? v.split(",").map((x) => x.trim()).filter(Boolean) : null;
      if (k === "templateOnly") templateOnly = v === "1";
    });
  } else {
    warnings.push("No version marker in this file (it may be one of your own templates)");
  }
  const versionOk = version === null || version === WORKBOOK_VERSION;
  if (version !== null && !versionOk) {
    warnings.push("Workbook version " + version + " does not match this app (" + WORKBOOK_VERSION + ") - re-export and try again");
  }

  const sheets: ParsedSheet[] = [];
  for (const def of SHEETS) {
    // sheet 名按前缀匹配（老板可能在后面加字，例如「产品目录 Products (2026)」）
    const prefix = def.title.split(" ")[0];
    // exceljs 的工作表属性叫 name（不是 title）
    const ws = wb.worksheets.find((w) => w.name.trim() === def.title)
      ?? wb.worksheets.find((w) => w.name.includes(prefix))
      ?? wb.worksheets.find((w) => w.name.toLowerCase().includes(def.title.split(" ").pop()!.toLowerCase()));
    const sheetWarnings: string[] = [];
    if (!ws) {
      sheets.push({ key: def.key, title: def.title, found: false, headerRowNumber: 0, rows: [], warnings: ["Sheet not found - nothing to import from it"] });
      continue;
    }
    const header = findHeaderRow(ws, def);
    if (!header) {
      sheets.push({ key: def.key, title: def.title, found: true, headerRowNumber: 0, rows: [], warnings: ["Could not find the header row (expected columns like " + def.keyHeader + ")"] });
      continue;
    }
    const missing = def.columns.filter((c) => c.required && ![...header.map.values()].includes(c.field));
    if (missing.length) sheetWarnings.push("Missing column(s): " + missing.map((c) => c.header).join(", "));

    const rows: IncomingRow[] = [];
    for (let r = header.rowNumber + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: Record<string, unknown> = {};
      let anyValue = false;
      for (const [colNumber, field] of header.map.entries()) {
        const v = cellScalar(row.getCell(colNumber).value);
        if (v !== null && String(v).trim() !== "") anyValue = true;
        cells[field] = v;
      }
      if (!anyValue) continue; // 整行空白 = 老板在 Excel 里留的空行
      let action: IncomingRow["action"] = "upsert";
      if (header.actionCol) {
        const raw = String(cellScalar(row.getCell(header.actionCol).value) ?? "").trim().toLowerCase();
        if (raw === "delete" || raw === "删" || raw === "删除") action = "delete";
        else if (raw === "skip" || raw === "跳过") action = "skip";
      }
      rows.push({ rowNumber: r, cells, action });
    }
    sheets.push({ key: def.key, title: def.title, found: true, headerRowNumber: header.rowNumber, rows, warnings: sheetWarnings });
  }

  return { version, versionOk, branchId, branchName, declaredSheets, templateOnly, sheets, warnings };
}
