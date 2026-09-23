import { t, tpl, type Lang } from "@/lib/i18n";
import { formatRM } from "@/lib/money";
import type { LedgerBreakdown } from "@/modules/commission/settlement";

// 「为什么是这个数」面板（设计稿 §7）。
//
// 佣金系统最容易失去信任的地方不是算错，而是**说不清**：技师看到 RM37.50，问"怎么来的"，
// 而系统只能回答一个总数 —— 于是每一次工资都要靠人对账，人对不上就不再相信它。
// 这个面板把本周期参与结算的每一行摊开：哪张工单、哪一条行、按什么规则、多少钱。
//
// 两条刻意的展示决定：
//  ① **PENDING / LEGACY 也要显示**（金额 0）：它们回答的是"这一行为什么没有钱"，
//     而那正是技师最需要看到的答案 —— 比多显示一行金额更重要；
//  ② **迟到的计提要标出来**（上月的工单本月完工）：否则技师会以为这个月凭空多了钱。

const KIND_KEY: Record<string, string> = {
  BASE: "ledger.kind-base",
  TIER_BONUS: "ledger.kind-tier",
  ADJUSTMENT: "ledger.kind-adjust",
  REVERSAL: "ledger.kind-reversal",
  PENDING: "ledger.kind-pending",
  LEGACY: "ledger.kind-legacy",
};

const BASIS_KEY: Record<string, string> = {
  PERCENT: "ledger.basis-percent",
  FIXED: "ledger.basis-fixed",
  TIER: "ledger.basis-tier",
  LEGACY: "ledger.basis-legacy",
};

export function LedgerBreakdownCard({ breakdown, lang }: { breakdown: LedgerBreakdown; lang: Lang }) {
  const { totals, lines } = breakdown;
  if (lines.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-4">
        <div className="font-semibold">{tpl("ledger.title", lang, { window: breakdown.windowKey })}</div>
        <p className="mt-2 text-sm text-muted-foreground">{t("ledger.empty", lang)}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-semibold">{tpl("ledger.title", lang, { window: breakdown.windowKey })}</div>
        <div className="text-sm font-semibold">{formatRM(totals.totalSen)}</div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-lg border bg-background/40 p-2">
          <div className="text-muted-foreground">{t("ledger.kind-base", lang)}</div>
          <div className="mt-0.5 font-semibold">{formatRM(totals.baseSen)}</div>
        </div>
        <div className="rounded-lg border bg-background/40 p-2">
          <div className="text-muted-foreground">{t("ledger.kind-tier", lang)}</div>
          <div className="mt-0.5 font-semibold">{formatRM(totals.tierBonusSen)}</div>
        </div>
        <div className="rounded-lg border bg-background/40 p-2">
          <div className="text-muted-foreground">{t("ledger.kind-adjust", lang)}</div>
          <div className="mt-0.5 font-semibold">{formatRM(totals.adjustmentSen)}</div>
        </div>
        <div className="rounded-lg border bg-background/40 p-2">
          <div className="text-muted-foreground">{t("ledger.kind-reversal", lang)}</div>
          <div className="mt-0.5 font-semibold">-{formatRM(totals.reversalSen)}</div>
        </div>
      </div>

      {totals.lateRowCount > 0 && (
        <p className="text-[11px] text-amber-600">
          {tpl("ledger.late-note", lang, { n: totals.lateRowCount, windows: totals.lateWindowKeys.join(", ") })}
        </p>
      )}

      <details>
        <summary className="cursor-pointer text-sm font-medium">{tpl("ledger.lines", lang, { n: lines.length })}</summary>
        <div className="mt-2 space-y-1">
          {lines.map((l) => (
            <div key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-1 text-xs first:border-t-0">
              <div>
                <span className="font-medium">{t(KIND_KEY[l.kind] ?? l.kind, lang)}</span>
                {l.jobNumber ? <span className="ml-2 text-muted-foreground">{l.jobNumber}</span> : null}
                {l.description ? <span className="ml-2 text-muted-foreground">{l.description}</span> : null}
                <span className="ml-2 text-muted-foreground">{t(BASIS_KEY[l.basis] ?? l.basis, lang)}</span>
                {l.late && <span className="ml-2 text-amber-600">{t("ledger.late-tag", lang)}</span>}
              </div>
              <span className={"font-medium " + (l.kind === "REVERSAL" ? "text-red-600" : "")}>
                {l.kind === "REVERSAL" ? "-" : ""}{formatRM(l.amountSen)}
              </span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
