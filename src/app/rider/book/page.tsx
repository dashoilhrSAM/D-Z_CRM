import Link from "next/link";
import { MapPin, Phone, Clock, Star, CalendarDays, BadgePercent, ChevronRight, Store } from "lucide-react";
import { getRiderCustomer } from "@/lib/rider-customer";
import { BookForm } from "@/components/rider/book-form";
import { getLang } from "@/lib/get-lang";
import { t, tpl } from "@/lib/i18n";
import { db } from "@/lib/db";
import { formatRM } from "@/lib/money";
import { isPromoActive, type PromoCampaign } from "@/modules/marketing/promo";
import { AUTO_APPLY_BEST_PROMO } from "@/modules/marketing/promo-resolve";

export const dynamic = "force-dynamic";

const DEFAULT_HOURS = [
  { dKey: "rider.hours.monfri", h: "9:00 AM – 6:00 PM" },
  { dKey: "rider.hours.sat", h: "9:00 AM – 5:00 PM" },
  { dKey: "rider.hours.sun", h: null },
];

export default async function BookPage({ searchParams }: { searchParams: Promise<{ campaign?: string; promo?: string; branch?: string }> }) {
  const lang = await getLang();
  const { campaign, promo, branch } = await searchParams;
  const customer = await getRiderCustomer();
  if (!customer) return null;

  const branches = await db.branch.findMany({ where: { organisationId: customer.organisationId } });
  const promos = await db.campaign.findMany({ where: { type: "PROMO", status: "ACTIVE", endDate: { gte: new Date() } }, orderBy: { startDate: "desc" }, take: 3 });
  const bikes = customer.motorcycles.map((m) => ({ id: m.id, brand: m.brand, model: m.model, plate: m.plate, type: m.type }));
  const packages = await db.servicePackage.findMany({ where: { active: true }, select: { id: true, name: true, tier: true, priceSen: true, isBestValue: true, description: true }, orderBy: { priceSen: "asc" } });

  // 业务日期按 UTC 零点对齐（与 slot 存储一致，避免时区偏移）
  const todayUtc = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  // per-branch widgets: available slots (7d) + rating
  const branchInfo = await Promise.all(branches.map(async (b) => {
    // force-dynamic page: Date.now() is evaluated per request, not a purity violation here.
    // eslint-disable-next-line react-hooks/purity
    const future = new Date(todayUtc.getTime() + 7 * 86400000);
    const [slots, rating] = await Promise.all([
      db.appointmentSlot.count({ where: { branchId: b.id, date: { gte: todayUtc, lte: future }, isHoliday: false, bookedCount: { lt: db.appointmentSlot.fields.maxBookings } } }),
      db.review.aggregate({ _avg: { rating: true }, where: { branchId: b.id, rating: { not: null } } }),
    ]);
    return { id: b.id, name: b.name, city: b.city, phone: b.phone, address: b.address, isMain: b.isMain, operatingHours: b.operatingHours, slots, avgRating: rating._avg.rating ?? null };
  }));

  const selected = branch ? branchInfo.find((b) => b.id === branch) : null;

  // slots for the selected branch (14d)
  const future14 = new Date(todayUtc.getTime() + 14 * 86400000);
  const rawSlots = selected
    ? await db.appointmentSlot.findMany({ where: { branchId: selected.id, date: { gte: todayUtc, lte: future14 }, isHoliday: false }, select: { date: true, startTime: true, bookedCount: true, maxBookings: true } })
    : [];
  const availableSlots = rawSlots.filter((s) => s.bookedCount < s.maxBookings).map((s) => ({ date: s.date.toISOString().slice(0, 10), time: s.startTime, remaining: Math.max(0, s.maxBookings - s.bookedCount) }));
  const campaignId = campaign || null;
  const promoName = promo || null;

  // MKT-013: which promos the price summary may discount by. Mirrors the server-side
  // resolver in bookingService.create — an explicit campaign link wins; otherwise the
  // best active promo for this branch applies (when AUTO_APPLY_BEST_PROMO is on).
  const applicablePromos: PromoCampaign[] = selected
    ? (() => {
        const forBranch = promos.filter(
          (p) => p.branchId === selected.id && isPromoActive(p as never),
        ) as unknown as PromoCampaign[];
        const explicit = campaignId ? forBranch.find((p) => p.id === campaignId) : undefined;
        if (explicit) return [explicit];
        return AUTO_APPLY_BEST_PROMO ? forBranch : [];
      })()
    : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t("rider.book-title", lang)}</h1>
        <p className="text-sm text-muted-foreground mt-1">{promoName ? t("rider.book-with-promo", lang) + promoName : t("rider.book-sub", lang)}</p>
      </div>

      {selected ? (
        <>
          {/* selected branch summary + switch */}
          <Link href="/rider/book" className="flex items-center justify-between rounded-2xl border bg-card p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Store className="h-5 w-5" /></span>
              <div>
                <div className="font-semibold text-sm">{selected.name} · {selected.city}{selected.isMain ? " (" + t("rider.branch-main", lang) + ")" : ""}</div>
                <div className="text-xs text-muted-foreground">{selected.address ?? ""}</div>
              </div>
            </div>
            <span className="text-xs font-medium text-primary">{t("book.change", lang)} →</span>
          </Link>

          {/* branch widgets strip */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border bg-card p-3">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /> {t("rider.open-slots-7", lang)}</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{selected.slots}</div>
            </div>
            <div className="rounded-2xl border bg-card p-3">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Star className="h-3.5 w-3.5" /> {t("rider.rating-label", lang)}</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{selected.avgRating ? selected.avgRating.toFixed(1) : "—"}{selected.avgRating ? " ★" : ""}</div>
            </div>
          </div>

          <BookForm
            customerId={customer.id}
            bikes={bikes}
            packages={packages.map((p) => ({ id: p.id, name: p.name, tier: p.tier, priceSen: p.priceSen, isBestValue: p.isBestValue, description: p.description }))}
            campaignId={campaignId}
            availableSlots={availableSlots}
            branchId={selected.id}
            activePromos={applicablePromos}
          />
        </>
      ) : (
        <>
          {/* STEP 1 · branch locator */}
          <div data-tut="rider-book-branch" className="space-y-2.5">
            {branchInfo.map((b) => (
              <Link key={b.id} href={"/rider/book?branch=" + b.id + (campaign ? "&campaign=" + campaign : "") + (promo ? "&promo=" + promo : "")} className="dz-card-link block rounded-2xl border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><MapPin className="h-5 w-5" /></span>
                    <div>
                      <div className="font-semibold text-sm">{b.name} · <span className="text-primary">{b.city}</span>{b.isMain ? " (" + t("rider.branch-main", lang) + ")" : ""}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{b.address ?? ""}</div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
                  {b.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{b.phone}</span>}
                  <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />{tpl("book.slots-free", lang, { n: b.slots })}</span>
                  <span className="inline-flex items-center gap-1"><Star className="h-3 w-3" />{b.avgRating ? b.avgRating.toFixed(1) + " ★" : t("rider.new", lang)}</span>
                  <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{t("rider.hours-short", lang)}</span>
                </div>
              </Link>
            ))}
          </div>

          {/* widgets */}
          {promos.length > 0 && (
            <div className="rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 text-white p-4">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide"><BadgePercent className="h-4 w-4" /> {t("book.current-promos", lang)}</div>
              <div className="mt-2 space-y-1">
                {promos.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span>{p.name}</span>
                    {p.discountPercent && <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">−{p.discountPercent}%</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border bg-card p-4">
            <div className="flex items-center gap-1.5 text-sm font-semibold"><Clock className="h-4 w-4 text-primary" /> {t("book.opening-hours", lang)}</div>
            <div className="mt-2 space-y-1">
              {DEFAULT_HOURS.map((h) => (
                <div key={h.dKey} className="flex justify-between text-xs text-muted-foreground">
                  <span>{t(h.dKey, lang)}</span><span>{h.h ? h.h : t("rider.hours.closed", lang)}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-center text-[11px] text-muted-foreground">{t("book.choose-branch", lang)}</p>
        </>
      )}
    </div>
  );
}