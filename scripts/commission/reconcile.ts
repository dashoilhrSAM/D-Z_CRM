// 佣金对账 CLI（P2 起，P4 改为调用模块）。
//
// 判定逻辑**全部在 src/modules/commission/reconcile.ts** —— 因为同一条规则还要在结算页上
// 显示横幅（设计稿 §4.5：「不给'就这样付了'的机会」）。脚本与页面共用一份实现，
// 避免出现"脚本说没事、页面说有事"。
//
// 用法：
//   DATABASE_URL="file:./dev.db" pnpm exec tsx scripts/commission/reconcile.ts
//   DATABASE_URL="file:./dev.db" pnpm exec tsx scripts/commission/reconcile.ts --window 2026-09
//
// 退出码：硬不变量被破坏 → 1（可挂进定时任务）；只有"待复核"这类提示 → 0。
import { db } from "../../src/lib/db";
import { runCommissionReconciliation } from "../../src/modules/commission/reconcile";

const rm = (sen: number) => "RM " + (sen / 100).toFixed(2);
const windowArgIdx = process.argv.indexOf("--window");
const onlyWindow = windowArgIdx > -1 ? process.argv[windowArgIdx + 1] : null;

async function main() {
  const r = await runCommissionReconciliation({ windowKey: onlyWindow });

  console.log("=== ① 每一条计费行是否都有归属（不变量 2）===");
  console.log("  已计提工单里的计费行:", r.stats.billableLines);
  console.log("  历史工单（P2 之前完工，无台账 —— 设计稿定的是历史不重算）:", r.stats.historicalLines + " 行",
    r.stats.historicalJobs.length ? "如 " + r.stats.historicalJobs.join(", ") : "");
  console.log("  ✅ 重复计提:", r.stats.duplicated.length === 0 ? "没有（唯一键在守着）" : r.stats.duplicated.length + " 条 ❌");
  console.log("  ⏳ 待归属:", r.stats.pending.length);
  for (const p of r.stats.pending.slice(0, 5)) console.log("      " + p);
  console.log("  ⚠️  未被规则覆盖（按旧的人员级结算走，台账留 0 痕迹）:", r.stats.uncovered.length);
  for (const u of r.stats.uncovered.slice(0, 5)) console.log("      " + u);

  console.log("");
  console.log("=== ② 每个结算窗口：佣金 ≤ 营业额（不变量 3）===");
  if (r.windows.length === 0) console.log("  （台账为空，还没有计提过）");
  for (const w of r.windows) {
    console.log("  " + w.windowKey + " | 台账 BASE " + rm(w.baseSen).padEnd(12) + " 调整 " + rm(w.adjustSen).padEnd(11) +
      " | 发票收入 " + rm(w.revenueSen).padEnd(13) + " | 占比 " + (w.ratioPct === null ? "n/a" : w.ratioPct.toFixed(2) + "%") +
      " （" + w.invoiceCount + " 张）");
  }

  console.log("");
  console.log("=== ③ 台账 vs 结算（不变量 1，P4 之后结算就是从台账来的）===");
  if (r.payoutDrift.length === 0) console.log("  （还没有结算记录）");
  for (const d of r.payoutDrift.slice(0, 12)) {
    const flag = d.kind === "MATCH" ? "✅" : d.kind === "LEGACY" ? "—" : d.status === "PAID" ? "⚠️" : "❌";
    console.log("  " + flag + " " + d.windowKey + " | " + d.userName.padEnd(18) + " 台账 " + rm(d.ledgerSen).padEnd(11) +
      " 结算 " + rm(d.payoutSen).padEnd(11) + " 差 " + rm(d.diffSen) + (d.kind === "LEGACY" ? "（历史，无台账）" : ""));
  }

  console.log("");
  console.log("=== ④ 需要人工复核的台账行 ===");
  console.log("  规则冲突当时生效（AMBIGUOUS）:", r.stats.ambiguousCount);
  console.log("  人工调整/冲正:", r.stats.adjustmentCount);

  console.log("");
  if (!r.ok) {
    console.log("❌ 对账未通过：");
    for (const f of r.hardFailures) console.log("   - " + f);
    process.exitCode = 1;
  } else {
    console.log("✅ 对账通过（硬不变量全部成立）");
  }
  for (const n of r.notes) console.log("提醒: " + n);
}

main()
  .catch((e) => {
    console.error("对账脚本失败:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
