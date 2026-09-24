/**
 * 交叉检查：**每一张表的删除检测**（老板反馈「删了一行但没检测到」时补的）。
 *
 * 对生产数据跑（连接串从 .env 的 DST_DATABASE_URL 取）：
 *   DATABASE_URL="$(grep '^DST_DATABASE_URL=' .env | cut -d= -f2-)" pnpm exec tsx scripts/check-bulk-deletes.ts
 *
 * 两种「删」必须分清楚，它们的行为**故意**不同：
 *   A. 在 _action 列写 delete     → 应该检测为删除（前提是键的字段还填着）
 *   B. 在 Excel 里把那行删掉       → **不删**（＝「这次没提到」），这是本项目最强的安全规则：
 *                                    文件里没有的行绝不删除，否则一份残缺的文件会清空库
 * 这个脚本把两种都跑一遍，逐张表报结果 —— 免得靠猜。
 */

import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { buildSetupWorkbook } from "@/modules/bulk/export";
import { parseSetupWorkbook } from "@/modules/bulk/parse";
import { planSheet, type RowPlan } from "@/modules/bulk/diff";
import { buildExistingRows } from "@/modules/bulk/existing";
import { SHEETS, type SheetDef } from "@/modules/bulk/sheets";

async function scope() {
  const org = await db.organisation.findFirst();
  if (!org) throw new Error("No organisation");
  const branch =
    (await db.branch.findFirst({ where: { organisationId: org.id, isMain: true } })) ??
    (await db.branch.findFirst({ where: { organisationId: org.id } }));
  if (!branch) throw new Error("No branch");
  return { organisationId: org.id, branchId: branch.id };
}

function plansFor(def: SheetDef, parsed: Awaited<ReturnType<typeof parseSetupWorkbook>>, existing: Record<string, unknown>[]): RowPlan[] {
  const sheet = parsed.sheets.find((s) => s.key === def.key);
  if (!sheet || !sheet.found) return [];
  return planSheet({ def, incoming: sheet.rows, existing }).plans;
}

async function main() {
  const s = await scope();
  const existing = await buildExistingRows(s);
  const bytes = await buildSetupWorkbook(s);
  console.log("工作簿 " + bytes.byteLength.toLocaleString() + " 字节");
  console.log("");
  console.log("【A】在 _action 列写 delete（第一行数据）");
  console.log("表".padEnd(14) + "现状行数  检测到   说明");

  let badA = 0;
  for (const def of SHEETS) {
    const rows = existing[def.key] ?? [];
    if (rows.length === 0) {
      console.log(def.key.padEnd(14) + "0          跳过     表里没数据");
      continue;
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as never);
    const ws = wb.getWorksheet(def.title.slice(0, 31));
    if (!ws) {
      console.log(def.key.padEnd(14) + String(rows.length).padEnd(10) + "✗ 找不到表  " + def.title);
      badA += 1;
      continue;
    }
    // _action 现在在第一列，但**按表头找**而不是写死位置（列序改过一次了）
    let actionCol = 1;
    ws.getRow(1).eachCell((cell, col) => {
      if (String(cell.value ?? "").trim() === "_action") actionCol = col;
    });
    const headerOfAction = ws.getCell(1, actionCol).value;
    ws.getCell(2, actionCol).value = "delete";
    const out = await wb.xlsx.writeBuffer();
    const parsed = await parseSetupWorkbook(new Uint8Array(out as ArrayBuffer));
    const plans = plansFor(def, parsed, rows);
    const del = plans.filter((p) => p.action === "delete").length;
    const err = plans.filter((p) => p.action === "error").length;
    const ok = del === 1;
    if (!ok) badA += 1;
    console.log(
      def.key.padEnd(14) + String(rows.length).padEnd(10) +
      (ok ? "✓ 1 条" : "✗ " + del + " 条") + "  " +
      "action列头=" + String(headerOfAction) + (err ? " | 报错行 " + err : ""),
    );
  }

  console.log("");
  console.log("【B】把那行从 Excel 里删掉（应当**不删**）");
  let badB = 0;
  for (const def of SHEETS) {
    const rows = existing[def.key] ?? [];
    if (rows.length === 0) continue;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as never);
    const ws = wb.getWorksheet(def.title.slice(0, 31));
    if (!ws) continue;
    ws.spliceRows(2, 1);   // 删掉第一行数据
    const out = await wb.xlsx.writeBuffer();
    const parsed = await parseSetupWorkbook(new Uint8Array(out as ArrayBuffer));
    const plans = plansFor(def, parsed, rows);
    const del = plans.filter((p) => p.action === "delete").length;
    const ok = del === 0;
    if (!ok) badB += 1;
    console.log(def.key.padEnd(14) + (ok ? "✓ 没有删除（符合设计）" : "✗ 竟然删了 " + del + " 条") );
  }

  console.log("");
  console.log(badA === 0 && badB === 0 ? "结论：两种行为都符合设计 ✓" : "结论：A 有 " + badA + " 项、B 有 " + badB + " 项异常 ✗");
  await db.$disconnect();
  process.exit(badA + badB === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("检查脚本失败:", (e as Error).message);
  await db.$disconnect();
  process.exit(1);
});
