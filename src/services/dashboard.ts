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
      // 只要数字（jobsToday / 各状态计数）—— 不为此扫描整张工单表
      jobService.boardSummary(branchId),
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
        // 只取「按状态的行数」：原来把每一张活跃工单、每一条活跃预约都取回来再逐行归类。
        // 归类本来就只取决于状态，所以分组计数是等价且便宜的写法。
        // 注意 jobId: null —— 原来对「已挂到工单上的预约」是 continue 跳过（由工单那侧计），
        // 这个条件必须在数据库里表达，否则会把它们重复计一次。
        const [jobRows, bookingRows] = await Promise.all([
          db.serviceJob.groupBy({
            by: ["status"],
            where: { ...opWhere, status: { in: ["WAITING", "IN_PROGRESS", "AWAITING_APPROVAL", "QC_CHECK", "WAITING_PARTS", "ON_HOLD", "READY"] } },
            _count: { _all: true },
          }),
          db.booking.groupBy({
            by: ["status"],
            where: { ...opWhere, status: { in: ["REQUESTED", "CONFIRMED", "RESCHEDULED", "CHECKED_IN"] }, jobId: null },
            _count: { _all: true },
          }),
        ]);
        const buckets = new Array(LIFECYCLE_STEPS.length).fill(0) as number[];
        for (const bk of bookingRows) {
          const { stepIndex } = resolveStep(bk.status, null);
          if (stepIndex != null) buckets[stepIndex] += bk._count._all;
        }
        for (const j of jobRows) {
          const { stepIndex } = resolveStep(null, j.status);
          if (stepIndex != null) buckets[stepIndex] += j._count._all;
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
      // 重复客户率：原来把全组织**每一个客户连同其全部工单 id** 读回来再数 ≥2 的。
      // 现在两次计数就够（总数一条 count；「有 ≥2 张工单的客户」一条分组计数，只回一个数字）。
      // 这段刻意不看分店（与改前一致：重复率是组织级口径）。
      (async () => {
        const [total, repeatRows] = await Promise.all([
          db.customer.count({ where: { organisationId: orgId } }),
          db.$queryRaw<{ n: number | bigint }[]>`SELECT COUNT(*) AS n FROM (
              SELECT j."customerId" AS cid FROM "ServiceJob" j
              JOIN "Customer" c ON c."id" = j."customerId"
              WHERE c."organisationId" = ${orgId}
              GROUP BY j."customerId" HAVING COUNT(*) >= 2
            ) t`,
        ]);
        const repeat = Number(repeatRows[0]?.n ?? 0);
        return { total, repeatPct: total > 0 ? Math.round((repeat / total) * 100) : 0 };
      })(),
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