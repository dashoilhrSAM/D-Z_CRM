import { keyOf, type ColumnDef, type SheetDef } from "./sheets";

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

/**
 * 行的标识：**界面与服务器必须用同一套算法**（决定存下来之后是按这个键找回来的）。
 * 放在这里而不是 sessions.ts，因为客户端组件也要用它 —— 而 sessions.ts 会拖进 prisma。
 */
export const rowKeyOf = (sheet: string, rowNumber: number) => sheet + "#" + rowNumber;

/**
 * 这张表在**文件声明**的范围内吗？
 *
 * declared 为空（老文件没写元数据）＝ 按「全都算包含」处理（向后兼容）。
 * 这一条是老板反馈后的修复：上传只含部分表的文件时，**没勾选的表在文件里当然是 0 行**，
 * 如果照「库里 82 行、文件里 0 行」去算，每张没勾的表都会弹「少了 82 行」——一堆假警报。
 * 没勾的表是「**这次不涉及**」，不是「少了行」。
 */
export function isSheetDeclared(declared: string[] | null | undefined, key: string): boolean {
  return !declared || declared.length === 0 || declared.includes(key);
}

/** 缺行数：**只在文件声明包含这张表时**才算（否则一律 0，避免上面那种假警报） */
export function missingRows(
  declared: string[] | null | undefined,
  key: string,
  fileRows: number,
  dbRows: number,
): number {
  if (!isSheetDeclared(declared, key)) return 0;
  return Math.max(0, dbRows - fileRows);
}

/**
 * 审核台里「这张表要不要显示」。
 *
 * 规则：**有改动，或者文件里比库里少行** —— 后者正是老板「删掉一行」的场景，
 * 那时候零改动，而提示恰恰最需要出现。
 * （生产验证抓到过：原来的判断只看「有没有改动」，所以那种情况什么都不显示。
 *  抽成纯函数就是为了让这条规则可以被测。）
 */
export function shouldShowSheet(actionableRows: number, missing: number): boolean {
  return actionableRows > 0 || missing > 0;
}

/**
 * 审核台每张表一次列多少行（界面「显示全部」按钮的第一段）。
 *
 * 为什么不能只是「切掉多余的行」：**没列出来的行你批不了**，
 * 而应用时只写已批准的行 —— 于是它们**静默地没被写入**，界面却像全都处理完了。
 * 所以超出部分必须能展开。
 */
export const ROW_PAGE = 200;
export function visibleRowCount(total: number, showAll: boolean): number {
  return showAll ? total : Math.min(total, ROW_PAGE);
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
    case "date": {
      // 业务日期一律存 UTC 零点（本项目约定）—— 用本地时刻会让 +8 与生产 UTC 显示不一致
      const s = String(raw).trim();
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
      if (!m) return { ok: false, error: "expected YYYY-MM-DD, got " + s };
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      if (Number.isNaN(d.getTime())) return { ok: false, error: "not a valid date: " + s };
      return { ok: true, value: d };
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
    else if (res.value !== undefined) {
      // transform：把值归一化到**和数据库一致的形式**再做比较与匹配
      // （例：车牌大小写/空格、车主手机号的 +60 与 0 前缀、破折号空格 —— 生产里三种写法都真实存在）
      values[col.field] = col.transform && typeof res.value === "string" ? col.transform(res.value) : res.value;
    }
  }
  return { values, errors };
}

/**
 * 日期按**天**比较。
 *
 * 为什么必须这样：数据库里的促销起止时间带时刻（生产实测全是 10:00:58Z），
 * 而工作簿里这一列是**日期**。按时刻比较 → 每条促销都被判成"改了"，
 * 而一旦点应用，那个时刻会被写成 UTC 零点 —— **静默抹掉**。
 * 日期列本来就是天精度，所以比较也按天；只有真的换了日期才算改动。
 */
function sameDay(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || a === "" || b === null || b === undefined || b === "") return a === b;
  const da = a instanceof Date ? a : new Date(String(a));
  const db = b instanceof Date ? b : new Date(String(b));
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return da.toISOString().slice(0, 10) === db.toISOString().slice(0, 10);
}

/** 值比较（日期按天）。供 apply 的「预览是否过期」检测复用。 */
export function sameValue(a: unknown, b: unknown): boolean {
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
  // 键可能是复合的（套餐明细＝套餐名 + 项目名）—— 一律走 keyOf，别在两处各拼一遍
  const normKey = (k: string) => (def.keyTransform ? def.keyTransform(k) : k).toLowerCase();
  const byKey = new Map<string, Record<string, unknown>>();
  for (const e of existing) byKey.set(normKey(keyOf(def, e)), e);

  const plans: RowPlan[] = [];
  const seen = new Set<string>();

  for (const row of incoming) {
    const { values, errors } = parseIncomingRow(def, row);
    const key = keyOf(def, values);
    const matchKey = normKey(key);

    if (row.action === "skip") {
      plans.push({ sheet: def.key, rowNumber: row.rowNumber, key, action: "skip", values: {}, changes: [], errors: [] });
      continue;
    }
    if (!key) errors.push(def.keyHeader + " is required (it is how a row is matched)");
    if (key && seen.has(matchKey) && row.action !== "delete") {
      errors.push("duplicate row in this file: " + key);
    }
    if (key) seen.add(matchKey);

    const missingKeyParts = (def.extraKeyFields ?? []).filter((f) => !String(values[f] ?? "").trim());
    if (missingKeyParts.length) errors.push("missing key column(s): " + missingKeyParts.join(", "));
    const current = key ? byKey.get(matchKey) : undefined;

    if (row.action === "delete") {
      // 报错要说人话：老板删了一行没检测到，就是因为规则没被讲清楚
      if (!allowDelete) {
        errors.push("This sheet does not allow deleting rows (" + def.title + ") — it is maintained inside the app");
      }
      if (missingKeyParts.length) {
        errors.push(
          "to delete a row, keep its key column(s) filled: " + missingKeyParts.join(", ") +
          " (only the _action cell needs \"delete\")",
        );
      }
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
      // 这一张表不允许新建（服务目录由代码定义）→ 明确报错，而不是悄悄造一行
      if (def.createAllowed === false) {
        plans.push({
          sheet: def.key, rowNumber: row.rowNumber, key, action: "error", values: {}, changes: [],
          errors: ["This sheet only edits rows that already exist — new entries are added inside the app"],
        });
        continue;
      }
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
    const keyNames = [def.keyField, ...(def.extraKeyFields ?? [])];
    for (const [field, value] of Object.entries(values)) {
      // **键字段是身份，不是数据**：车牌/手机号的写法差异（大小写、空格）不该被当成一次修改，
      // 否则库里那句 VLL 3302 会被文件里的 vll3302 覆盖掉 —— 看不出错，但格式会慢慢变味。
      if (keyNames.includes(field)) continue;
      const col = def.columns.find((c) => c.field === field);
      const equal = col?.type === "date" ? sameDay(current[field], value) : sameValue(current[field], value);
      if (!equal) {
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
