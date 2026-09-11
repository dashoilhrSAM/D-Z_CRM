import Link from "next/link";
import { redirect } from "next/navigation";
import { Bike, CalendarPlus, ChevronRight, Wrench, AlertTriangle, Clock, Bell, Tag, ArrowRight } from "lucide-react";
import { getRiderCustomer } from "@/lib/rider-customer";
import { db } from "@/lib/db";
import { fmtKM, fmtDate } from "@/lib/format";
import { isPromoActive } from "@/modules/marketing/promo";
import { getLang } from "@/lib/get-lang";
import { t, tpl } from "@/lib/i18n";
import { PageTransition } from "@/components/shared/page-transition";
import { RiderScanQrButton } from "@/components/rider/scan-qr-button";

export const dynamic = "force-dynamic";

const SERVICE_INTERVAL_KM = 3000;

export default async function RiderHomePage() {
  const customer = await getRiderCustomer();
  const lang = await getLang();
  if (!customer) {
    // 无关联顾客档案 → 登录页（layout 已拦截未登录，这里兜底已登录但未关联的边界）
    redirect("/rider/login");
  }
  const bike = [...customer.motorcycles].sort((a, b) => b.currentMileage - a.currentMileage)[0];

  const [activeJob, reminder, unreadCount, campaigns] = await Promise.all([
    bike
      ? db.serviceJob.findFirst({
          where: { motorcycleId: bike.id, status: { in: ["WAITING", "IN_PROGRESS", "AWAITING_APPROVAL", "READY"] } },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve(null),
    bike
      ? db.serviceReminder.findFirst({
          where: { motorcycleId: bike.id },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve(null),
    db.notification.count({ where: { customerId: customer.id, readAt: null } }),
    // Wider than the two shown, because the shared rule below decides what is live: taking the
    // newest few and filtering afterwards left the home with no offers whenever those few had
    // already ended, even though live ones existed further down the list.
    db.campaign.findMany({ where: { type: "PROMO", status: "ACTIVE" }, orderBy: { startDate: "desc" }, take: 24 }),
  ]);
  const livePromos = campaigns.filter((c) => isPromoActive(c as never));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t("dash.morning", lang) : hour < 18 ? t("dash.afternoon", lang) : t("dash.evening", lang);

  const nextKm = bike?.nextServiceMileage ?? null;
  // 不显示当前里程进度——只显示 Last / Next 服务节点
  const isDue = bike != null && nextKm != null && bike.currentMileage >= nextKm;
  const isSoon = bike != null && nextKm != null && !isDue && bike.currentMileage >= nextKm - SERVICE_INTERVAL_KM * 0.3;

  return (
    <PageTransition>
    <div className="space-y-5">
      <header data-tut="rider-hello" className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{greeting},</p>
          <h1 className="text-2xl font-bold tracking-tight">{customer.name.split(" ")[0]}</h1>
        </div>
        <div className="flex items-center gap-2">
          <RiderScanQrButton />
          {isDue || isSoon ? (
            <span className={"rounded-full px-3 py-1 text-[11px] font-bold " + (isDue ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300")}>
              {isDue ? t("rider.service-due", lang) : t("rider.soon", lang)}
            </span>
          ) : null}
          <Link href="/rider/notifications" className="relative inline-flex h-10 w-10 items-center justify-center rounded-2xl border bg-card text-muted-foreground hover:text-foreground" aria-label={t("notif.title", lang)}>
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>
        </div>
      </header>

      {!bike && (
        <Link href="/rider/bike-first" className="block rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Bike className="h-6 w-6" /></div>
            <div>
              <div className="font-semibold">{t("bike.first-title", lang)}</div>
              <div className="text-xs text-muted-foreground">{t("bike.first-desc", lang)}</div>
            </div>
          </div>
          <div className="mt-3 inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
            {t("bike.add-first", lang)} <ArrowRight className="h-3.5 w-3.5" />
          </div>
        </Link>
      )}

      {activeJob && (
        <Link href="/rider/service-status" className="block rounded-2xl bg-primary text-primary-foreground p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
            </span>
            {activeJob.status === "READY" ? t("rider.bike-ready", lang) : t("rider.bike-serviced", lang)}
          </div>
          <p className="mt-1 text-xs opacity-90">{tpl("rider.job-tap-live", lang, { n: activeJob.jobNumber })}</p>
        </Link>
      )}

      {bike && (
        <div className="rounded-3xl border bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold text-lg uppercase">{bike.brand} {bike.model}</div>
              <div className="text-sm text-muted-foreground">{bike.plate} · {bike.year}</div>
            </div>
            <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
              <Bike className="h-6 w-6" />
            </div>
          </div>

          {/* service reminder — shows last & next service milestones only (no live mileage tracking) */}
          {reminder && (
            <div className={"mt-4 rounded-2xl p-4 " + (isDue ? "bg-red-50 ring-1 ring-red-200 dark:bg-red-950/40 dark:ring-red-900" : isSoon ? "bg-amber-50 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:ring-amber-900" : "bg-muted/40")}>
              <div className="flex items-center justify-between text-xs">
                <span className={"inline-flex items-center gap-1.5 font-semibold " + (isDue ? "text-red-700 dark:text-red-300" : isSoon ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                  {isDue ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                  {isDue ? t("rider.svc-due", lang) : isSoon ? t("rider.svc-soon", lang) : t("rider.svc-schedule", lang)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("svc.last-service", lang)}</div>
                  <div className="font-bold tabular-nums">{fmtKM(reminder.lastServiceMileage)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("svc.next-service", lang)}</div>
                  <div className="font-bold tabular-nums">{fmtKM(reminder.nextServiceMileage)}</div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-muted/50 p-4">
              <div className="text-xs text-muted-foreground">{t("svc.last-service", lang)}</div>
              <div className="mt-1 text-xl font-bold tabular-nums">{fmtKM(bike.lastServiceMileage ?? 0)}</div>
              {bike.lastServiceDate && <div className="text-[11px] text-muted-foreground mt-0.5">{fmtDate(bike.lastServiceDate)}</div>}
            </div>
            <div className="rounded-2xl bg-muted/50 p-4">
              <div className="text-xs text-muted-foreground">{t("rider.next-service", lang)}</div>
              <div className="mt-1 text-xl font-bold tabular-nums">{fmtKM(bike.nextServiceMileage ?? 0)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{bike.nextServiceEstDate ? t("ws.cust.estimated", lang) + " " + bike.nextServiceEstDate.toLocaleDateString("en-MY", { month: "long", year: "numeric" }) : "—"}</div>
            </div>
          </div>
          <Link href="/rider/book" className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground">
            <CalendarPlus className="h-4 w-4" /> {t("rider.book-service", lang)}
          </Link>
        </div>
      )}

      {livePromos.length > 0 && (
        // A two-line preview, so tapping it opens the News page where the offers (and the rest of
        // the workshop's news) live. It used to jump straight into the promotions list.
        <Link data-testid="home-offers" href="/rider/service-history" className="dz-card-link block rounded-2xl bg-gradient-to-br from-primary to-orange-500 p-5 text-primary-foreground">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Tag className="h-4 w-4" /> {t("news.offers", lang)}
            </div>
            <span className="text-xs font-medium opacity-90">{t("common.view-all", lang)} →</span>
          </div>
          <div className="mt-2 space-y-1.5">
            {livePromos.slice(0, 2).map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span>{p.name}</span>
                {p.discountPercent && <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">−{p.discountPercent}%</span>}
              </div>
            ))}
          </div>
        </Link>
      )}

      {bike && (
        <Link data-tut="rider-bike" href={"/rider/motorcycles/" + bike.id} className="dz-card-link flex items-center justify-between rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Wrench className="h-4 w-4" /></div>
            <div>
              <div className="text-sm font-semibold">{t("rider.passport", lang)}</div>
              <div className="text-xs text-muted-foreground">{t("rider.passport-desc", lang)}</div>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      )}
    </div>
    </PageTransition>
  );
}