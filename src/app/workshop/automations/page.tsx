import { db } from "@/lib/db";
import { AutomationManager, ToggleRule } from "@/components/workshop/automation-manager";
import { fmtDateTime } from "@/lib/format";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const TRIGGER_LABEL: Record<string, string> = {
  LEAD_CREATED: "Lead created", LEAD_STAGE_CHANGED: "Lead stage changed", BOOKING_CREATED: "Booking created",
  BOOKING_APPROACHING: "Booking approaching", SERVICE_COMPLETED: "Service completed", SERVICE_DUE: "Service due",
  JOB_READY: "Job ready", CUSTOMER_INACTIVE: "Customer inactive", LOYALTY_EVENT: "Loyalty event", LOW_STOCK: "Low stock",
};

export default async function AutomationsPage() {
  const lang = await getLang();
  const org = await db.organisation.findFirst();
  const [rules, executions, templates] = await Promise.all([
    db.automationRule.findMany({ where: { organisationId: org!.id }, orderBy: { createdAt: "desc" }, include: { executions: { orderBy: { executedAt: "desc" }, take: 5 } } }),
    db.automationExecution.findMany({ orderBy: { executedAt: "desc" }, take: 20, include: { rule: { select: { name: true } } } }),
    db.messageTemplate.findMany({ where: { organisationId: org!.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t("autom.title", lang)}</h1>
        <p className="text-sm text-muted-foreground">{t("autom.subtitle", lang)}</p>
      </div>
      <AutomationManager templates={templates} />
      <div className="rounded-xl border bg-card divide-y">
        {rules.map((r) => (
          <div key={r.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
            <span className="font-medium text-sm">{r.name}</span>
            <span className="rounded-full bg-accent text-[11px] px-2.5 py-0.5">{(TRIGGER_LABEL[r.trigger] ? t("autom.trigger." + r.trigger, lang) : r.trigger)}</span>
            <span className="text-xs text-muted-foreground font-mono truncate max-w-sm">{r.actions}</span>
            <div className="flex-1" />
            <span className={"rounded-full text-[11px] px-2.5 py-0.5 " + (r.active ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground")}>{r.active ? t("autom.active", lang) : t("autom.paused", lang)}</span>
            <ToggleRule ruleId={r.id} active={r.active} />
          </div>
        ))}
        {rules.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">{t("autom.empty", lang)}</div>}
      </div>
      <div className="rounded-xl border bg-card overflow-hidden">
        <h2 className="font-semibold text-sm px-4 pt-3 pb-2">{t("autom.recent", lang)}</h2>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2 font-medium">{t("autom.col-rule", lang)}</th><th className="px-3 py-2 font-medium">{t("autom.col-trigger", lang)}</th><th className="px-3 py-2 font-medium">{t("autom.col-status", lang)}</th><th className="px-3 py-2 font-medium">{t("autom.col-at", lang)}</th><th className="px-3 py-2 font-medium">{t("autom.col-error", lang)}</th></tr>
          </thead>
          <tbody>
            {executions.map((e) => (
              <tr key={e.id} className="border-t">
                <td className="px-3 py-2 text-xs">{e.rule.name}</td>
                <td className="px-3 py-2 text-xs">{e.trigger}</td>
                <td className="px-3 py-2 text-xs">{e.status === "SUCCESS" ? "✓" : t("autom.failed", lang)}</td>
                <td className="px-3 py-2 text-xs">{fmtDateTime(e.executedAt)}</td>
                <td className="px-3 py-2 text-xs text-destructive max-w-xs truncate">{e.error ?? ""}</td>
              </tr>
            ))}
            {executions.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">{t("autom.no-executions", lang)}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
