import Link from "next/link";
import { Plus } from "lucide-react";
import { jobService } from "@/modules/service-jobs/service";
import { StatusBadge } from "@/components/shared/status-badge";
import { Money } from "@/components/shared/money";
import { JobActions } from "@/components/workshop/job-actions";
import { Pagination } from "@/components/shared/pagination";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/format";
import { getSessionUser } from "@/lib/session-user";
import { getLang } from "@/lib/get-lang";
import { scopedBranchId } from "@/lib/branch-scope";
import { t } from "@/lib/i18n";
import { PageTransition } from "@/components/shared/page-transition";

export const dynamic = "force-dynamic";

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ status?: string; view?: string; page?: string }> }) {
  const sp = await searchParams;
  const { status, view } = sp;
  const page = Math.max(1, Number(sp.page) || 1);
  const lang = await getLang();
  const session = await getSessionUser();
  const board = await jobService.listBoard(scopedBranchId(session));
  // data isolation: MECHANIC sees only their assigned jobs
  const scoped = session.kind === "staff" && session.role === "MECHANIC" && session.user
    ? board.jobs.filter((j) => j.mechanic?.id === session.user!.id)
    : board.jobs;
  const filtered = status ? scoped.filter((j) => j.status === status) : scoped;
  const isKanban = view === "kanban";
  // pagination applies to the table view only (kanban keeps its per-column cap)
  const PAGE_SIZE = 25;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const columns = [
    { id: "WAITING", title: t("status.WAITING", lang), dot: "bg-slate-500" },
    { id: "IN_PROGRESS", title: t("status.IN_PROGRESS", lang), dot: "bg-blue-500" },
    { id: "AWAITING_APPROVAL", title: t("status.AWAITING_APPROVAL", lang), dot: "bg-amber-500" },
    { id: "READY", title: t("status.READY", lang), dot: "bg-emerald-500" },
    { id: "COMPLETED", title: t("status.COMPLETED", lang), dot: "bg-emerald-700" },
  ] as const;

  return (
    <PageTransition>
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t("ws.jobs.title", lang)}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("ws.jobs.summary", lang).replace("{n}", String(board.jobsToday)).replace("{w}", String(board.counts.WAITING)).replace("{a}", String(board.counts.AWAITING_APPROVAL))}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border bg-card p-0.5 text-xs">
            <Link href="/workshop/jobs" className={"rounded-md px-3 py-1.5 font-medium " + (!isKanban ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{t("ws.jobs.view-table", lang)}</Link>
            <Link href="/workshop/jobs?view=kanban" className={"rounded-md px-3 py-1.5 font-medium " + (isKanban ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{t("ws.jobs.view-kanban", lang)}</Link>
          </div>
          <Link href="/workshop/jobs/new"><Button size="sm"><Plus className="h-4 w-4 mr-1" /> {t("ws.job.create-service", lang)}</Button></Link>
        <Link href="/workshop/jobs/new?type=repair"><Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" /> {t("ws.job.create-repair", lang)}</Button></Link>
        </div>
      </div>

      {/* status filter pills */}
      <div data-tut="jobs-filter" className="flex flex-wrap gap-1.5 mb-5">
        <Link href="/workshop/jobs" className={"rounded-full border px-3 py-1 text-xs font-medium " + (!status ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground hover:border-primary/40")}>{t("ws.jobs.all", lang)} {board.jobs.length}</Link>
        {columns.map((c) => (
          <Link key={c.id} href={"/workshop/jobs?status=" + c.id} className={"rounded-full border px-3 py-1 text-xs font-medium flex items-center gap-1.5 " + (status === c.id ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground hover:border-primary/40")}>
            <span className={"h-2 w-2 rounded-full " + c.dot} />{c.title} {board.counts[c.id]}
          </Link>
        ))}
      </div>

      {isKanban ? (
        <div data-tut="jobs-board" className="grid md:grid-cols-3 xl:grid-cols-5 gap-3">
          {columns.map((col) => (
            <div key={col.id} className="rounded-2xl border bg-muted/30 p-2.5 min-h-40 flex flex-col">
              <div className="flex items-center justify-between px-1.5 pb-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <span className={"h-2 w-2 rounded-full " + col.dot} />{col.title}
                </span>
                <span className="rounded-full bg-card border px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">{board.counts[col.id]}</span>
              </div>
              <div className="space-y-2 flex-1">
                {board.jobs.filter((j) => j.status === col.id).slice(0, 12).map((j) => (
                  <Link key={j.id} href={"/workshop/jobs/" + j.id} className="dz-card-link block rounded-xl border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] font-semibold">{j.jobNumber}</span>
                      {j.pendingApprovals > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">{t("ws.jobs.pending-approvals", lang).replace("{n}", String(j.pendingApprovals))}</span>}
                    </div>
                    <div className="mt-1 text-sm font-semibold">{j.motorcycle.brand} {j.motorcycle.model}</div>
                    <div className="text-[11px] text-muted-foreground">{j.motorcycle.plate} · {j.customer.name}</div>
                    <div className="mt-1.5 text-xs font-semibold tabular-nums"><Money sen={j.totalSen} /></div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div data-tut="jobs-board" className="rounded-2xl border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">{t("ws.jobs.col-job", lang)}</th><th className="px-4 py-3 font-medium">{t("ws.jobs.col-customer", lang)}</th>
                  <th className="px-4 py-3 font-medium">{t("ws.jobs.col-motorcycle", lang)}</th><th className="px-4 py-3 font-medium">{t("ws.jobs.col-mileage", lang)}</th>
                  <th className="px-4 py-3 font-medium">{t("ws.jobs.col-service", lang)}</th><th className="px-4 py-3 font-medium">{t("ws.jobs.col-mechanic", lang)}</th>
                  <th className="px-4 py-3 font-medium">{t("common.total", lang)}</th><th className="px-4 py-3 font-medium">{t("common.status", lang)}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {pageItems.map((j) => (
                  <tr key={j.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-semibold"><Link href={"/workshop/jobs/" + j.id} className="hover:text-primary">{j.jobNumber}</Link></td>
                    <td className="px-4 py-3">
                      <Link href={"/workshop/customers/" + j.customer.id} className="font-medium hover:text-primary">{j.customer.name}</Link>
                      <div className="text-xs text-muted-foreground">{fmtDate(j.createdAt)}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">{j.motorcycle.brand} {j.motorcycle.model}<div className="text-muted-foreground">{j.motorcycle.plate}</div></td>
                    <td className="px-4 py-3 tabular-nums">{j.mileage.toLocaleString()}</td>
                    <td className="px-4 py-3 text-xs max-w-40 truncate">{j.packageName ?? j.customerRequest ?? "—"}</td>
                    <td className="px-4 py-3 text-xs">{j.mechanic?.name ?? "—"}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums"><Money sen={j.totalSen} /></td>
                    <td className="px-4 py-3"><StatusBadge kind="job" value={j.status} /></td>
                    <td className="px-4 py-3"><JobActions jobId={j.id} status={j.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!isKanban && <Pagination basePath="/workshop/jobs" page={page} totalPages={totalPages} query={{ status, view }} />}
    </div>
    </PageTransition>
  );
}