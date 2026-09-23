// 佣金对账（P2）—— 设计稿 §4.5 的三条不变量，做成能定时跑的报告。
//
// 为什么要有它：佣金算错不会报错，只会**静默地**给人错的数字。所以必须有一张"最后一道网"，
// 定期回答三个问题：每一条计费行都有归属吗？佣金有没有超过营业额？台账和结算对不对得上？
//
// 用法：
//   DATABASE_URL="file:./dev.db" pnpm exec tsx scripts/commission/reconcile.ts
//   DATABASE_URL="file:./dev.db" pnpm exec tsx scripts/commission/reconcile.ts --window 2026-09
//
// 退出码：不变量被破坏 → 1（可以挂进定时任务/CI）；只是有"待归属"这类提示 → 0。
import { db } from "../../src/lib/db";
import { windowKeyOf, isBillableLine } from "../../src/lib/commission/apportion";

const rm = (sen: number) => "RM " + (sen / 100).toFixed(2);
const windowArgIdx = process.argv.indexOf("--window");
const onlyWindow = windowArgIdx > -1 ? process.argv[windowArgIdx + 1] : null;

async function main() {
  const hardFailures: string[] = [];
  const notes: string[] = [];

  const jobs = await db.serviceJob.findMany({
    where: { status: "COMPLETED" },
    include: { items: true, invoice: true, mechanic: { select: { name: true } } },
    orderBy: { completedAt: "desc" },
  });
  const ledger = await db.commissionLedger.findMany();
  const byItem = new Map<string, typeof ledger>();
  for (const row of ledger) {
    if (!row.jobItemId) continue;
    byItem.set(row.jobItemId, [...(byItem.get(row.jobItemId) ?? []), row]);
  }

  console.log("=== ① 每一条计费行是否都有归属（设计稿不变量 2）===");
  let billableCount = 0;
  let historicalLines = 0;
  const historicalJobs: string[] = [];
  const uncovered: string[] = [];
  const pending: string[] = [];
  const duplicated: string[] = [];
  for (const job of jobs) {
    // **历史工单**（这笔工单在台账里一行都没有）与"配置缺口"是两件事：
    // P2 之前完工的单子本来就没有台账，而设计稿明确"历史不重算"。混在一起报，
    // 会让报告天天红着说 17 行有问题 —— 那是狼来了，真正的缺口反而被淹没。
    const jobHasLedger = ledger.some((r) => r.jobId === job.id);
    const billable = job.items.filter(isBillableLine);
    if (!jobHasLedger) {
      historicalLines += billable.length;
      if (billable.length && historicalJobs.length < 5) historicalJobs.push(job.jobNumber);
      continue;
    }
    for (const item of billable) {
      billableCount += 1;
      const rows = byItem.get(item.id) ?? [];
      const bases = rows.filter((r) => r.kind === "BASE");
      if (bases.length > 1) duplicated.push(job.jobNumber + " / " + item.description + " (" + bases.length + " 条 BASE)");
      if (rows.some((r) => r.kind === "PENDING")) pending.push(job.jobNumber + " / " + item.description + " → " + rm(item.lineTotalSen));
      else if (bases.length === 0) uncovered.push(job.jobNumber + " / " + item.description + " (" + rm(item.lineTotalSen) + ")");
    }
  }
  console.log("  已计提工单里的计费行:", billableCount);
  console.log("  历史工单（P2 之前完工，无台账 —— 设计稿定的是历史不重算）:", historicalLines + " 行", historicalJobs.length ? "如 " + historicalJobs.join(", ") : "");
  if (duplicated.length) {
    hardFailures.push("同一计费行出现多条 BASE：" + duplicated.slice(0, 5).join("; "));
    console.log("  ❌ 重复计提:", duplicated.length);
  } else {
    console.log("  ✅ 没有一条行被计提两次（唯一键在守着）");
  }
  console.log("  ⏳ 待归属（完工时没有技师，钱少给了要有人看得见）:", pending.length);
  for (const p of pending.slice(0, 5)) console.log("      " + p);
  console.log("  ⚠️  未被规则覆盖（按旧的人员级结算走，台账留 0 痕迹）:", uncovered.length);
  for (const u of uncovered.slice(0, 5)) console.log("      " + u);
  if (pending.length) notes.push(pending.length + " 条计费行尚未归属（未指派技师），请工头补指派后重算");

  console.log("");
  console.log("=== ② 每个结算窗口：佣金 ≤ 营业额（设计稿不变量 3）===");
  const windows = [...new Set(ledger.map((r) => r.windowKey))].sort();
  if (windows.length === 0) console.log("  （台账为空，还没有计提过）");
  for (const w of windows) {
    if (onlyWindow && w !== onlyWindow) continue;
    const base = ledger.filter((r) => r.windowKey === w && r.kind === "BASE").reduce((s, r) => s + r.amountSen, 0);
    const adjust = ledger.filter((r) => r.windowKey === w && (r.kind === "ADJUSTMENT" || r.kind === "REVERSAL")).reduce((s, r) => s + r.amountSen, 0);
    const [y, m] = w.split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
    const inv = await db.invoice.aggregate({ where: { issuedAt: { gte: from, lt: to } }, _sum: { totalSen: true }, _count: true });
    const revenue = inv._sum.totalSen ?? 0;
    const pct = revenue > 0 ? ((base / revenue) * 100).toFixed(2) + "%" : "n/a";
    console.log("  " + w + " | 台账 BASE " + rm(base).padEnd(12) + " 调整 " + rm(adjust).padEnd(11) + " | 发票收入 " + rm(revenue).padEnd(13) + " | 占比 " + pct + " （" + inv._count + " 张）");
    if (revenue > 0 && base > revenue) {
      hardFailures.push(w + " 的佣金（" + rm(base) + "）超过了该窗口发票收入（" + rm(revenue) + "）");
    }
  }

  console.log("");
  console.log("=== ③ 台账 vs 结算（设计稿不变量 1）===");
  const payouts = await db.staffPayout.findMany({ include: { user: { select: { name: true } } } });
  if (payouts.length === 0) {
    console.log("  （还没有结算记录，P4 才做台账→结算的整合）");
  } else {
    for (const p of payouts.slice(0, 8)) {
      const key = windowKeyOf(p.periodStart);
      const ledgerSum = ledger.filter((r) => r.userId === p.userId && r.windowKey === key && r.kind !== "PENDING" && r.kind !== "LEGACY").reduce((s, r) => s + r.amountSen, 0);
      const diff = ledgerSum - p.commissionSen;
      console.log("  " + key + " | " + p.user.name.padEnd(18) + " 台账 " + rm(ledgerSum).padEnd(11) + " 结算 " + rm(p.commissionSen).padEnd(11) + " 差 " + rm(diff));
    }
    console.log("  说明：结算目前仍由旧的按人算法生成，P4 才切到台账 —— 这里先呈现差额，不判红。");
  }

  console.log("");
  console.log("=== ④ 需要人工复核的台账行 ===");
  const ambiguous = ledger.filter((r) => (r.reason ?? "").includes("AMBIGUOUS"));
  const adjustments = ledger.filter((r) => r.kind === "ADJUSTMENT" || r.kind === "REVERSAL");
  console.log("  规则冲突当时生效（AMBIGUOUS）:", ambiguous.length);
  console.log("  人工调整/冲正:", adjustments.length);
  for (const a of adjustments.slice(0, 5)) console.log("      " + rm(a.amountSen) + " — " + (a.reason ?? ""));

  console.log("");
  if (hardFailures.length) {
    console.log("❌ 对账未通过：");
    for (const f of hardFailures) console.log("   - " + f);
    process.exitCode = 1;
  } else {
    console.log("✅ 对账通过（硬不变量全部成立）");
  }
  for (const n of notes) console.log("提醒: " + n);
}

main()
  .catch((e) => {
    console.error("对账脚本失败:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
