#!/usr/bin/env node
/**
 * build-budget-workbook.mjs — 生成「三档容量预算」工作簿（给财务/合伙人看的版本）。
 *
 * **这张表里没有一个金额是手填的**：用量、Vercel 四项拆分、照片存储与出网全部来自
 * scripts/perf/capacity-model.mjs --json；只有「Supabase 计划费与 compute 档位」是计划选择
 * （Pro $25 / Small $15 / Medium $60 / Large $110 + 磁盘 $15）。
 *
 * 数字来源：
 *   - 单位成本（每次渲染 6 条 SQL、43 核·毫秒/请求、80KB 载荷）：2026-09-30 压测实测，见
 *     docs/CAPACITY_AND_UPGRADE_PLAN.md §6
 *   - 费率与 Supabase 成本构成：同上 §2.2 / §3.3
 * 改了假设请改 capacity-model.mjs 再重跑本脚本。
 */
import ExcelJS from "exceljs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const OUT = process.argv[2] ?? "docs/CAPACITY_BUDGET_T1T2T3.xlsx";

const MODEL = JSON.parse(
  execFileSync("node", ["scripts/perf/capacity-model.mjs", "--json"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }),
);
const r0 = (n) => Math.round(n);
// Supabase 里属于「计划选择」的部分（不是算出来的）
const SB_PLAN = { T1: { pro: 25, compute: 15, disk: 15 }, T2: { pro: 25, compute: 60, disk: 15 }, T3: { pro: 25, compute: 110, disk: 15 } };
const TIERS = MODEL.tiers.map((t) => {
  const plan = SB_PLAN[t.name];
  const storage = r0(t.storageMo12), egress = r0(t.egressMo);
  const storageFixed = r0(t.storageMo12Fixed), egressFixed = r0(t.egressMoFixed);
  const sbTotal = plan.pro + plan.compute + plan.disk + storage + egress;
  const sbFixed = plan.pro + plan.compute + plan.disk + storageFixed + egressFixed;
  return {
    ...t,
    vercelTotal: r0(t.vercel.total), vercelFixed: r0(t.vercelFixed),
    sb: { ...plan, storage, egress, total: sbTotal },
    sbFixed: { storage: storageFixed, egress: egressFixed, total: sbFixed },
    total: r0(t.vercel.total) + sbTotal,
    totalFixed: r0(t.vercelFixed) + sbFixed,
  };
});
const T3 = TIERS[TIERS.length - 1];

const MONEY = '"$"#,##0';
const wb = new ExcelJS.Workbook();
wb.creator = "D&Z CRM 容量评估";

// ── 表 1：预算总表 ───────────────────────────────────────────────
const s1 = wb.addWorksheet("预算总表");
s1.addRow(["D&Z CRM · 三档规模容量预算"]).font = { bold: true, size: 14 };
s1.addRow(["口径：dealer = 一家门店；每 dealer 5 机修 + 2 柜台，日 15 单，30 秒自动刷新，SOP 每单 5 张照片。含 Vercel Pro 平台费与 Supabase Pro 计划费。"]).font = { size: 9, color: { argb: "FF666666" } };
s1.addRow(["所有金额由 scripts/perf/capacity-model.mjs 算出（可复现）；单位成本为 2026-09-30 压测实测值。"]).font = { size: 9, color: { argb: "FF666666" } };
s1.addRow([]);
s1.addRow(["档", "dealer", "机修", "柜台", "单/天", "渲染/天", "峰值 QPS", "Vercel/月", "Supabase/月", "合计/月", "每 dealer/月", "修复后合计/月", "修复后每 dealer/月"]).font = { bold: true };
s1.lastRow.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } }; });
for (const t of TIERS) {
  const r = s1.addRow([t.name, t.dealers, t.mech, t.ws, t.jobs, t.renders, "~" + t.peakQps, t.vercelTotal, t.sb.total, t.total, t.total / t.dealers, t.totalFixed, t.totalFixed / t.dealers]);
  for (const i of [8, 9, 10, 12]) r.getCell(i).numFmt = MONEY;
  for (const i of [11, 13]) r.getCell(i).numFmt = '"$"#,##0.0';
  r.getCell(6).numFmt = "#,##0";
  if (t.name === "T3") r.font = { bold: true };
}
s1.addRow([]);
s1.addRow(["Vercel 用量明细（T3）", "金额/月", "占比"]).font = { bold: true };
for (const [label, val] of [
  ["Fast Data Transfer（页面数据传出）", T3.vercel.transfer],
  ["CDN 请求", T3.vercel.cdn],
  ["Provisioned Memory", T3.vercel.mem],
  ["Active CPU", T3.vercel.cpu],
]) {
  const r = s1.addRow([label, r0(val), val / T3.vercel.total]);
  r.getCell(2).numFmt = MONEY; r.getCell(3).numFmt = "0%";
}
{
  const r = s1.addRow(["合计（四项相加 = 上表 Vercel/月）", T3.vercelTotal, 1]);
  r.font = { bold: true }; r.getCell(2).numFmt = MONEY; r.getCell(3).numFmt = "0%";
}
s1.addRow([]);
s1.addRow(["Supabase 明细（T3，存储按 12 个月计）", "金额/月"]).font = { bold: true };
for (const [label, val] of [
  ["Pro 计划", T3.sb.pro],
  ["Compute（Large）", T3.sb.compute],
  ["磁盘 128 GB", T3.sb.disk],
  ["存储 " + r0(T3.photoGBday * 30 * 12 / 1024) + " TB（未压缩照片）", T3.sb.storage],
  ["出网（缓存）", T3.sb.egress],
]) s1.addRow([label, val]).getCell(2).numFmt = MONEY;
s1.addRow(["合计", T3.sb.total]).font = { bold: true };
s1.addRow([]);
s1.addRow(["未包含（按需另计）"]).font = { bold: true, color: { argb: "FFB45309" } };
for (const line of [
  "短信 / WhatsApp 通道费（按量计费）",
  "AI 能力调用费（AI 助手、内容引擎、海报生成）",
  "Sentry 等可观测性、域名",
  "人力成本",
]) s1.addRow(["· " + line]);
s1.getColumn(1).width = 42; for (const i of [2, 3, 4]) s1.getColumn(i).width = 9;
for (const i of [5, 6, 7]) s1.getColumn(i).width = 11;
for (const i of [8, 9, 10, 12]) s1.getColumn(i).width = 13;
s1.getColumn(11).width = 15; s1.getColumn(13).width = 18;

// ── 表 2：假设与依据 ─────────────────────────────────────────────
const s2 = wb.addWorksheet("假设与依据");
s2.addRow(["假设", "取值", "依据（可核对）"]).font = { bold: true };
for (const row of [
  ["每 dealer 单量", String(MODEL.assumptions.jobsPerDealerDay) + " 单/天", "5 机修 × 3 单/天（口径假设，可改）"],
  ["客户档案", String(MODEL.assumptions.customersPerDealer) + " 个/dealer", "业务口径假设"],
  ["每次渲染的 SQL 条数", String(MODEL.assumptions.qRender) + " 条", "2026-09-30 实测中位数（阶段 A）；重页面原为 15-34，已做有界化"],
  ["每个请求的服务端 CPU", String(MODEL.assumptions.cpuRenderMs) + " 核·毫秒", "2026-09-30 实测（阶段 B 混合负载 42.9-49.4）；本机 Apple Silicon，x86 通常更慢，预算留余量"],
  ["每次渲染传出的数据", String(MODEL.assumptions.rscKB) + " KB", "实测 dashboard 响应 74.5 KB（保守取 80）"],
  ["自动刷新间隔", String(MODEL.assumptions.refreshSec) + " 秒（占渲染 67%）", "源码 refresh-controls.tsx:11 的 AUTO_REFRESH_MS"],
  ["SOP 照片", String(MODEL.assumptions.photosPerJob) + " 张 × " + MODEL.assumptions.photoMB + " MB/单", "生产 dz-assets 实测 75 张：avg 2.65 / p90 3.31 / max 4.3 MB"],
  ["单实例吞吐上限", "160-185 req/s", "2026-09-30 实测（并发 5-120 扫描；p95 在 120 并发越过 500ms）"],
  ["Vercel 费率（sin1）", "CPU $" + MODEL.rates.cpu + "/核·时；内存 $" + MODEL.rates.mem + "/GB·时；CDN $" + MODEL.rates.cdn + "/百万；传输 $" + MODEL.rates.transfer + "/GB", "Vercel 官方区域定价（2026-09）"],
  ["Supabase 费率", "Pro $25；磁盘 $0.125/GB；存储 $0.0213/GB·月；出网 $0.09/GB（缓存 $0.03）", "Supabase 官方定价（2026-09）"],
  ["Fluid 内存口径", String(MODEL.assumptions.memGB) + " GB/实例", "Fluid compute 默认 2GB / 1vCPU"],
  ["修复后口径", "刷新 120 秒 + 照片压到 0.35 MB", "§5 升级阶梯；两项都已实现（PR #92 起）"],
]) s2.addRow(row);
s2.getColumn(1).width = 26; s2.getColumn(2).width = 54; s2.getColumn(3).width = 72;
s2.getRow(1).eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } }; });
s2.eachRow((row, i) => { if (i > 1) row.getCell(3).alignment = { wrapText: true, vertical: "top" }; });

// ── 表 3：省钱杠杆 ───────────────────────────────────────────────
const s3 = wb.addWorksheet("省钱杠杆");
s3.addRow(["杠杆", "做法", "效果", TIERS[0].name, TIERS[1].name, TIERS[2].name]).font = { bold: true };
s3.addRow([
  "降低渲染次数",
  "自动刷新 30 秒 → 120 秒（抖动已上线）",
  "渲染次数 −45%，Vercel 用量 −44%",
  ...TIERS.map((t) => "$" + t.vercelTotal + " → $" + t.vercelFixed),
]);
s3.addRow([
  "照片压缩",
  "客户端压到长边 1600 / q0.8（约 0.35 MB）",
  "存储与出网 −87%",
  ...TIERS.map((t) => "存储 $" + t.sb.storage + " → $" + t.sbFixed.storage),
]);
s3.addRow(["取数有界化", "客户页 / 工单页 / dashboard（2026-09-30 已修）", "每请求 CPU 从 1,626 → 43 核·毫秒；并发下不再反向下降", "已生效", "已生效", "已生效"]);
s3.addRow(["参考数据缓存", "ServiceType / 套餐 / 促销", "实测收益很小：阶段 A 显示它们几乎不在热点查询里 —— 已降级，暂不做", "—", "—", "—"]);
s3.addRow(["队列化与读副本", "消息 / 照片 / cron 分片；报表走读副本", "T2 / T3 之前再做（当前不是瓶颈）", "—", "T2 前", "T3"]);
s3.getColumn(1).width = 18; s3.getColumn(2).width = 40; s3.getColumn(3).width = 62;
for (const i of [4, 5, 6]) s3.getColumn(i).width = 18;
s3.getRow(1).eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } }; });
s3.eachRow((row, i) => { if (i > 1) { row.getCell(3).alignment = { wrapText: true, vertical: "top" }; row.alignment = { vertical: "top" }; } });

const abs = path.resolve(OUT);
await wb.xlsx.writeFile(abs);
console.log("已生成:", abs);
console.log("三档合计:", TIERS.map((t) => t.name + " $" + t.total + "（修复后 $" + t.totalFixed + "）").join("  |  "));
