import type { ColumnDef, SheetDef } from "./sheets";

/**
 * 工作簿导入的**差异计算**（纯函数 —— 不碰数据库，所以每一条安全规则都能被单测钉住）。
 *
 * 三条安全规则（写在代码里，也写在这里，免得以后有人"简化"掉）：
 *  ① **文件里没有的行，绝不删除**。要删必须在 _action 列显式写 delete。
 *     否则老板拿着上周的工作簿上传一次，之后新建的东西会全部消失。
 *  ② **留空 = 不动**，不是"清成 0/空"。空单元格把价格清零是最容易发生、最难发现的事故。
 *  ③ **出错就不应用这一张 sheet**。宁可让人再传一次，也不要半对半错地写进去。
 */

/** 显式删除标记所在的列名（工作簿里可以加这一列，也可以完全不写）。 */
export const ACTION_COLUMN = "_action";

export type RowAction = "create" | "update" | "delete" | "skip" | "error";

export interface IncomingRow {
  /** 在工作簿里的真实行号 —— 出错时能直接指回那一行 */
  rowNumber: number;
  /** 按 field 名给出的原始单元格值 */
  cells: Record<string, unknown>;
  /** 来自 _action 列：upsert（默认）| delete | skip */
  action?: "upsert" | "delete" | "skip";
}

export interface RowPlan {
  sheet: string;
  rowNumber: number;
  key: string;
  action: RowAction;
  /** 要写入的字段（update 时只含**确实变了**的字段） */
  values: Record<string, unknown>;
  changes: { field: string; from: unknown; to: unknown }[];
  errors: string[];
}

export interface SheetSummary {
  create: number;
  update: number;
  delete: number;
  skip: number;
  error: number;
}

export function emptySummary(): SheetSummary {
  return { create: 0, update: 0, delete: 0, skip: 0, error: 0 };
}

export function summarize(plans: RowPlan[]): SheetSummary {
  const s = emptySummary();
  for (const p of plans) {
    if (p.action === "create") s.create += 1;
    else if (p.action === "update") s.update += 1;
    else if (p.action === "delete") s.delete += 1;
    else if (p.action === "skip") s.skip += 1;
    else s.error += 1;
  }
  return s;
}

/** 解析金额：接受 12.5 / "12.50" / "RM 12.50" / "1,234.50"，一律转成 sen（分）。 */
export function parseMoney(raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const s = String(raw).replace(/rm/gi, "").replace(/[,\s]/g, "");
  if (s === "") return { ok: true, value: 0 };
  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false, error: "not a number (" + String(raw) + ")" };
  if (n < 0) return { ok: false, error: "cannot be negative" };
  return { ok: true, value: Math.round(n * 100) };
}

export function parseBool(raw: unknown, map?: Record<string, string>): boolean | null {
  const s = String(raw).trim().toLowerCase();
  if (s === "") return null;
  const mapped = map?.[s] ?? s;
  if (["true", "yes", "y", "1", "是"].includes(mapped)) return true;
  if (["false", "no", "n", "0", "否"].includes(mapped)) return false;
  return null;
}

/** 单元格 → 系统值。**留空一律返回 undefined（= 不动）**。 */
export function cellToValue(col: ColumnDef, raw: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const empty = raw === null || raw === undefined || String(raw).trim() === "";
  if (empty) return { ok: true, value: undefined };

  switch (col.type) {
    case "money": {
      const r = parseMoney(raw);
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    case "int": {
      const n = Number(String(raw).replace(/[,\s]/g, ""));
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: "not a whole number (" + String(raw) + ")" };
      return { ok: true, value: Math.round(n) };
    }
    case "bool": {
      const b = parseBool(raw, col.enumMap);
      if (b === null) return { ok: false, error: "expected Yes/No, got " + String(raw) };
      return { ok: true, value: b };
    }
    case "enum": {
      const s = String(raw).trim().toLowerCase();
      const mapped = col.enumMap?.[s];
      if (!mapped) {
        const allowed = Object.keys(col.enumMap ?? {}).slice(0, 6).join(" / ");
        return { ok: false, error: "unknown value (" + String(raw) + "); allowed: " + allowed };
      }
      return { ok: true, value: mapped };
    }
    default:
      return { ok: true, value: String(raw).trim() };
  }
}

/** 把一行单元格解析成 { field: value } + 逐列错误。 */
export function parseIncomingRow(
  def: SheetDef,
  row: IncomingRow,
): { values: Record<string, unknown>; errors: string[] } {
  const values: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const col of def.columns) {
    const res = cellToValue(col, row.cells[col.field]);
    if (!res.ok) errors.push(col.header + ": " + res.error);
    else if (res.value !== undefined) values[col.field] = res.value;
  }
  return { values, errors };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined || a === null || b === null) return a === b;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  return String(a).trim() === String(b).trim();
}

/**
 * 计算一张 sheet 的差异。
 * existing 是数据库现状（每条含 keyField）；**无论文件里有什么，existing 里没被提到的行都不会进 plans**
 * —— 这正是"不进则不删"在代码里的落点。
 */
export function planSheet(input: {
  def: SheetDef;
  incoming: IncomingRow[];
  existing: Record<string, unknown>[];
  /** 允许删除（默认取 def.allowDelete）；明细类不允许独立删 */
  allowDelete?: boolean;
}): { plans: RowPlan[]; summary: SheetSummary } {
  const { def, incoming, existing } = input;
  const allowDelete = input.allowDelete ?? def.allowDelete;
  const byKey = new Map<string, Record<string, unknown>>();
  for (const e of existing) byKey.set(String(e[def.keyField] ?? "").trim().toLowerCase(), e);

  const plans: RowPlan[] = [];
  const seen = new Set<string>();

  for (const row of incoming) {
    const { values, errors } = parseIncomingRow(def, row);
    const key = String(values[def.keyField] ?? "").trim();

    if (row.action === "skip") {
      plans.push({ sheet: def.key, rowNumber: row.rowNumber, key, action: "skip", values: {}, changes: [], errors: [] });
      continue;
    }
    if (!key) errors.push(def.keyHeader + " is required (it is how a row is matched)");
    if (key && seen.has(key.toLowerCase()) && row.action !== "delete") {
      errors.push("duplicate " + def.keyHeader + " in this file: " + key);
    }
    if (key) seen.add(key.toLowerCase());

    const current = key ? byKey.get(key.toLowerCase()) : undefined;

    if (row.action === "delete") {
      if (!allowDelete) errors.push("rows in this sheet cannot be deleted on their own");
      if (key && !current) errors.push("nothing to delete: " + key + " does not exist");
      plans.push({
        sheet: def.key, rowNumber: row.rowNumber, key,
        action: errors.length ? "error" : "delete",
        values: {}, changes: [], errors,
      });
      continue;
    }

    if (errors.length) {
      plans.push({ sheet: def.key, rowNumber: row.rowNumber, key, action: "error", values: {}, changes: [], errors });
      continue;
    }

    if (!current) {
      // 新增：必填项必须在文件里给出（修改时留空=不动，所以只有这里检查）
      const missing = def.columns.filter((c) => c.required && values[c.field] === undefined).map((c) => c.header);
      if (missing.length) {
        plans.push({
          sheet: def.key, rowNumber: row.rowNumber, key, action: "error", values: {},
          changes: [], errors: ["required for a new row: " + missing.join(", ")],
        });
        continue;
      }
      plans.push({ sheet: def.key, rowNumber: row.rowNumber, key, action: "create", values, changes: [], errors: [] });
      continue;
    }

    const changes: { field: string; from: unknown; to: unknown }[] = [];
    const next: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(values)) {
      if (!sameValue(current[field], value)) {
        changes.push({ field, from: current[field] ?? null, to: value });
        next[field] = value;
      }
    }
    plans.push({
      sheet: def.key, rowNumber: row.rowNumber, key,
      action: changes.length ? "update" : "skip",
      values: next, changes, errors: [],
    });
  }

  return { plans, summary: summarize(plans) };
}
