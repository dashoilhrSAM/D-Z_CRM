import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { SalaryRulesForm } from "@/components/workshop/salary-rules-form";
import { ForemanPayoutView } from "@/components/workshop/foreman-payout-view";
import { staffService } from "@/modules/staff/service";
import { getSessionUser } from "@/lib/session-user";
import { getLang } from "@/lib/get-lang";
import { scopedBranchId } from "@/lib/branch-scope";
import { t } from "@/lib/i18n";
import { formatRM } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const DAY_FILTERS = [
  { key: "1", label: "Today", days: 1 },
  { key: "3", label: "3 days", days: 3 },
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days & above", days: 30 },
];

/** Foreman 发薪中心：点技师 → 每日账单（含他完成的 job 明细）→ tick 发薪；时间 filter + 历史。 */
export default async function SettlementsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const lang = await getLang();
  const sp = await searchParams;
  const session = await getSessionUser();
  const isMechanic = session.kind === "staff" && session.role === "MECHANIC";

  const days = DAY_FILTERS.some((f) => f.key === sp.days) ? Number(sp.days) : 7;
  const [result, history] = await Promise.all([staffService.settlementByDay(days, undefined, scopedBranchId(session)), staffService.payoutHistory(scopedBranchId(session))]);
  const foremen = isMechanic && session.user ? result.foremen.filter((f) => f.id === session.user!.id) : result.foremen;

  const qs = (d: string) => "/workshop/settlements?days=" + d;

  return (
    <div>
      <PageHeader title={t("settle.title", lang)} subtitle={t("settle.subtitle", lang)} />

      {!isMechanic && (
        <details className="mb-4 rounded-2xl border bg-card open:ring-2 open:ring-primary/20">
          <summary className="flex cursor-pointer list-none items-center justify-between p-4 text-sm font-semibold">
            <span>{t("settle.salary-rules", lang)}</span>
            <span className="text-xs font-normal text-muted-foreground">{t("settle.salary", lang)}</span>
          </summary>
          <div className="border-t p-4"><SalaryRulesForm rules={result.rules} /></div>
        </details>
      )}

      {/* 时间 filter */}
      <div data-tut="settlements-filter" className="flex flex-wrap items-center gap-1.5 mb-3">
        {DAY_FILTERS.map((f) => (
          <Link key={f.key} href={qs(f.key)} className={"rounded-full border px-3 py-1 text-xs font-medium transition-colors " + (days === f.days ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>
            {t("settle.day-filter." + f.key, lang)}
          </Link>
        ))}
        <span className="text-xs text-muted-foreground ml-auto">{fmtDate(result.start)} – {fmtDate(result.end)}</span>
      </div>

      {/* foreman 中心发薪（每日账单含 job 明细） */}
      <ForemanPayoutView
        foremen={foremen.map((f) => ({
          id: f.id, name: f.name, totalJobs: f.totalJobs, totalSalesSen: f.totalSalesSen, totalSen: f.totalSen,
          commissionRules: f.commissionRules,
          daily: f.daily.map((b) => ({ date: b.date, jobs: b.jobs, salesSen: b.salesSen, baseSen: b.baseSen, commissionSen: b.commissionSen, addonBonusSen: b.addonBonusSen, bonusSen: b.bonusSen, totalSen: b.totalSen, payoutStatus: b.payout?.status ?? null, payoutId: b.payout?.id ?? null, paidSen: b.payout?.paidSen ?? 0, jobsList: b.jobsList })),
        }))}
        orgCommissionValue={result.rules.commissionValue}
        lang={lang}
      />

      {/* 发薪历史 */}
      <div className="mt-8 rounded-2xl border bg-card p-4">
        <h3 className="font-semibold mb-3">{t("settle.payout-history", lang)}</h3>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">{t("settle.no-payouts", lang)}</p>
        ) : (
          <div data-tut="settlements-table" className="overflow-x-auto max-h-[560px] overflow-y-auto">
            <table className="dz-table w-full text-xs">
              <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t("settle.col-date", lang)}</th><th className="px-3 py-2 font-medium">{t("settle.col-foreman", lang)}</th><th className="px-3 py-2 font-medium">{t("settle.col-period", lang)}</th>
                <th className="px-3 py-2 text-right font-medium">{t("settle.col-salary", lang)}</th><th className="px-3 py-2 text-right font-medium">{t("settle.col-paid", lang)}</th><th className="px-3 py-2 font-medium">{t("settle.col-status", lang)}</th><th className="px-3 py-2 font-medium">{t("settle.col-payments", lang)}</th>
              </tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b last:border-0">
                    <td className="px-3 py-2">{h.paidAt ? fmtDateTime(h.paidAt) : "—"}</td>
                    <td className="px-3 py-2 font-medium">{h.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{h.period} · {fmtDate(h.periodStart)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatRM(h.totalSen)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatRM(h.paidSen)}</td>
                    <td className="px-3 py-2"><span className={"rounded-full px-2 py-0.5 text-[10px] font-bold " + (h.status === "PAID" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" : h.status === "PARTIAL" ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>{h.status}</span></td>
                    <td className="px-3 py-2 text-muted-foreground">{h.payments.map((p) => formatRM(p.amountSen) + " " + p.method).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}