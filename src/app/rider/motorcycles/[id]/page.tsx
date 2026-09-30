import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, CalendarPlus, ShieldCheck, Droplets, Filter, Link2 } from "lucide-react";
import { motorcycleService } from "@/modules/motorcycles/service";
import { db } from "@/lib/db";
import { getRiderCustomer } from "@/lib/rider-customer";
import { fmtKM, fmtDate } from "@/lib/format";
import { formatRM } from "@/lib/money";
import { motorcycleTypeInfo } from "@/lib/motorcycle-types";
import { EditMotorcycle } from "@/components/rider/edit-motorcycle";
import { QrToggle } from "@/components/shared/qr-toggle";
import { motorcycleQrUrl } from "@/lib/qr";
import { getLang } from "@/lib/get-lang";
import { t, tpl } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function MotorcyclePassportPage({ params }: { params: Promise<{ id: string }> }) {
  const lang = await getLang();
  const { id } = await params;
  // 2026-09-30 越权修正（P0）：整页只按 URL 里的车辆 id 取数（保养/消费/检查发现），
  // 原先不比对车主 —— 任何已登录骑手改一下 id 就能读别人的维修史与花费，这里收窄到本人车辆。
  const rider = await getRiderCustomer();
  const passport = await motorcycleService.getPassport(id);
  if (!passport || passport.customer.id !== rider?.id) notFound();
  const jobs = await db.serviceJob.findMany({
    where: { motorcycleId: id, status: "COMPLETED" },
    include: { invoice: true, items: true, parts: { include: { product: true } }, mechanic: true },
    orderBy: { completedAt: "desc" },
  });
  const verified = jobs.length;
  const lifetime = jobs.reduce((s, j) => s + (j.invoice?.totalSen ?? 0), 0);

  // active booking/job → show live status entry
  const activeBooking = await db.booking.findFirst({ where: { motorcycleId: id, status: { in: ["REQUESTED", "CONFIRMED", "RESCHEDULED", "CHECKED_IN"] } } });
  const activeJob = await db.serviceJob.findFirst({ where: { motorcycleId: id, status: { in: ["WAITING", "IN_PROGRESS", "AWAITING_APPROVAL", "QC_CHECK", "WAITING_PARTS", "ON_HOLD", "READY"] } } });

  // QR-001: motorcycle QR (workshop scans to load bike + owner); gated by org toggle
  const org = await db.organisation.findFirst();
  const showMotorcycleQr = org?.enableMotorcycleQr !== false;

  // inspection findings across this bike's jobs (WARNING/FAIL history)
  const findings = await db.inspectionFinding.findMany({
    where: { job: { motorcycleId: id } },
    include: { job: { select: { jobNumber: true, completedAt: true } }, approval: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <div className="space-y-4">
      <Link href="/rider/motorcycles" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ChevronLeft className="h-4 w-4" /> {t("rider.my-bikes", lang)}</Link>

      {(activeBooking || activeJob) && (
        <Link href="/rider/service-status" className="block rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="text-xs text-muted-foreground">{t("bike.live-status", lang)}</div>
          <div className="mt-0.5 text-sm font-semibold text-primary">
            {activeJob?.status === "READY" ? t("bike.ready-collect", lang) : activeJob ? tpl("bike.being-serviced", lang, { n: activeJob.jobNumber }) : activeBooking ? t("book." + activeBooking.status, lang) : ""}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{t("bike.tap-timeline", lang)}</div>
        </Link>
      )}

      <div className="rounded-3xl border bg-card p-6 text-center">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center"><ShieldCheck className="h-7 w-7" /></div>
        <h1 className="mt-3 text-xl font-bold uppercase">{t("rider.passport", lang)}</h1>
        <p className="mt-1 font-semibold">{passport.brand} {passport.model}</p>
        {(() => { const ti = motorcycleTypeInfo(passport.type); return ti ? (
          <p className="mt-1 text-[11px] font-medium text-primary">{ti.label} · {ti.labelBM}</p>
        ) : null; })()}
        <p className="text-sm text-muted-foreground">{passport.plate} · {passport.year}{passport.color ? " · " + passport.color : ""}</p>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-muted/50 p-3">
            <div className="text-lg font-bold tabular-nums">{verified}</div>
            <div className="text-[11px] text-muted-foreground">{t("rider.verified-services", lang)}</div>
          </div>
          <div className="rounded-xl bg-muted/50 p-3">
            <div className="text-lg font-bold tabular-nums">{jobs[0] ? fmtDate(jobs[0].completedAt) : "—"}</div>
            <div className="text-[11px] text-muted-foreground">{t("rider.last-service", lang)}</div>
          </div>
          <div className="rounded-xl bg-muted/50 p-3">
            <div className="text-lg font-bold tabular-nums">{formatRM(lifetime)}</div>
            <div className="text-[11px] text-muted-foreground">{t("rider.lifetime-maintenance", lang)}</div>
          </div>
        </div>
        <Link href="/rider/book" className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground">
          <CalendarPlus className="h-4 w-4" /> {t("rider.book-service", lang)}
        </Link>
        <div className="mt-2 flex justify-center">
          <EditMotorcycle
            motorcycleId={passport.id}
            initial={{ brand: passport.brand, model: passport.model, year: passport.year, type: passport.type, color: passport.color, currentMileage: passport.currentMileage }}
          />
        </div>
        {showMotorcycleQr && (
          <div className="mt-3 flex justify-center">
            <QrToggle value={motorcycleQrUrl(passport.qrToken ?? passport.id)} label={t("bike.qr-label", lang)} defaultShow={false} size={96} />
          </div>
        )}
      </div>

      <div className="rounded-2xl border bg-card p-4">
        <h2 className="font-semibold">{t("rider.maintenance-cycle", lang)}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{t("rider.maintenance-cycle-desc", lang)}</p>
        <div className="mt-4 space-y-4">
          {(
            [
              { labelKey: "rider.engine-oil", icon: Droplets, lastKm: passport.lastOilChangeMileage, intervalKm: 3000 },
              { labelKey: "rider.oil-filter", icon: Filter, lastKm: passport.lastOilFilterMileage, intervalKm: 5000 },
              { labelKey: "rider.chain-sprocket", icon: Link2, lastKm: passport.lastServiceMileage, intervalKm: 3000 },
            ] as const
          ).map((c) => {
            const nextKm = c.lastKm == null ? null : c.lastKm + c.intervalKm;
            const over = nextKm != null && passport.currentMileage >= nextKm;
            return (
              <div key={c.labelKey}>
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <c.icon className="h-3.5 w-3.5 text-muted-foreground" /> {t(c.labelKey, lang)}
                  </span>
                  {over && <span className="font-semibold text-red-600">{t("rider.replace-now", lang)}</span>}
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{t("bike.last", lang)}</div>
                    <div className="text-sm font-bold tabular-nums">{c.lastKm == null ? "—" : fmtKM(c.lastKm)}</div>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{t("bike.next", lang)}</div>
                    <div className="text-sm font-bold tabular-nums">{nextKm == null ? "—" : fmtKM(nextKm)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {findings.length > 0 && (
        <div className="rounded-2xl border bg-card p-4">
          <h2 className="font-semibold">{t("rider.inspection-history", lang)}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t("rider.inspection-history-desc", lang)}</p>
          <div className="mt-3 space-y-2">
            {findings.map((f) => (
              <div key={f.id} className="rounded-xl border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{f.title}</span>
                  <span className={"shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold " + (f.severity === "FAIL" ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300")}>{f.severity}</span>
                </div>
                {f.note && <p className="mt-1 text-xs text-muted-foreground">{f.note}</p>}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="font-mono">{f.job.jobNumber} · {f.job.completedAt ? fmtDate(f.job.completedAt) : "—"}</span>
                  {f.approval ? (
                    <span className={"font-semibold " + (f.approval.status === "APPROVED" ? "text-emerald-600" : f.approval.status === "DECLINED" ? "text-red-600" : "text-muted-foreground")}>
                      {f.approval.status === "APPROVED" ? t("rider.fixed", lang) : f.approval.status === "DECLINED" ? t("rider.declined", lang) : t("common.pending", lang)}
                    </span>
                  ) : (
                    <span className="font-semibold text-muted-foreground">{t("rider.noted", lang)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <h2 className="font-semibold pt-2">{t("rider.verified-history", lang)}</h2>
      <div className="space-y-3">
        {jobs.map((j) => (
          <div key={j.id} className="rounded-2xl border bg-card p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold tracking-wide">{j.completedAt ? j.completedAt.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() : ""}</span>
              <span className="text-muted-foreground tabular-nums">{fmtKM(j.mileage)}</span>
            </div>
            <div className="mt-1 font-semibold">{j.packageName ?? t("rider.general-service", lang)}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {j.items.filter((i) => i.unitPriceSen === 0 || i.quantity > 0).slice(0, 6).map((i) => (
                <span key={i.id} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200">✓ {i.description}</span>
              ))}
              {j.parts.map((p) => (
                <span key={p.id} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200">✓ {p.product.name} ×{p.quantity}</span>
              ))}
            </div>
            <div className="mt-2.5 flex items-center justify-between text-xs text-muted-foreground">
              <span>D&Z Smart Workshop · {j.mechanic?.name ?? ""}</span>
              <span className="font-bold text-foreground tabular-nums">{formatRM(j.invoice?.totalSen ?? 0)}</span>
            </div>
          </div>
        ))}
        {jobs.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">{t("rider.no-verified", lang)}</p>}
      </div>
    </div>
  );
}
