import { jobService } from "@/modules/service-jobs/service";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { MechanicBoard, type BoardJob, type MechanicSummary } from "@/components/workshop/mechanic-board";
import { getLang } from "@/lib/get-lang";
import { scopedBranchId, scopedStaffWhere } from "@/lib/branch-scope";
import { t } from "@/lib/i18n";
import { PageTransition } from "@/components/shared/page-transition";

export const dynamic = "force-dynamic";

export default async function MechanicPage() {
  const lang = await getLang();
  const session = await getSessionUser();
  const isMechanic = session.kind === "staff" && session.role === "MECHANIC";
  const board = await jobService.listBoard(scopedBranchId(session));
  const active = board.jobs.filter((j) => ["WAITING", "IN_PROGRESS", "AWAITING_APPROVAL", "READY"].includes(j.status));
  // quotation status per active job (default allowed for no-quotation legacy jobs)
  const activeIds = active.map((j) => j.id);
  const quotes = activeIds.length ? await db.quotation.findMany({ where: { jobId: { in: activeIds } }, select: { jobId: true, status: true } }) : [];
  const quoteStatus = new Map(quotes.map((q) => [q.jobId, q.status]));

  // group active jobs by mechanic (including unassigned)
  const byMechanic = new Map<string, BoardJob[]>();
  for (const j of active) {
    const id = j.mechanic?.id ?? "unassigned";
    const arr = byMechanic.get(id) ?? [];
    arr.push({
      id: j.id, jobNumber: j.jobNumber, status: j.status, mileage: j.mileage,
      packageName: j.packageName, pendingApprovals: j.pendingApprovals,
      mechanicId: j.mechanic?.id ?? null,
      quotationApproved: (quoteStatus.get(j.id) ?? "APPROVED") === "APPROVED",
      motorcycle: j.motorcycle, customer: j.customer, isToday: j.isToday,
    });
    byMechanic.set(id, arr);
  }

  // all active mechanics (0-job mechanics still appear), plus unassigned bucket
  const allMechanics = (await db.user.findMany({ where: scopedStaffWhere(session, ["MECHANIC"]), select: { id: true, name: true, branch: { select: { name: true } } }, orderBy: { name: "asc" } })).map((m) => ({ id: m.id, name: m.name, branchName: m.branch?.name ?? null }));
  const byId = new Map<string, { id: string; name: string; jobs: BoardJob[] }>();
  for (const m of allMechanics) byId.set(m.id, { id: m.id, name: m.name, jobs: [] });
  for (const [id, jobs] of byMechanic) {
    const cur = byId.get(id) ?? { id, name: id === "unassigned" ? t("ws.mech.unassigned", lang) : id, jobs: [] };
    cur.jobs = jobs;
    byId.set(id, cur);
  }
  byId.set("unassigned", { id: "unassigned", name: t("ws.mech.unassigned", lang), jobs: byMechanic.get("unassigned") ?? [] });

  const mechanics: MechanicSummary[] = [...byId.values()].map((m) => ({
    id: m.id,
    name: m.name,
    jobs: m.jobs,
    todayCount: m.jobs.filter((j) => j.isToday).length,
    approvals: m.jobs.filter((j) => j.status === "AWAITING_APPROVAL").length,
    ready: m.jobs.filter((j) => j.status === "READY").length,
  })).sort((a, b) => (a.id === "unassigned" ? 1 : 0) - (b.id === "unassigned" ? 1 : 0) || b.jobs.length - a.jobs.length);

  // MECHANIC defaults to their own card; others default to the first (busiest)
  const initialMechanicId = isMechanic && session.user ? session.user.id : mechanics[0]?.id ?? "unassigned";

  return (
    <PageTransition>
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight mb-1">{t("nav.mechanic", lang)}</h1>
      <p className="text-sm text-muted-foreground mb-5">
        {isMechanic ? t("ws.mech.mech-hint", lang) : t("ws.mech.owner-hint", lang)}
      </p>
      <MechanicBoard
        mechanics={mechanics}
        initialMechanicId={initialMechanicId}
        ownerView={!isMechanic}
        allMechanics={allMechanics}
      />
    </div>
    </PageTransition>
  );
}