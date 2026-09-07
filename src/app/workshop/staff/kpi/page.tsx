import { PageHeader } from "@/components/shared/page-header";
import { Money } from "@/components/shared/money";
import { Progress } from "@/components/ui/progress";
import { staffService } from "@/modules/staff/service";
import { formatRM } from "@/lib/money";
import { getSessionUser } from "@/lib/session-user";
import { getLang } from "@/lib/get-lang";
import { scopedBranchId } from "@/lib/branch-scope";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function KpiPage() {
  const lang = await getLang();
  const session = await getSessionUser();
  const isMechanic = session.kind === "staff" && session.role === "MECHANIC";
  const { staff, top } = await staffService.kpiBoard(scopedBranchId(session), 30);
  // data isolation: MECHANIC sees only their own KPI; others see the full board
  const rows = isMechanic && session.user ? staff.filter((s) => s.id === session.user!.id) : staff;
  const myTop = isMechanic && session.user ? rows[0] ?? null : top;
  return (
    <div>
      <PageHeader title={isMechanic ? t("ws.kpi.my", lang) : t("ws.kpi.board", lang)} subtitle={isMechanic ? t("ws.kpi.my-sub", lang) : t("ws.kpi.sub", lang)} />
      {myTop && (
        <div className="mb-5 rounded-2xl bg-primary text-primary-foreground p-5 flex items-center gap-4">
          <div className="text-4xl font-bold tabular-nums">{myTop.score}</div>
          <div>
            <div className="font-semibold">{isMechanic ? t("ws.kpi.your-score", lang).replace("{name}", myTop.name) : t("ws.kpi.top-performer", lang).replace("{name}", myTop.name)}</div>
            <div className="text-xs opacity-90">{t("ws.kpi.top-line", lang).replace("{jobs}", String(myTop.jobs)).replace("{ticket}", formatRM(myTop.avgTicketSen)).replace("{rating}", String(myTop.rating))}</div>
          </div>
        </div>
      )}
      <div className="rounded-2xl border bg-card overflow-x-auto">
        <div data-tut="kpi-table" className="overflow-x-auto max-h-[560px] overflow-y-auto">
          <table className="dz-table">
            <thead><tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t("ws.kpi.col-staff", lang)}</th><th className="px-4 py-3 font-medium">{t("ws.kpi.col-jobs", lang)}</th>
              <th className="px-4 py-3 font-medium">{t("ws.kpi.col-sales", lang)}</th><th className="px-4 py-3 font-medium">{t("ws.kpi.col-avg-ticket", lang)}</th>
              <th className="px-4 py-3 font-medium">{t("ws.kpi.col-package", lang)}</th><th className="px-4 py-3 font-medium">{t("ws.kpi.col-addon", lang)}</th>
              <th className="px-4 py-3 font-medium">{t("ws.kpi.col-checklist", lang)}</th><th className="px-4 py-3 font-medium">{t("ws.kpi.col-rating", lang)}</th>
              <th className="px-4 py-3 font-medium">{t("dash.score", lang)}</th>
            </tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{s.name}<div className="text-xs text-muted-foreground">{s.role.replace("_", " ")}</div></td>
                  <td className="px-4 py-3 tabular-nums">{s.jobs}</td>
                  <td className="px-4 py-3 tabular-nums"><Money sen={s.salesSen} /></td>
                  <td className="px-4 py-3 tabular-nums">{formatRM(s.avgTicketSen)}</td>
                  <td className="px-4 py-3 tabular-nums">{s.packageConversion}%</td>
                  <td className="px-4 py-3 tabular-nums">{s.addonConversion}%</td>
                  <td className="px-4 py-3 tabular-nums">{s.checklistCompletion}%</td>
                  <td className="px-4 py-3 tabular-nums">{s.rating}★</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Progress value={s.score} className="h-1.5 w-16" />
                      <span className="font-bold tabular-nums">{s.score}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t("ws.kpi.formula-note", lang)}</p>
    </div>
  );
}