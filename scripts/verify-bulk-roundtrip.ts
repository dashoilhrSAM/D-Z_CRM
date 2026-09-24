/**
 * 批量配置的**生产验收**：往返 + 选择性下载 + 模板模式。
 *
 * 对生产跑（连接串从 .env 的 DST_DATABASE_URL 取，不打印任何机密）：
 *
 *   DATABASE_URL="$(grep '^DST_DATABASE_URL=' .env | cut -d= -f2-)" \
 *     pnpm exec tsx scripts/verify-bulk-roundtrip.ts
 *
 * 为什么要有这个脚本，而不是每次临时敲命令：
 *  - 「测试全绿」不等于真实数据能往返（夹具永远比生产干净）；
 *  - 「零改动」这个结论本身也可能是假的 —— 所以这里**逐张表读数字**，
 *    每张表都必须报告「读到了几行、几条改动」，而不是只报一个总数。
 *    总数会把「某张表根本没读进来」掩盖成「没有变化」。
 */

import { db } from "@/lib/db";
import { buildSetupWorkbook } from "@/modules/bulk/export";
import { parseSetupWorkbook } from "@/modules/bulk/parse";
import { planSheet, summarize } from "@/modules/bulk/diff";
import { buildExistingRows } from "@/modules/bulk/existing";
import { SHEETS } from "@/modules/bulk/sheets";

const ORG_ID = process.env.VERIFY_ORG_ID;
const onlyThree = ["products", "customers", "motorcycles"];

async function scope() {
  const org = ORG_ID
    ? await db.organisation.findUnique({ where: { id: ORG_ID } })
    : await db.organisation.findFirst();
  if (!org) throw new Error("No organisation found");
  const branch = await db.branch.findFirst({ where: { organisationId: org.id, isMain: true } })
    ?? await db.branch.findFirst({ where: { organisationId: org.id } });
  if (!branch) throw new Error("No branch found");
  return { organisationId: org.id, branchId: branch.id, orgName: org.name, branchName: branch.name };
}

function line(label: string, value: string) {
  console.log("   " + label.padEnd(22) + value);
}

async function main() {
  const s = await scope();
  const host = (process.env.DATABASE_URL ?? "").replace(/:[^:@]+@/, ":***@").slice(0, 60);
  console.log("库: " + host);
  line("组织", s.orgName);
  line("分店", s.branchName);
  console.log("");

  let failed = 0;

  // ── 1. 全量往返：逐张表读数字，要求零改动 ────────────────────────────────
  console.log("【1】全量往返（八张表，要求全部零改动）");
  const bytes = await buildSetupWorkbook({ organisationId: s.organisationId, branchId: s.branchId });
  console.log("   工作簿 " + bytes.byteLength.toLocaleString() + " 字节");
  const parsed = await parseSetupWorkbook(bytes);
  console.log("   文件声明包含: " + (parsed.declaredSheets ?? []).join(", "));
  console.log("   版本校验: " + (parsed.versionOk ? "OK" : "不匹配") + (parsed.warnings.length ? " | 警告 " + parsed.warnings.length : ""));

  const existing = await buildExistingRows({ organisationId: s.organisationId, branchId: s.branchId });
  let totalRows = 0;
  for (const def of SHEETS) {
    const sheet = parsed.sheets.find((x) => x.key === def.key);
    if (!sheet || !sheet.found) {
      console.log("   " + def.key.padEnd(14) + " 文件里没有这张表");
      failed += 1;
      continue;
    }
    const { summary } = planSheet({ def, incoming: sheet.rows, existing: existing[def.key] ?? [] });
    totalRows += sheet.rows.length;
    const changed = summary.create + summary.update + summary.delete + summary.error;
    const ok = changed === 0;
    if (!ok) failed += 1;
    console.log(
      "   " + def.key.padEnd(14) + String(sheet.rows.length).padStart(4) + " 行 | 现状 " +
      String((existing[def.key] ?? []).length).padStart(4) + " | 改动 " + changed +
      (ok ? "  ✓" : "  ✗ 有改动/出错"),
    );
  }
  line("合计行数", String(totalRows));

  // ── 2. 选择性下载：没被勾的表不能被当成「空表」────────────────────────────
  console.log("");
  console.log("【2】选择性下载（只勾 3 张：" + onlyThree.join(", ") + "）");
  const partial = await buildSetupWorkbook({ organisationId: s.organisationId, branchId: s.branchId, sheets: onlyThree });
  const parsedPartial = await parseSetupWorkbook(partial);
  const declared = parsedPartial.declaredSheets ?? [];
  const declaredOk = declared.length === onlyThree.length && onlyThree.every((k) => declared.includes(k));
  console.log("   文件声明包含: " + declared.join(", ") + (declaredOk ? "  ✓" : "  ✗"));
  if (!declaredOk) failed += 1;
  const absentOk = SHEETS.filter((d) => !onlyThree.includes(d.key))
    .every((d) => !(parsedPartial.sheets.find((x) => x.key === d.key)?.found ?? false));
  console.log("   未勾选的表在文件里确实不存在: " + (absentOk ? "✓（＝这次不涉及，不是空表）" : "✗"));
  if (!absentOk) failed += 1;
  for (const k of onlyThree) {
    const def = SHEETS.find((d) => d.key === k)!;
    const sheet = parsedPartial.sheets.find((x) => x.key === k)!;
    console.log("   " + k.padEnd(14) + String(sheet.rows.length).padStart(4) + " 行" +
      (sheet.rows.length > 0 ? "  ✓" : "  ✗ 空表（勾了却没数据）"));
    if (sheet.rows.length === 0) failed += 1;
    void def;
  }

  // ── 3. 模板模式：只有表头、零数据行 ───────────────────────────────────────
  console.log("");
  console.log("【3】模板模式（只要表头，不带数据）");
  const tpl = await buildSetupWorkbook({ organisationId: s.organisationId, branchId: s.branchId, templateOnly: true });
  const parsedTpl = await parseSetupWorkbook(tpl);
  let tplRows = 0;
  for (const def of SHEETS) {
    const sheet = parsedTpl.sheets.find((x) => x.key === def.key);
    if (sheet?.found) tplRows += sheet.rows.length;
  }
  console.log("   模板数据行合计: " + tplRows + (tplRows === 0 ? "  ✓" : "  ✗ 应该为 0"));
  if (tplRows !== 0) failed += 1;

  console.log("");
  console.log(failed === 0 ? "结论：全部通过 ✓" : "结论：有 " + failed + " 项不通过 ✗");
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("验收脚本失败:", (e as Error).message);
  await db.$disconnect();
  process.exit(1);
});
