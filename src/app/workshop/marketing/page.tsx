import Link from "next/link";
import { Megaphone, Store, MessageSquare, Star, ChevronRight, BadgePercent, Users, Send, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { marketingService } from "@/modules/marketing/service";
import { loadCampaignPerformance } from "@/modules/marketing/performance";
import { syncCampaignStatuses } from "@/modules/marketing/lifecycle";
import { isPromoActive } from "@/modules/marketing/promo";
import { crmService } from "@/modules/crm/service";
import { db } from "@/lib/db";
import { formatRM } from "@/lib/money";
import { fmtDate } from "@/lib/format";
import { getLang } from "@/lib/get-lang";
import { t, tpl } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function MarketingOverviewPage() {
  const lang = await getLang();
  const org = await db.organisation.findFirst();
  if (org) await syncCampaignStatuses(org.id);

  const { campaigns, assets, scripts } = await marketingService.overview();
  const perf = await loadCampaignPerformance(campaigns.map((c) => c.id));
  const reviews = await crmService.reviews();

  const livePromos = campaigns.filter((c) => isPromoActive(c as never));
  const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE").length;

  // roll the per-campaign figures up into shop-wide totals
  const totals = [...perf.values()].reduce(
    (acc, p) => ({
      leads: acc.leads + p.leads,
      bookings: acc.bookings + p.bookings,
      revenueSen: acc.revenueSen + p.revenueSen,
      discountCostSen: acc.discountCostSen + p.discountCostSen,
      sent: acc.sent + p.messages.sent,
      delivered: acc.delivered + p.messages.delivered,
      failed: acc.failed + p.messages.failed,
    }),
    { leads: 0, bookings: 0, revenueSen: 0, discountCostSen: 0, sent: 0, delivered: 0, failed: 0 },
  );

  const cards = [
    { key: "campaigns", icon: Megaphone, value: String(activeCampaigns), sub: tpl("ws.mkt.overview.of-total", lang, { n: campaigns.length }), href: "/workshop/marketing/calendar" },
    { key: "live-promos", icon: BadgePercent, value: String(livePromos.length), sub: t("ws.mkt.overview.live-now", lang), href: "/workshop/marketing/calendar" },
    { key: "messages", icon: Send, value: String(totals.sent), sub: tpl("ws.mkt.overview.delivered-sub", lang, { n: totals.delivered }), href: "/workshop/marketing/calendar" },
    { key: "leads", icon: Users, value: String(totals.leads), sub: tpl("ws.mkt.overview.bookings-sub", lang, { n: totals.bookings }), href: "/workshop/marketing/calendar" },
  ];

  const sections = [
    { href: "/workshop/marketing/calendar", icon: Store, title: t("nav.calendar", lang), desc: t("ws.mkt.overview.calendar-desc", lang), meta: tpl("ws.mkt.overview.campaign-count", lang, { n: campaigns.length }) },
    { href: "/workshop/marketing/posters", icon: Megaphone, title: t("nav.posters", lang), desc: t("ws.mkt.overview.posters-desc", lang), meta: tpl("ws.mkt.overview.asset-count", lang, { n: assets.length }) },
    { href: "/workshop/marketing/scripts", icon: MessageSquare, title: t("nav.scripts", lang), desc: t("ws.mkt.overview.scripts-desc", lang), meta: tpl("ws.mkt.overview.script-count", lang, { n: scripts.length }) },
    { href: "/workshop/marketing/reviews", icon: Star, title: t("nav.reviews", lang), desc: t("ws.mkt.overview.reviews-desc", lang), meta: tpl("ws.mkt.overview.rating", lang, { r: reviews.avg.toFixed(1), n: reviews.count }) },
  ];

  return (
    <div data-tut="marketing-overview">
      <PageHeader
        title={t("ws.mkt.overview.title", lang)}
        subtitle={[
          t("ws.mkt.overview.subtitle", lang),
          tpl("ws.mkt.overview.revenue-line", lang, { v: formatRM(totals.revenueSen) }),
        ].join(" · ")}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.key} href={c.href} className="rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <c.icon className="h-3.5 w-3.5" /> {t("ws.mkt.overview." + c.key, lang)}
            </div>
            <div className="mt-1.5 text-2xl font-bold tabular-nums">{c.value}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{c.sub}</div>
          </Link>
        ))}
      </div>

      {/* money line: what the campaigns earned against what they cost in discount */}
      <div className="mt-3 rounded-2xl border bg-card p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("ws.mkt.overview.attribution", lang)}</div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span><span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{formatRM(totals.revenueSen)}</span> <span className="text-muted-foreground">{t("ws.mkt.overview.attributed-revenue", lang)}</span></span>
          <span><span className="font-bold tabular-nums">{formatRM(totals.discountCostSen)}</span> <span className="text-muted-foreground">{t("ws.mkt.overview.discount-given", lang)}</span></span>
          <span><span className="font-bold tabular-nums">{totals.bookings}</span> <span className="text-muted-foreground">{t("ws.mkt.overview.attributed-bookings", lang)}</span></span>
          {totals.failed > 0 && (
            <span><span className="font-bold tabular-nums text-red-600 dark:text-red-400">{totals.failed}</span> <span className="text-muted-foreground">{t("ws.mkt.overview.failed-sends", lang)}</span></span>
          )}
        </div>
        {totals.discountCostSen > 0 && (
          <div className="mt-1.5 text-[11px] text-muted-foreground">
            {tpl("ws.mkt.overview.roi-line", lang, { n: (Math.round((totals.revenueSen / totals.discountCostSen) * 100) / 100).toFixed(2) })}
          </div>
        )}
      </div>

      {livePromos.length > 0 && (
        <div className="mt-5">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><BadgePercent className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> {t("ws.mkt.overview.live-promos", lang)}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {livePromos.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-purple-600 to-fuchsia-600 p-3.5 text-white">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{p.name}</div>
                  <div className="mt-0.5 text-[11px] opacity-90">{fmtDate(p.startDate)}{p.endDate ? " → " + fmtDate(p.endDate) : ""}</div>
                </div>
                {p.discountPercent && <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-1 text-sm font-bold">−{p.discountPercent}%</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {sections.map((s) => (
          <Link key={s.href} href={s.href} className="flex items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40">
            <s.icon className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{s.title}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{s.desc}</div>
              <div className="mt-1 text-[11px] font-semibold text-foreground">{s.meta}</div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Sparkles className="h-3 w-3" /> {t("ws.mkt.overview.footer", lang)}
      </p>
    </div>
  );
}
