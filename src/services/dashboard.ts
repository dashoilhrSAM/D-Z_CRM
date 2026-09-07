import { jobService } from "@/modules/service-jobs/service";
import { financeService } from "@/modules/finance/service";
import { crmService } from "@/modules/crm/service";
import { inventoryService } from "@/modules/inventory/service";
import { staffService } from "@/modules/staff/service";
import { db } from "@/lib/db";

/** Workshop dashboard aggregates (§17). */
export class DashboardService {
  async get(branchId?: string) {
    const [board, finance, reminders, reviews, kpi] = await Promise.all([
      jobService.listBoard(branchId),
      this.todayFinance(branchId),
      crmService.reminders(),
      crmService.reviews(),
      staffService.kpiBoard(branchId, 30),
    ]);
    const criticalStock = branchId ? await inventoryService.criticalStockCount(branchId) : 0;
    const deadStockValue = branchId ? await inventoryService.deadStockValue(branchId) : 0;
    const customersDue = reminders.filter((r) => r.status === "DUE" || r.status === "OVERDUE").length;
    // DASH-002..023: leads / repeat % / upcoming bookings / open tasks / lead trend
    const org = await db.organisation.findFirst();
    const orgId = org!.id;
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const bWhere = branchId ? { branchId } : {};
    const opWhere = branchId ? { branchId } : { branch: { organisationId: orgId } };
    const [totalLeads, newLeads, leadTrend, openTasks, lifecycleDist, repeatStats, upcoming] = await Promise.all([
      db.lead.count({ where: { organisationId: orgId, ...bWhere } }),
      db.lead.count({ where: { organisationId: orgId, ...bWhere, createdAt: { gte: monthStart } } }),
      db.lead.groupBy({ by: ["createdAt"], where: { organisationId: orgId, ...bWhere }, _count: true }).then((rows) => {
        const byDay: Record<string, number> = {};
        for (const r of rows) { const k = r.createdAt.toISOString().slice(0, 10); byDay[k] = (byDay[k] ?? 0) + 1; }
        return Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).slice(-14).map(([label, value]) => ({ label, value }));
      }),
      db.task.count({ where: { organisationId: orgId, ...bWhere, status: "OPEN", OR: [{ dueAt: null }, { dueAt: { lte: new Date(Date.now() + 7 * 86400000) } }] } }),
      // lifecycle distribution: active bookings+jobs bucketed by customer-facing step
      (async () => {
        const { resolveStep, LIFECYCLE_STEPS } = await import("@/modules/rider/status");
        const [jobs, bookings] = await Promise.all([
          db.serviceJob.findMany({ where: { ...opWhere, status: { in: ["WAITING", "IN_PROGRESS", "AWAITING_APPROVAL", "QC_CHECK", "WAITING_PARTS", "ON_HOLD", "READY"] } }, select: { status: true } }),
          db.booking.findMany({ where: { ...opWhere, status: { in: ["REQUESTED", "CONFIRMED", "RESCHEDULED", "CHECKED_IN"] } }, select: { status: true, jobId: true } }),
        ]);
        const buckets = new Array(LIFECYCLE_STEPS.length).fill(0) as number[];
        for (const bk of bookings) {
          if (bk.jobId) continue; // counted via its job
          const { stepIndex } = resolveStep(bk.status, null);
          if (stepIndex != null) buckets[stepIndex]++;
        }
        for (const j of jobs) {
          const { stepIndex } = resolveStep(null, j.status);
          if (stepIndex != null) buckets[stepIndex]++;
        }
        const HREF: Record<string, string> = {
          book_requested: "/workshop/bookings?status=REQUESTED",
          book_confirmed: "/workshop/bookings?status=CONFIRMED",
          checked_in: "/workshop/jobs?status=WAITING",
          in_service: "/workshop/jobs?status=IN_PROGRESS",
          qc_check: "/workshop/jobs?status=QC_CHECK",
          ready: "/workshop/jobs?status=READY",
          completed: "/workshop/jobs?status=COMPLETED",
        };
        return LIFECYCLE_STEPS.map((label, i) => ({ label, count: buckets[i], href: HREF[label] }));
      })(),
      db.customer.findMany({ where: { organisationId: orgId }, select: { jobs: { select: { id: true } } } }).then((cs) => {
        const repeat = cs.filter((c) => c.jobs.length >= 2).length;
        return { total: cs.length, repeatPct: cs.length > 0 ? Math.round((repeat / cs.length) * 100) : 0 };
      }),
      db.booking.count({ where: { ...opWhere, date: { gte: new Date() }, status: { in: ["REQUESTED", "CONFIRMED", "RESCHEDULED"] } } }),
    ]);
    return {
      todaySales: finance.revenue,
      todayGrossProfit: finance.grossProfit,
      jobsToday: board.jobsToday,
      avgTicket: board.jobsToday ? Math.round(finance.revenue / board.jobsToday) : 0,
      statuses: board.counts,
      customersDue,
      criticalStock,
      deadStockValue,
      avgRating: Math.round(reviews.avg * 10) / 10,
      topPerformer: kpi.top,
      board,
      totalLeads, newLeads, leadTrend, openTasks, repeatPct: repeatStats.repeatPct, upcomingBookings: upcoming,
      lifecycleDist,
    };
  }

  private async todayFinance(branchId?: string | null) {
    const invoices = await db.invoice.findMany({
      where: { status: { not: "DRAFT" }, ...(branchId ? { branchId } : {}) },
      include: { job: { include: { parts: true } } },
    });
    const now = new Date();
    const today = invoices.filter((i) => {
      const d = new Date(i.issuedAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    });
    const revenue = today.reduce((s, i) => s + i.totalSen, 0);
    const cogs = today.reduce((s, i) => {
      const parts = i.job?.parts.filter((p) => p.status !== "DECLINED") ?? [];
      return s + parts.reduce((s2, p) => s2 + p.unitCostSen * p.quantity, 0);
    }, 0);
    return { revenue, grossProfit: revenue - cogs };
  }
}

export const dashboardService = new DashboardService();