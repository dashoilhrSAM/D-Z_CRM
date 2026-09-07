import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { RevenueTrendChart, RevenueSplitChart } from "@/components/workshop/profit-charts";
import { financeService } from "@/modules/finance/service";
import { staffService } from "@/modules/staff/service";
import { formatRM } from "@/lib/money";
import { getLang } from "@/lib/get-lang";
import { getSessionUser } from "@/lib/session-user";
import { scopedBranchId } from "@/lib/branch-scope";
import { t } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const PERIODS = ["day", "week", "month"] as const;

/** Finance 周期收支：按日/周/月看收入、出钱（配件成本 + 薪资）与净利。 */
export default async function ProfitPage({ searchParams }: { searchParams: Promise<{ period?: string; date?: string }> }) {
  const lang = await getLang();
  const session = await getSessionUser();
  const sp = await searchParams;
  const period = (PERIODS as readonly string[]).includes(sp.period ?? "") ? (sp.period as "day" | "week" | "month") : "week";
  const ref = sp.date ? new Date(sp.date + "T00:00:00Z") : undefined;

  const [p, settle] = await Promise.all([
    financeService.periodDashboard(period, ref, scopedBranchId(session)),
    staffService.settlement(period, ref, scopedBranchId(session)),
  ]);
  const salarySen = settle.totals.salarySen;
  const outflow = p.cogs + salarySen; // 出钱 = 配件成本 + 薪资
  const net = p.grossProfit - salarySen; // 净利 = 毛利 - 薪资

  const qs = (pd: string, d?: string) => {
    const q = new URLSearchParams();
    q.set("period", pd);
    if (d) q.set("date", d);
    return "/workshop/finance/profit?" + q.toString();
  };
  const rangeLabel = fmtDate(p.start) + " – " + fmtDate(new Date(p.end.getTime() - 86400000));

  return (
    <div>
      <PageHeader title={t("nav.profit", lang)} subtitle={t("fin.period-sub", lang)} />

      {/* 周期切换 + 日期 */}
      <div data-tut="profit-range" className="flex flex-wrap items-center gap-2 mb-4">
        {PERIODS.map((pd) => (
          <Link key={pd} href={qs(pd, sp.date)} className={"rounded-full border px-3 py-1 text-xs font-medium transition-colors " + (period === pd ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>
            {t("settle." + pd, lang)}
          </Link>
        ))}
        <form method="get" className="flex items-center gap-1 ml-2">
          <input type="hidden" name="period" value={period} />
          <input type="date" name="date" defaultValue={sp.date} className="rounded-md border bg-background px-3 py-1.5 text-xs" />
          <button className="rounded-md border px-2 py-1.5 text-xs font-medium">{t("fin.go", lang)}</button>
        </form>
        <span className="text-xs text-muted-foreground ml-auto">{t("settle.period-label", lang)}: <strong>{t("settle." + period, lang)}</strong> · {rangeLabel}</span>
      </div>

      {/* 收支卡 */}
      <div data-tut="profit-cards" className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label={t("dash.today-sales", lang)} value={<Money sen={p.revenue} />} />
        <StatCard label={t("fin.cogs", lang)} value={<Money sen={p.cogs} />} tone="danger" />
        <StatCard label={t("fin.salary", lang)} value={<Money sen={salarySen} />} tone="danger" />
        <StatCard label={t("fin.net", lang)} value={<Money sen={net} />} tone={net >= 0 ? "success" : "danger"} />
      </div>

      {/* 出钱明细 */}
      <div className="rounded-2xl border bg-card p-4 mb-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{t("fin.out-total", lang)} · {formatRM(outflow)}</div>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between"><span>{t("fin.cogs", lang)}</span><span className="tabular-nums text-destructive">{formatRM(p.cogs)}</span></div>
          <div className="flex justify-between"><span>{t("fin.salary", lang)}（{settle.totals.jobs} jobs）</span><span className="tabular-nums text-destructive">{formatRM(salarySen)}</span></div>
          <div className="flex justify-between border-t pt-1.5 font-semibold"><span>{t("dash.gross-profit", lang)}</span><span className="tabular-nums">{formatRM(p.grossProfit)}</span></div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 dz-panel p-5">
          <h3 className="font-semibold mb-1">{t("ws.finance.trend-title", lang)}</h3>
          <p className="text-xs text-muted-foreground mb-3">{t("ws.finance.trend-sub", lang)}</p>
          <RevenueSplitChart service={p.serviceRevenue} parts={p.partsRevenue} />
        </div>
        <div className="dz-panel p-5">
          <h3 className="font-semibold mb-1">{t("ws.finance.split-title", lang)}</h3>
          <p className="text-xs text-muted-foreground mb-3">{t("ws.finance.split-sub", lang)}</p>
          <div className="mt-2 space-y-1.5 text-sm">
            <div className="flex justify-between"><span>{t("rider.service", lang)}</span><span className="tabular-nums">{formatRM(p.serviceRevenue)}</span></div>
            <div className="flex justify-between"><span>{t("ws.finance.parts", lang)}</span><span className="tabular-nums">{formatRM(p.partsRevenue)}</span></div>
            <div className="flex justify-between border-t pt-1.5 font-semibold"><span>{t("ws.finance.margin", lang)}</span><span className="tabular-nums">{p.margin.toFixed(1)}%</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}