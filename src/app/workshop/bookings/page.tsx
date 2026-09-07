import Link from "next/link";
import { CalendarClock, CalendarDays, List } from "lucide-react";
import { db } from "@/lib/db";
import { StatusBadge } from "@/components/shared/status-badge";
import { PageTransition } from "@/components/shared/page-transition";
import { BookingActions } from "@/components/workshop/booking-actions";
import { fmtDate, fmtRelative } from "@/lib/format";
import { getLang } from "@/lib/get-lang";
import { getSessionUser } from "@/lib/session-user";
import { applyBranchScope } from "@/lib/branch-scope";
import { t, tpl } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/** 状态筛选条：All + 各状态（URL ?status= 驱动，保留其他筛选参数）。 */
const STATUS_FILTERS: { key: string; labelKey: string }[] = [
  { key: "", labelKey: "ws.jobs.all" },
  { key: "REQUESTED", labelKey: "book.REQUESTED" },
  { key: "CONFIRMED", labelKey: "book.CONFIRMED" },
  { key: "RESCHEDULED", labelKey: "book.RESCHEDULED" },
  { key: "CHECKED_IN", labelKey: "book.CHECKED_IN" },
  { key: "COMPLETED", labelKey: "book.COMPLETED" },
  { key: "CANCELLED", labelKey: "book.CANCELLED" },
  { key: "NO_SHOW", labelKey: "book.NO_SHOW" },
];

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ branch?: string; date?: string; view?: string; status?: string; sort?: string }> }) {
  const lang = await getLang();
  const sp = await searchParams;
  const org = await db.organisation.findFirst();
  const branches = await db.branch.findMany({ where: { organisationId: org!.id } });
  const session = await getSessionUser();
  const where: Record<string, unknown> = {};
  if (sp.branch) where.branchId = sp.branch;
  if (sp.status) where.status = sp.status;
  if (sp.date) {
    // 业务日期过滤：与存储约定一致（UTC 零点），避免服务器时区差异
    const d = new Date(sp.date + "T00:00:00Z");
    const next = new Date(d.getTime() + 86400000);
    where.date = { gte: d, lt: next };
  }
  // 严格隔离：branch 级用户默认只看本分行（除非显式 ?branch= 覆盖）
  applyBranchScope(where, session, sp.branch);
  // 统计分支/日期范围内的各 status 数量（不含当前 status 过滤，供筛选条显示）+ 总列表
  const countWhere = { ...where };
  delete countWhere.status;
  const [bookings, packages, statusGroups] = await Promise.all([
    db.booking.findMany({
      where,
      include: { customer: { select: { id: true, name: true, phone: true } }, motorcycle: { select: { id: true, brand: true, model: true, plate: true } }, branch: { select: { id: true, city: true } }, job: { select: { id: true, jobNumber: true, status: true } }, servicePackage: { select: { id: true, name: true } } },
      orderBy: { date: "asc" },
    }),
    db.servicePackage.findMany({ where: { active: true }, select: { id: true, name: true, priceSen: true, isBestValue: true }, orderBy: { priceSen: "asc" } }),
    db.booking.groupBy({ by: ["status"], where: countWhere, _count: { _all: true } }),
  ]);
  const statusCounts: Record<string, number> = {};
  for (const g of statusGroups) statusCounts[g.status] = g._count._all;
  const allCount = statusGroups.reduce((s, g) => s + g._count._all, 0);
  const order: Record<string, number> = { REQUESTED: 0, CONFIRMED: 1, RESCHEDULED: 2, CHECKED_IN: 3, COMPLETED: 4, CANCELLED: 5, NO_SHOW: 6 };
  // 同状态组内排序：显式 sort=desc 按日期降序；默认未来/今天优先（新预约可见），过去沉底，其余升序
  const todayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  const sorted = [...bookings].sort((a, b) => {
    const statusDiff = (order[a.status] ?? 9) - (order[b.status] ?? 9);
    if (statusDiff !== 0) return statusDiff;
    if (sp.sort === "desc") return b.date.getTime() - a.date.getTime();
    const aFuture = a.date.getTime() >= todayStart;
    const bFuture = b.date.getTime() >= todayStart;
    if (aFuture !== bFuture) return aFuture ? -1 : 1;
    return a.date.getTime() - b.date.getTime();
  });

  // month calendar (BOOK-026/027/028): counts per day for the displayed month
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(new Date(year, month, 1).toISOString().slice(0, 10) + "T00:00:00Z");
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = first.getDay();
  const monthBookings = await db.booking.findMany({
    where: { branchId: sp.branch || undefined, date: { gte: first, lt: new Date(new Date(year, month + 1, 1).toISOString().slice(0, 10) + "T00:00:00Z") } },
    select: { date: true },
  });
  const counts = new Map<string, number>();
  for (const b of monthBookings) {
    const key = b.date.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const view = sp.view ?? "list";
  // 构造带参数链接（保留 branch/date/status/sort/view，覆盖指定键）
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (sp.branch) p.set("branch", sp.branch);
    if (sp.date) p.set("date", sp.date);
    if (sp.status) p.set("status", sp.status);
    if (sp.sort) p.set("sort", sp.sort);
    if (sp.view) p.set("view", sp.view);
    Object.entries(extra).forEach(([k, v]) => { if (v) p.set(k, v); else p.delete(k); });
    const str = p.toString();
    return "/workshop/bookings" + (str ? "?" + str : "");
  };

  return (
    <PageTransition>
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold tracking-tight">{t("ws.bookings.title", lang)}</h1>
        <Link href="/workshop/bookings/slots" className="text-sm text-primary hover:underline">{t("ws.bookings.manage-slots", lang)}</Link>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{t("ws.bookings.subtitle", lang)} · {tpl("ws.bookings.shown", lang, { n: bookings.length })}</p>

      <form method="get" data-tut="bookings-filters" className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <select name="branch" defaultValue={sp.branch} className="rounded-md border bg-background px-3 py-2">
          <option value="">{t("ws.bookings.all-branches", lang)}</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.city}</option>)}
        </select>
        <input name="date" type="date" defaultValue={sp.date} className="rounded-md border bg-background px-3 py-2" />
        <button className="rounded-md border px-3 py-2 font-medium">{t("ws.bookings.filter", lang)}</button>
        {(sp.status || sp.branch || sp.date || sp.sort) && (
          <Link href="/workshop/bookings" className="rounded-md border border-dashed px-3 py-2 font-medium text-muted-foreground hover:text-foreground hover:bg-accent">{t("book.reset-filters", lang)}</Link>
        )}
        <div className="flex-1" />
        <a href={"/workshop/bookings?view=list" + (sp.branch ? "&branch=" + sp.branch : "") + (sp.date ? "&date=" + sp.date : "")} className={"inline-flex items-center gap-1 rounded-md border px-3 py-2 " + (view === "list" ? "bg-primary text-primary-foreground" : "")}><List className="h-3.5 w-3.5" />{t("ws.bookings.view-list", lang)}</a>
        <a href={"/workshop/bookings?view=calendar" + (sp.branch ? "&branch=" + sp.branch : "")} className={"inline-flex items-center gap-1 rounded-md border px-3 py-2 " + (view === "calendar" ? "bg-primary text-primary-foreground" : "")}><CalendarDays className="h-3.5 w-3.5" />{t("ws.bookings.view-month", lang)}</a>
      </form>

      {/* 状态筛选条 + 日期排序切换 */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f.key || "all"}
            href={qs({ status: f.key, view: "list" })}
            className={"rounded-full border px-3 py-1 text-xs font-medium transition-colors " + ((sp.status ?? "") === f.key ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}
          >
            {t(f.labelKey, lang)} <span className={"ml-1 tabular-nums " + ((sp.status ?? "") === f.key ? "text-primary-foreground/80" : "text-muted-foreground/70")}>{f.key ? (statusCounts[f.key] ?? 0) : allCount}</span>
          </Link>
        ))}
        <div className="flex-1" />
        <Link href={qs({ sort: "" })} className={"inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium " + (sp.sort !== "desc" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>{t("book.sort-date-asc", lang)}</Link>
        <Link href={qs({ sort: "desc" })} className={"inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium " + (sp.sort === "desc" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>{t("book.sort-date-desc", lang)}</Link>
      </div>

      {view === "calendar" ? (
        <div className="rounded-2xl border bg-card p-4">
          <h2 className="font-semibold text-sm mb-3">{year}-{String(month + 1).padStart(2, "0")} — {t("ws.bookings.per-day", lang)}</h2>
          <div className="grid grid-cols-7 gap-1.5 text-center">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="text-[10px] text-muted-foreground font-medium py-1">{d}</div>)}
            {Array.from({ length: firstWeekday }).map((_, i) => <div key={"e" + i} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const key = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
              const count = counts.get(key) ?? 0;
              const isToday = day === now.getDate();
              return (
                <Link
                  key={key}
                  href={"/workshop/bookings?date=" + key + "&view=list" + (sp.branch ? "&branch=" + sp.branch : "")}
                  className={"rounded-lg border p-2 min-h-[52px] hover:bg-accent transition-colors " + (isToday ? "border-primary" : "")}
                >
                  <div className="text-xs font-medium">{day}</div>
                  {count > 0 && <div className={"mt-1 text-[10px] font-semibold " + (count >= 4 ? "text-destructive" : "text-primary")}>{tpl(count > 1 ? "ws.bookings.n-plural" : "ws.bookings.n-single", lang, { n: count })}</div>}
                </Link>
              );
            })}
          </div>
        </div>
      ) : (
        <div data-tut="bookings-list" className="space-y-2">
          {sorted.map((b) => {
            const stripe = {
              REQUESTED: "border-l-amber-400", CONFIRMED: "border-l-blue-400", RESCHEDULED: "border-l-purple-400",
              CHECKED_IN: "border-l-cyan-400", COMPLETED: "border-l-emerald-400", CANCELLED: "border-l-red-400", NO_SHOW: "border-l-slate-300",
            }[b.status] ?? "border-l-border";
            return (
            <div key={b.id} data-testid="booking-row" className={"flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4 border-l-4 transition-colors hover:border-l-primary " + stripe}>
              <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <CalendarClock className="h-5 w-5" />
              </div>
              <div className="min-w-40 flex-1">
                <div className="font-medium text-sm">{b.customer.name}</div>
                <div className="text-xs text-muted-foreground">{b.motorcycle.brand} {b.motorcycle.model} · {b.motorcycle.plate}</div>
              </div>
              <div className="min-w-32">
                <div className="text-sm font-medium">{b.serviceType}</div>
                <div className="text-xs text-muted-foreground">{fmtDate(b.date)} · {b.timeSlot} · {b.branch.city}</div>
                <div className="text-[10px] text-muted-foreground/70">{t("book.submitted", lang)} {fmtRelative(b.createdAt)}</div>
              </div>
              <div className="text-[11px] uppercase text-muted-foreground">{b.source === "RIDER_APP" ? t("ws.bookings.source-rider", lang) : b.source}</div>
              <StatusBadge kind="booking" value={b.status} />
              {b.job && <Link href={"/workshop/jobs/" + b.job.id} className="text-xs font-mono text-primary hover:underline">{b.job.jobNumber}</Link>}
              {b.type === "REPAIR" && b.status === "CHECKED_IN" && !b.job && (
                <Link href={"/workshop/jobs/new?type=repair&customer=" + b.customer.id + "&motorcycle=" + b.motorcycle.id + "&bookingId=" + b.id} className="text-xs font-semibold text-primary hover:underline">{t("ws.bookings.create-repair", lang)}</Link>
              )}
              <BookingActions bookingId={b.id} status={b.status} packages={packages} servicePackageName={b.servicePackage?.name} serviceAddons={(b.serviceAddons as { description?: string }[] | null) ?? []} />
            </div>
            );
          })}
          {sorted.length === 0 && <div className="rounded-2xl border bg-card p-10 text-center text-sm text-muted-foreground">{t("ws.bookings.empty", lang)}</div>}
        </div>
      )}
    </div>
    </PageTransition>
  );
}