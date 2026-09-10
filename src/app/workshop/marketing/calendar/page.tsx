import { PageHeader } from "@/components/shared/page-header";
import { marketingService } from "@/modules/marketing/service";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { CampaignForm } from "@/components/workshop/marketing-forms";
import { CampaignActions } from "@/components/workshop/campaign-actions";
import { BroadcastButton } from "@/components/workshop/broadcast-button";
import { PromoCalendarGrid, type CalendarCampaign } from "@/components/workshop/promo-calendar-grid";
import { isPromoActive } from "@/modules/marketing/promo";
import { buildAudienceWhere, rulesForCampaign } from "@/modules/marketing/audience";
import { loadCampaignPerformance } from "@/modules/marketing/performance";
import { PromoAutoApplyToggle } from "@/components/workshop/promo-auto-apply-toggle";
import { formatRM } from "@/lib/money";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const typeKey: Record<string, string> = {
  RETURN: "ws.mkt.calendar.type.RETURN",
  REMINDER: "ws.mkt.calendar.type.REMINDER",
  PROMO: "ws.mkt.calendar.type.PROMO",
  NEWS: "ws.mkt.calendar.type.NEWS",
};
const statusKey: Record<string, string> = {
  ACTIVE: "ws.mkt.status.ACTIVE",
  SCHEDULED: "ws.mkt.status.SCHEDULED",
  DRAFT: "ws.mkt.status.DRAFT",
  ENDED: "ws.mkt.status.ENDED",
};
const statusTone: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  SCHEDULED: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  DRAFT: "bg-slate-100 text-slate-600 dark:text-slate-300",
  ENDED: "bg-slate-100 text-slate-400",
};

export default async function MarketingCalendarPage() {
  const lang = await getLang();
  const { campaigns } = await marketingService.overview();

  // audience size: customers due for service — a shop-wide figure for the page header
  const dueCustomers = await db.serviceReminder.count({ where: { status: { in: ["UPCOMING", "DUE_SOON", "DUE", "OVERDUE"] } } });
  // MKT-005: the REAL reach of each campaign. The list below used to render the
  // shop-wide `dueCustomers` number against every campaign, which read as if each
  // campaign targeted those customers — it did not.
  const org = await db.organisation.findFirst();
  const audienceSize = new Map<string, number>();
  if (org) {
    for (const c of campaigns) {
      audienceSize.set(
        c.id,
        await db.customer.count({
          where: { AND: [{ phone: { not: null } }, buildAudienceWhere(org.id, rulesForCampaign(c))] },
        }),
      );
    }
  }
  // MKT-015/016/017: leads + bookings + revenue attributed to each campaign, combined
  // with the audience size computed above.
  const perf = await loadCampaignPerformance(campaigns.map((c) => c.id));
  const perfFor = (id: string) => {
    const base = perf.get(id);
    const audience = audienceSize.get(id) ?? 0;
    if (!base) return null;
    return { ...base, audience, conversionPct: audience > 0 ? Math.round((base.bookings / audience) * 1000) / 10 : null };
  };

  const order = { ACTIVE: 0, SCHEDULED: 1, DRAFT: 2, ENDED: 3 } as const;
  const sorted = [...campaigns].sort((a, b) => (order[a.status as keyof typeof order] ?? 9) - (order[b.status as keyof typeof order] ?? 9) || a.startDate.getTime() - b.startDate.getTime());
  const activePromos = campaigns.filter((c) => isPromoActive(c as never));
  const convMap = new Map(campaigns.map((c) => [c.id, perfFor(c.id)?.bookings ?? 0]));
  const calendarCampaigns: CalendarCampaign[] = campaigns.map((c) => ({
    id: c.id, name: c.name, type: c.type, status: c.status, startDate: c.startDate, endDate: c.endDate,
    discountPercent: c.discountPercent, conversions: convMap.get(c.id) ?? 0,
  }));

  return (
    <div>
      <PageHeader
        title={t("ws.mkt.calendar.title", lang)}
        subtitle={[
          t("ws.mkt.calendar.campaigns", lang).replace("{n}", String(campaigns.length)),
          t("ws.mkt.calendar.promo-live", lang).replace("{n}", String(activePromos.length)),
          t("ws.mkt.calendar.customers-due", lang).replace("{n}", String(dueCustomers)),
        ].join(" · ")}
        action={<CampaignForm />}
      />
      <div className="mb-4"><PromoAutoApplyToggle enabled={org?.promoAutoApply ?? true} /></div>
      <div className="mb-5"><PromoCalendarGrid campaigns={calendarCampaigns} /></div>
      <div data-tut="calendar-list" className="space-y-2">
        {sorted.map((c) => {
          const p = perfFor(c.id);
          const conversions = p?.bookings ?? 0;
          return (
            <div key={c.id} className="rounded-2xl border bg-card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-52 flex-1">
                  <div className="font-medium text-sm">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{(typeKey[c.type] ? t(typeKey[c.type], lang) : c.type)} · {c.audience ?? t("ws.mkt.calendar.all", lang)} · {fmtDate(c.startDate)}{c.endDate ? " → " + fmtDate(c.endDate) : ""}</div>
                </div>
                {c.type === "PROMO" && c.discountPercent && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">−{c.discountPercent}%</span>
                )}
                <span className={"rounded-full px-2.5 py-0.5 text-[11px] font-bold " + (statusTone[c.status] ?? "bg-slate-100 text-slate-600 dark:text-slate-300")}>{statusKey[c.status] ? t(statusKey[c.status], lang) : c.status}</span>
                <CampaignForm
                  initial={{ id: c.id, name: c.name, type: c.type, status: c.status, audience: c.audience ?? null, audienceRules: c.audienceRules as never, startDate: c.startDate, endDate: c.endDate, discountPercent: c.discountPercent }}
                />
                <BroadcastButton campaignId={c.id} stats={p?.messages ?? { sent: 0, delivered: 0, failed: 0 }} />
                <CampaignActions id={c.id} status={c.status} />
              </div>
              {/* reach + conversion */}
              <div className="mt-2.5 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2.5 py-1">
                  <span className="font-semibold text-foreground">{audienceSize.get(c.id) ?? 0}</span> {t("ws.mkt.calendar.audience-label", lang)}
                </span>
                <span className={"inline-flex items-center gap-1 rounded-full px-2.5 py-1 " + (conversions > 0 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 ring-1 ring-emerald-200" : "bg-muted/50")}>
                  <span className={"font-semibold " + (conversions > 0 ? "text-emerald-700" : "text-foreground")}>{conversions}</span> {t("ws.mkt.calendar.bookings-driven", lang)}
                </span>
                {(() => { const s = p?.messages; if (!s || s.sent === 0) return null; return (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 px-2.5 py-1">
                    <span className="font-semibold text-foreground">{s.sent}</span> {t("ws.mkt.calendar.sent", lang)}
                    {s.delivered > 0 && <><span className="text-emerald-600 dark:text-emerald-400 font-semibold">{s.delivered}</span> {t("ws.mkt.calendar.delivered", lang)}</>}
                    {s.failed > 0 && <><span className="text-red-600 dark:text-red-400 font-semibold">{s.failed}</span> {t("ws.mkt.calendar.failed", lang)}</>}
                  </span>
                ); })()}
                {(p?.leads ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2.5 py-1">
                    <span className="font-semibold text-foreground">{p!.leads}</span> {t("ws.mkt.perf.leads", lang)}
                  </span>
                )}
                {(p?.revenueSen ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300">
                    <span className="font-semibold">{formatRM(p!.revenueSen)}</span> {t("ws.mkt.perf.revenue", lang)}
                  </span>
                )}
                {p?.conversionPct != null && p.audience > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2.5 py-1">
                    <span className="font-semibold text-foreground">{p.conversionPct}%</span> {t("ws.mkt.perf.conversion", lang)}
                  </span>
                )}
                {p?.roiOnDiscount != null && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2.5 py-1" title={formatRM(p.discountCostSen) + " " + t("ws.mkt.perf.discount-given", lang)}>
                    <span className="font-semibold text-foreground">{p.roiOnDiscount}×</span> {t("ws.mkt.perf.roi", lang)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {sorted.length === 0 && <p className="text-sm text-muted-foreground text-center py-10">{t("ws.mkt.calendar.empty", lang)}</p>}
      </div>
    </div>
  );
}
