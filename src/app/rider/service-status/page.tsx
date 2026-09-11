import Link from "next/link";
import { CheckCircle2, Circle, Loader2, XCircle, CalendarDays, Wrench, Clock } from "lucide-react";
import { getRiderCustomer } from "@/lib/rider-customer";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";
import { getRiderStatus, LIFECYCLE_STEPS } from "@/modules/rider/status";
import { QuotationCard, type QuotationItem } from "@/components/rider/quotation-card";

export const dynamic = "force-dynamic";

export default async function ServiceStatusPage() {
  const customer = await getRiderCustomer();
  const lang = await getLang();
  if (!customer) return null;
  const rows = await getRiderStatus(customer.id);
  const active = rows.filter((r) => r.outcome === "active");
  const rest = rows.filter((r) => r.outcome !== "active");
  const stepLabel = (s: string) => t("svc." + s, lang);

  const parseItems = (itemsJson: string | null): QuotationItem[] => {
    try { return itemsJson ? (JSON.parse(itemsJson) as QuotationItem[]) : []; } catch { return []; }
  };

  const stepIcon = (state: "done" | "active" | "todo") =>
    state === "done" ? <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
    : state === "active" ? <Loader2 className="h-5 w-5 animate-spin text-primary" />
    : <Circle className="h-5 w-5 text-slate-300" />;

  const badgeFor = (r: (typeof rows)[number]) => {
    if (r.sub?.kind === "waiting_parts") return <span className="rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[11px] px-2.5 py-0.5 font-semibold">⏳ {t("svc.waiting_parts", lang)}</span>;
    if (r.sub?.kind === "on_hold") return <span className="rounded-full bg-slate-500/15 text-slate-600 dark:text-slate-300 text-[11px] px-2.5 py-0.5 font-semibold">⏸ {t("svc.on_hold", lang)}</span>;
    if (r.sub?.kind === "approval") return <Link href="/rider/approvals" className="rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-300 text-[11px] px-2.5 py-0.5 font-semibold hover:underline">✋ {t("svc.approval", lang)}</Link>;
    if (r.sub?.kind === "quotation") return <span className="rounded-full bg-primary/10 text-primary dark:text-primary text-[11px] px-2.5 py-0.5 font-semibold">📄 {t("quotation.pending", lang)}</span>;
    return null;
  };

  const renderSteps = (r: (typeof rows)[number]) => {
    const idx = r.stepIndex;
    if (idx === null) {
      const key = r.outcome === "cancelled" ? "svc.cancelled" : "svc.no_show";
      return (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <XCircle className="h-4 w-4 text-slate-400" /> {t(key, lang)}
        </div>
      );
    }
    const pct = Math.round(((idx + 1) / LIFECYCLE_STEPS.length) * 100);
    const eta = r.job?.estimatedCompletionAt;
    return (
      <div data-tut="rider-status-progress" className="mt-5">
        <div className="mb-4 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{t("svc.overall-progress", lang)}</span>
          <span className="font-bold tabular-nums text-primary">{pct}%</span>
        </div>
        <div className="mb-4 h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: pct + "%" }} />
        </div>
        {eta && idx < 5 && (
          <div className="mb-4 flex items-center gap-1.5 rounded-lg bg-primary/5 border border-primary/15 px-3 py-2 text-xs">
            <Clock className="h-3.5 w-3.5 shrink-0" /> {t("svc.estimated-ready", lang)}<strong>{eta.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong> · {eta.toLocaleDateString("en-MY", { day: "2-digit", month: "short" })}
          </div>
        )}
        {LIFECYCLE_STEPS.map((s, i) => {
          const done = i < idx;
          const isActive = i === idx;
          return (
            <div key={s} className="flex gap-3">
              <div className="flex flex-col items-center">
                {stepIcon(done ? "done" : isActive ? "active" : "todo")}
                {i < LIFECYCLE_STEPS.length - 1 && <div className={"w-0.5 flex-1 my-1 " + (done ? "bg-emerald-500" : "bg-slate-200")} />}
              </div>
              <div className={"pb-6 text-sm " + (done ? "font-medium text-muted-foreground" : isActive ? "font-semibold text-primary" : "text-muted-foreground/60")}>
                {stepLabel(s)}
                {isActive && idx === 5 && <span className="ml-2 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] px-2 py-0.5 font-semibold">{t("rider.checkmark-ready", lang)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t("svc.status-title", lang)}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("svc.track_live", lang)}</p>
      </div>

      {active.length === 0 && (
        <div className="text-center py-14 space-y-3">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground"><Wrench className="h-6 w-6" /></div>
          <h2 className="text-lg font-semibold">{t("svc.no_active", lang)}</h2>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">{t("svc.no_active_desc", lang)}</p>
          <Link href="/rider/book" className="inline-flex items-center gap-1.5 rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
            <CalendarDays className="h-4 w-4" /> {t("svc.book_link", lang)}
          </Link>
        </div>
      )}

      {active.map((r) => (
        <div key={r.bike.id + ":" + (r.job?.id ?? r.booking?.id ?? "")} className="rounded-3xl border bg-card p-5" data-testid="svc-card">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <div className="font-semibold">{r.bike.brand} {r.bike.model}</div>
              <div className="text-sm text-muted-foreground">{r.bike.plate} · {r.bike.year}</div>
            </div>
            {badgeFor(r)}
          </div>
          {r.job && <div className="mt-1 text-xs text-muted-foreground font-mono">{t("ws.jobs.col-job", lang)} {r.job.jobNumber}</div>}
          {r.booking && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
              <Wrench className="h-3.5 w-3.5" /> {r.booking.serviceType}
              <span>·</span>
              <span>{r.booking.date.toISOString().slice(0, 10)} {r.booking.timeSlot}</span>
              {r.job && <span>·</span>}
              {r.job && <span>{r.job.mileage.toLocaleString()} km</span>}
            </div>
          )}
          {renderSteps(r)}
          {r.quotation && (
            <div className="mt-4">
              <QuotationCard
                quotation={{ id: r.quotation.id, status: r.quotation.status, revision: r.quotation.revision, totalSen: r.quotation.totalSen, items: parseItems(r.quotation.itemsJson), promo: r.quotation.promo, jobNumber: r.job?.jobNumber }}
              />
            </div>
          )}
        </div>
      ))}

      {rest.length > 0 && (
        <div className="rounded-3xl border bg-muted/30 p-4">
          <h2 className="font-semibold text-sm mb-2">{t("svc.other-bikes", lang)}</h2>
          <div className="space-y-2">
            {rest.map((r) => (
              <div key={r.bike.id} className="flex items-center justify-between rounded-xl bg-card px-3 py-2 text-sm">
                <span>{r.bike.brand} {r.bike.model} <span className="text-muted-foreground">· {r.bike.plate}</span></span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {r.outcome === "completed" ? t("svc.completed", lang) : r.outcome === "cancelled" ? t("svc.cancelled", lang) : r.outcome === "no_show" ? t("svc.no_show", lang) : "—"}
                  </span>
                  {r.outcome === "completed" && (
                    <Link href="/rider/service-history" className="text-xs font-medium text-primary hover:underline">{t("rider.rate-service", lang)}</Link>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}