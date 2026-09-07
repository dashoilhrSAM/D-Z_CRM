import Link from "next/link";
import { ArrowRight, Sparkles, Wallet, TrendingUp, Wrench, Receipt, Filter, Users, CalendarClock, ListTodo, AlertTriangle, Clock } from "lucide-react";
import { dashboardService } from "@/services/dashboard";
import { aiService } from "@/modules/ai/service";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Money } from "@/components/shared/money";
import { db } from "@/lib/db";
import { formatRM } from "@/lib/money";
import { getSessionUser, personaForRole } from "@/lib/session-user";
import { scopedBranchId } from "@/lib/branch-scope";
import { PageTransition } from "@/components/shared/page-transition";
import { getLang } from "@/lib/get-lang";
import { t, tpl } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const lang = await getLang();
  const session = await getSessionUser();
  // 分行作用域：branch 级用户只见本分行；org 级(admin/owner/head-office)回退 main branch
  const scopedId = scopedBranchId(session);
  const branch = scopedId
    ? (await db.branch.findUnique({ where: { id: scopedId } }))
    : (await db.branch.findFirst({ where: { isMain: true } }));
  const [dash, recs] = await Promise.all([
    dashboardService.get(branch?.id),
    aiService.recommendations(branch?.id, lang),
  ]);

  // 当前用户：真实登录（Supabase→User）
  const persona = personaForRole(session.role);
  const user = session.authenticated
    ? { id: session.user?.id ?? "", name: session.name, role: session.role }
    : null;

  const statusRows = [
    { status: "WAITING", label: t("status.WAITING", lang), count: dash.statuses.WAITING, cls: "bg-slate-500" },
    { status: "IN_PROGRESS", label: t("status.IN_PROGRESS", lang), count: dash.statuses.IN_PROGRESS, cls: "bg-blue-500" },
    { status: "AWAITING_APPROVAL", label: t("status.AWAITING_APPROVAL", lang), count: dash.statuses.AWAITING_APPROVAL, cls: "bg-amber-500" },
    { status: "READY", label: t("status.READY", lang), count: dash.statuses.READY, cls: "bg-emerald-500" },
    { status: "COMPLETED", label: t("status.COMPLETED", lang), count: dash.statuses.COMPLETED, cls: "bg-emerald-700" },
  ] as const;

  const isOwner = persona === "OWNER";
  const isMechanic = persona === "MECHANIC";
  const greetingName = user?.name.split(" ")[0] ?? "Daniel";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t("dash.morning", lang) : hour < 18 ? t("dash.afternoon", lang) : t("dash.evening", lang);

  // data isolation: mechanic sees only their jobs in the snapshot
  const myJobs = isMechanic && user ? dash.board.jobs.filter((j) => j.mechanic?.id === user.id) : dash.board.jobs;
  const todayJobs = myJobs.filter((j) => j.isToday).slice(0, 9);

  return (
    <PageTransition>
    <div className="space-y-8">
      <div data-tut="greeting">
        <h1 className="text-2xl font-bold tracking-tight">{greeting}, {greetingName}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {session.authenticated ? (
            <>{session.name} · <span className="font-medium text-foreground">{t("role." + session.role, lang)}</span></>
          ) : (
            isMechanic ? t("dash.mechanic-sub", lang) : isOwner ? t("dash.owner-sub", lang) : t("dash.counter-sub", lang)
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          {isMechanic ? t("dash.mechanic-sub", lang) : isOwner ? t("dash.owner-sub", lang) : t("dash.counter-sub", lang)}
        </p>
      </div>

      {/* today metrics — role-scoped */}
      {isMechanic ? (
        <div data-tut="stats" className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatCard label={t("dash.my-active-jobs", lang)} value={myJobs.filter((j) => ["WAITING", "IN_PROGRESS", "AWAITING_APPROVAL", "READY"].includes(j.status)).length} unit={t("dash.unit-jobs", lang)} href="/workshop/mechanic" />
          <StatCard label={t("dash.my-jobs-today", lang)} value={todayJobs.length} unit={t("dash.unit-jobs", lang)} href="/workshop/jobs" />
          <StatCard label={t("dash.awaiting-approval", lang)} value={dash.statuses.AWAITING_APPROVAL} unit={t("dash.unit-approvals", lang)} href="/workshop/jobs?status=AWAITING_APPROVAL" tone="warn" />
          <StatCard label={t("dash.ready", lang)} value={dash.statuses.READY} unit={t("dash.unit-jobs", lang)} href="/workshop/jobs?status=READY" tone="success" />
        </div>
      ) : isOwner ? (
        <div data-tut="stats" className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatCard icon={<Wallet className="h-4 w-4" />} label={t("dash.today-sales", lang)} value={<Money sen={dash.todaySales} />} href="/workshop/finance/profit" />
          <StatCard icon={<TrendingUp className="h-4 w-4" />} label={t("dash.gross-profit", lang)} value={<Money sen={dash.todayGrossProfit} />} href="/workshop/finance/profit" tone="success" />
          <StatCard icon={<Wrench className="h-4 w-4" />} label={t("dash.jobs-today", lang)} value={dash.jobsToday} unit={t("dash.unit-jobs", lang)} href="/workshop/jobs" />
          <StatCard icon={<Receipt className="h-4 w-4" />} label={t("dash.avg-ticket", lang)} value={<Money sen={dash.avgTicket} />} href="/workshop/finance/profit" />
        </div>
      ) : (
        <div data-tut="stats" className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatCard label={t("dash.jobs-today", lang)} value={dash.jobsToday} unit={t("dash.unit-jobs", lang)} href="/workshop/jobs" />
          <StatCard label={t("dash.customers-due", lang)} value={dash.customersDue} unit={t("dash.unit-customers", lang)} href="/workshop/crm/reminders" tone="danger" />
          <StatCard label={t("dash.new-bookings", lang)} value={dash.statuses.WAITING + dash.statuses.IN_PROGRESS} unit={t("dash.unit-bookings", lang)} href="/workshop/bookings" />
          <StatCard label={t("dash.avg-rating", lang)} value={dash.avgRating + " ★"} href="/workshop/marketing/reviews" />
        </div>
      )}

      {/* DASH-002..023: leads / repeat / upcoming / tasks */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard icon={<Filter className="h-4 w-4" />} label={t("dash.total-leads", lang)} value={dash.totalLeads ?? 0} unit={t("dash.unit-leads", lang)} sub={tpl("dash.leads-this-month", lang, { n: dash.newLeads ?? 0 })} href="/workshop/leads" />
        <StatCard icon={<Users className="h-4 w-4" />} label={t("dash.repeat-customers", lang)} value={(dash.repeatPct ?? 0) + "%"} href="/workshop/customers" tone="success" />
        <StatCard icon={<CalendarClock className="h-4 w-4" />} label={t("dash.upcoming-bookings", lang)} value={dash.upcomingBookings ?? 0} unit={t("dash.unit-bookings", lang)} href="/workshop/bookings" />
        <StatCard icon={<ListTodo className="h-4 w-4" />} label={t("dash.open-followup-tasks", lang)} value={dash.openTasks ?? 0} unit={t("dash.unit-tasks", lang)} href="/workshop/tasks" />
      </div>

      {/* customer-facing service lifecycle distribution */}
      <section className="rounded-2xl border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">{t("dash.lifecycle-title", lang)}</h2>
          <Link href="/workshop/jobs" className="text-xs font-medium text-primary hover:underline">{t("dash.jobs-link", lang)} →</Link>
        </div>
        {(dash.lifecycleDist ?? []).some((s) => s.count > 0) ? (
          <div className="space-y-2">
            {(() => {
              const STEP_COLOR: Record<string, string> = {
                book_requested: "bg-blue-500/80",
                book_confirmed: "bg-sky-500/80",
                checked_in: "bg-amber-500/80",
                in_service: "bg-primary/80",
                qc_check: "bg-cyan-500/80",
                ready: "bg-emerald-500/80",
                completed: "bg-emerald-700/80",
              };
              return dash.lifecycleDist.map((s, i) => (
                <Link key={s.label} href={s.href ?? "/workshop/jobs"} className="group flex items-center gap-3 text-xs rounded-md px-1 -mx-1 hover:bg-muted/40 transition-colors">
                  <span className="w-32 shrink-0 text-muted-foreground group-hover:text-foreground">{t("svc." + s.label, lang)}</span>
                  <div className="flex-1 h-5 rounded-md bg-muted/60 overflow-hidden">
                    <div className={"h-full rounded-md " + (STEP_COLOR[s.label] ?? "bg-primary/70")} style={{ width: Math.max(4, (s.count / Math.max(1, ...dash.lifecycleDist.map((x) => x.count))) * 100) + "%" }} />
                  </div>
                  <span className="w-6 text-right font-semibold tabular-nums">{s.count}</span>
                </Link>
              ));
            })()}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("dash.no-active-jobs", lang)}</p>
        )}
      </section>

      {/* workshop status */}
      <section data-tut="board">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">{t("dash.workshop-status", lang)}</h2>
          <Link href="/workshop/jobs" className="text-xs font-medium text-primary flex items-center gap-1">{t("dash.view-job-board", lang)} <ArrowRight className="h-3 w-3" /></Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {statusRows.map((s) => (
            <Link key={s.status} href={"/workshop/jobs?status=" + s.status} className="flex items-center gap-2 rounded-full border bg-card py-1.5 pl-1.5 pr-4 text-sm hover:border-primary/40 transition-colors">
              <span className={"h-2.5 w-2.5 rounded-full " + s.cls} />
              <span className="font-medium">{s.count}</span>
              <span className="text-muted-foreground text-xs">{s.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* additional cards — owner-only financials/stock/marketing */}
      {isOwner && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
          <StatCard label={t("dash.customers-due", lang)} value={dash.customersDue} unit={t("dash.unit-customers", lang)} href="/workshop/crm/reminders" tone="danger" />
          <StatCard label={t("dash.critical-stock", lang)} value={dash.criticalStock} href="/workshop/inventory/alerts" tone="danger" />
          <StatCard label={t("dash.dead-stock-value", lang)} value={<Money sen={dash.deadStockValue} />} href="/workshop/inventory/dead-stock" tone="warn" />
          <StatCard label={t("dash.avg-rating", lang)} value={dash.avgRating + " ★"} href="/workshop/marketing/reviews" />
          {dash.topPerformer && (
            <StatCard label={t("dash.top-performer", lang)} value={dash.topPerformer.name.split(" ")[0]} sub={t("dash.score", lang) + " " + dash.topPerformer.score} href="/workshop/staff/kpi" tone="success" />
          )}
        </div>
      )}

      {/* AI recommendations — owner & counter */}
      {!isMechanic && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">{t("dash.ai-centre", lang)}</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {(() => {
              const TAG = {
                danger: { icon: <AlertTriangle className="h-3 w-3" />, cls: "bg-red-500/10 text-red-600 dark:text-red-300", label: t("dash.rec-alert", lang) },
                warn: { icon: <Clock className="h-3 w-3" />, cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300", label: t("dash.rec-action", lang) },
                info: { icon: <Sparkles className="h-3 w-3" />, cls: "bg-primary/10 text-primary", label: t("dash.rec-insight", lang) },
                success: { icon: <Sparkles className="h-3 w-3" />, cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300", label: t("dash.rec-insight", lang) },
              } as const;
              const CTA = {
                danger: "bg-red-500/10 text-red-600 dark:text-red-300 group-hover:bg-red-500/15",
                warn: "bg-amber-500/10 text-amber-700 dark:text-amber-300 group-hover:bg-amber-500/15",
                info: "bg-primary/10 text-primary group-hover:bg-primary/15",
                success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 group-hover:bg-emerald-500/15",
              } as const;
              return recs.map((r, i) => {
                const tag = TAG[r.tone] ?? TAG.info;
                return (
                  <Link key={i} href={r.href} className="group rounded-2xl border bg-card p-4 hover:border-primary/40 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm">{r.title}</p>
                      <span className={"inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide " + tag.cls}>{tag.icon}{tag.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{r.detail}</p>
                    <span className={"mt-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors " + (CTA[r.tone] ?? CTA.info)}>{r.action} →</span>
                  </Link>
                );
              });
            })()}
            {recs.length === 0 && <p className="text-sm text-muted-foreground col-span-2">{t("dash.no-recs", lang)}</p>}
          </div>
        </section>
      )}

      {/* today's jobs snapshot — role-scoped */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">{isMechanic ? t("dash.my-today-jobs", lang) : t("dash.today-jobs", lang)}</h2>
          <Link href="/workshop/jobs" className="text-xs font-medium text-primary">{t("dash.all-jobs", lang)} →</Link>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {todayJobs.map((j) => (
            <Link key={j.id} href={"/workshop/jobs/" + j.id} className="rounded-2xl border bg-card p-4 hover:border-primary/40 transition-colors">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold">{j.jobNumber}</span>
                <StatusBadge kind="job" value={j.status} />
              </div>
              <div className="mt-2 font-semibold text-sm">{j.motorcycle.brand} {j.motorcycle.model}</div>
              <div className="text-xs text-muted-foreground">{j.motorcycle.plate} · {j.customer.name}</div>
              <div className="mt-2 text-sm font-semibold tabular-nums"><Money sen={j.totalSen} /></div>
            </Link>
          ))}
          {todayJobs.length === 0 && <p className="text-sm text-muted-foreground col-span-3 text-center py-6">{isMechanic ? t("dash.no-jobs-assigned", lang) : t("dash.no-jobs-created", lang)}</p>}
        </div>
      </section>
    </div>
    </PageTransition>
  );
}
