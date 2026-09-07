import type { KpiStaff } from "@/types";
import type { IStaffRepository } from "./repository";
import { PrismaStaffRepository } from "@/repositories/prisma/staff.repository";
import { calculateKpiScore } from "@/lib/state-machines";
import { db } from "@/lib/db";

/** 薪资规则：底薪 + 提成（按单/按服务金额%）+ 附加工单奖励。 */
export interface SalaryRules {
  baseSen: number;
  commissionType: "per_job" | "percent_sales" | "flat";
  commissionValue: number; // per_job: RM/单（sen）；percent_sales: %；flat: 忽略
  addonBonusSen?: number;  // 每张附加工单的奖励（sen）
}

export const DEFAULT_SALARY_RULES: SalaryRules = { baseSen: 0, commissionType: "percent_sales", commissionValue: 0 };

export function parseSalaryRules(raw: unknown): SalaryRules {
  const o = (raw ?? {}) as Partial<SalaryRules>;
  return {
    baseSen: o.baseSen ?? 0,
    commissionType: o.commissionType ?? "percent_sales",
    commissionValue: o.commissionValue ?? 0,
    addonBonusSen: o.addonBonusSen ?? 0,
  };
}

export function calcSalary(rules: SalaryRules, jobs: number, salesSen: number, addonJobs: number): number {
  return calcSalaryBreakdown(rules, jobs, salesSen, addonJobs).total;
}

/** 薪资拆分：base + commission + addon 奖励。 */
export function calcSalaryBreakdown(rules: SalaryRules, jobs: number, salesSen: number, addonJobs: number): { baseSen: number; commissionSen: number; addonBonusSen: number; total: number } {
  let commission = 0;
  if (rules.commissionType === "per_job") commission = rules.commissionValue * jobs;
  else if (rules.commissionType === "percent_sales") commission = Math.round(salesSen * (rules.commissionValue / 100));
  const baseSen = rules.baseSen;
  const addonBonusSen = (rules.addonBonusSen ?? 0) * addonJobs;
  return { baseSen, commissionSen: commission, addonBonusSen, total: baseSen + commission + addonBonusSen };
}

/** 每技师生效规则：个人 commissionRules（有则用个人的）否则回退 org 默认。 */
export function effectiveRules(user: { commissionRules: string | null }, orgRules: SalaryRules): SalaryRules {
  if (!user.commissionRules) return orgRules;
  try { return parseSalaryRules(JSON.parse(user.commissionRules)); } catch { return orgRules; }
}

/** 单个 job 的提成：手工覆盖优先；否则按个人算法（per_job=固定值 / percent_sales=该job销售额×% / flat=0）。 */
export function calcJobCommission(rules: SalaryRules, jobSalesSen: number, manualSen: number | null | undefined): number {
  if (manualSen != null) return manualSen;
  if (rules.commissionType === "per_job") return rules.commissionValue;
  if (rules.commissionType === "percent_sales") return Math.round(jobSalesSen * (rules.commissionValue / 100));
  return 0;
}

/**
 * Staff KPI (§33) — fully deterministic and explainable, never AI-invented.
 * Score = 0.30×jobs + 0.20×ticket + 0.15×package + 0.15×addon + 0.10×checklist + 0.10×rating
 */
export class StaffService {
  constructor(private repo: IStaffRepository = new PrismaStaffRepository()) {}

  /** Foreman 周期结算：按日/周/月聚合完成工单 + 服务金额 + 附加 + 工时（老板视角，纯查询）。 */
  async settlement(period: "day" | "week" | "month", ref?: Date, branchId?: string | null): Promise<{
    period: string; start: Date; end: Date;
    rules: SalaryRules;
    foremen: { id: string; name: string; jobs: number; salesSen: number; avgTicketSen: number; addonJobs: number; hours: number; salarySen: number; salaryBreakdown: { baseSen: number; commissionSen: number; addonBonusSen: number }; payout: { status: string; paidSen: number; paidAt: Date | null } | null; jobsList: { id: string; jobNumber: string; serviceType: string; packageName: string | null; completedAt: Date; salesSen: number; commissionSen: number }[] }[];
    totals: { jobs: number; salesSen: number; hours: number; salarySen: number };
  }> {
    // +8 业务时区（Asia/Kuala_Lumpur）的周期窗口 → UTC 边界
    const base = ref ?? new Date();
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(base).split("-").map(Number);
    const [y, m, d] = ymd as [number, number, number];
    const dayStartUtc = Date.UTC(y, m - 1, d) - 8 * 3600000; // +8 当日 00:00 = UTC 前日 16:00
    let start: Date; let end: Date;
    if (period === "day") {
      start = new Date(dayStartUtc);
      end = new Date(dayStartUtc + 86400000);
    } else if (period === "week") {
      // 周一为一周起点（+8 视角）
      const dow = new Date(dayStartUtc + 8 * 3600000).getUTCDay(); // 0=Sun
      const mondayOffset = (dow + 6) % 7;
      start = new Date(dayStartUtc - mondayOffset * 86400000);
      end = new Date(start.getTime() + 7 * 86400000);
    } else {
      start = new Date(Date.UTC(y, m - 1, 1) - 8 * 3600000);
      end = new Date(Date.UTC(y, m, 1) - 8 * 3600000);
    }

    const org = await db.organisation.findFirst({ select: { salaryRules: true } });
    const orgRules = parseSalaryRules(org?.salaryRules);
    const users = await this.repo.listUsers(branchId);
    const foremen: { id: string; name: string; jobs: number; salesSen: number; avgTicketSen: number; addonJobs: number; hours: number; salarySen: number; salaryBreakdown: { baseSen: number; commissionSen: number; addonBonusSen: number }; payout: { status: string; paidSen: number; paidAt: Date | null } | null; jobsList: { id: string; jobNumber: string; serviceType: string; packageName: string | null; completedAt: Date; salesSen: number; commissionSen: number }[] }[] = [];

    for (const u of users) {
      const rules = effectiveRules(u, orgRules);
      const jobs = u.jobs.filter((j) => j.status === "COMPLETED" && j.completedAt && j.completedAt >= start && j.completedAt < end);
      if (jobs.length === 0) continue;
      const jobIds = jobs.map((j) => j.id);
      const [items, invoices] = await Promise.all([
        db.serviceJobItem.findMany({ where: { jobId: { in: jobIds }, status: { not: "DECLINED" } } }),
        db.invoice.findMany({ where: { jobId: { in: jobIds } } }),
      ]);
      const salesByJob = new Map<string, number>();
      for (const inv of invoices) if (inv.jobId) salesByJob.set(inv.jobId, (salesByJob.get(inv.jobId) ?? 0) + inv.totalSen);
      const addonJobs = new Set<string>();
      for (const it of items) if (it.source === "COUNTER" || it.source === "APPROVAL") addonJobs.add(it.jobId);
      const totalSales = [...salesByJob.values()].reduce((s, v) => s + v, 0);
      const hours = jobs.reduce((s2, j) => {
        const endT = j.completedAt ?? j.createdAt;
        const startT = j.startedAt ?? j.createdAt;
        return s2 + Math.max(0, (endT.getTime() - startT.getTime()) / 3600000);
      }, 0);

      const payout = await db.staffPayout.findUnique({
        where: { userId_period_periodStart: { userId: u.id, period, periodStart: start } },
        include: { payments: { select: { amountSen: true } } },
      });
      const paidSen = payout?.payments.reduce((s2, p) => s2 + p.amountSen, 0) ?? 0;
      // 每单提成（手工覆盖优先，否则按个人算法）→ Σ + 增项奖励（无底薪）
      const jobCommissions = jobs.map((j) => calcJobCommission(rules, salesByJob.get(j.id) ?? 0, j.commissionSen ?? null));
      const commissionSen = jobCommissions.reduce((s2, c) => s2 + c, 0);
      const addonBonusSen = (rules.addonBonusSen ?? 0) * addonJobs.size;
      const salarySen = commissionSen + addonBonusSen;
      foremen.push({
        id: u.id, name: u.name, jobs: jobs.length, salesSen: totalSales,
        avgTicketSen: jobs.length ? Math.round(totalSales / jobs.length) : 0,
        addonJobs: addonJobs.size, hours: Math.round(hours * 10) / 10,
        salarySen,
        salaryBreakdown: { baseSen: 0, commissionSen, addonBonusSen },
        payout: payout ? { status: payout.status, paidSen, paidAt: payout.paidAt } : null,
        jobsList: jobs.map((j, idx) => ({ id: j.id, jobNumber: j.jobNumber, serviceType: j.packageName ?? j.customerRequest ?? "", packageName: j.packageName, completedAt: j.completedAt!, salesSen: salesByJob.get(j.id) ?? 0, commissionSen: jobCommissions[idx] ?? 0 })).sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime()),
      });
    }
    foremen.sort((a, b) => b.salesSen - a.salesSen);
    return {
      period, start, end,
      rules: orgRules,
      foremen,
      totals: {
        jobs: foremen.reduce((s, f) => s + f.jobs, 0),
        salesSen: foremen.reduce((s, f) => s + f.salesSen, 0),
        hours: Math.round(foremen.reduce((s, f) => s + f.hours, 0) * 10) / 10,
        salarySen: foremen.reduce((s, f) => s + f.salarySen, 0),
      },
    };
  }

  async kpiBoard(branchId?: string | null, days = 30): Promise<{ staff: KpiStaff[]; top: KpiStaff | null }> {
    const users = await this.repo.listUsers(branchId);
    const cutoff = new Date(Date.now() - days * 86400000);
    const staff: KpiStaff[] = [];

    for (const u of users) {
      const jobs = u.jobs.filter((j) => j.status === "COMPLETED" && (j.completedAt ?? j.createdAt) >= cutoff);
      if (jobs.length === 0 && u.role !== "MECHANIC") continue;
      const jobIds = jobs.map((j) => j.id);
      if (jobIds.length === 0) {
        staff.push({ id: u.id, name: u.name, role: u.role, jobs: 0, salesSen: 0, avgTicketSen: 0, packageConversion: 0, addonConversion: 0, checklistCompletion: 0, rating: 0, score: 0 });
        continue;
      }
      const [items, parts, checklists, reviews] = await Promise.all([
        db.serviceJobItem.findMany({ where: { jobId: { in: jobIds }, status: { not: "DECLINED" } } }),
        db.serviceJobPart.findMany({ where: { jobId: { in: jobIds }, status: { not: "DECLINED" } } }),
        db.checklistExecution.findMany({ where: { jobId: { in: jobIds } }, include: { items: true } }),
        db.review.findMany({ where: { jobId: { in: jobIds }, rating: { not: null } } }),
      ]);
      const invoices = await db.invoice.findMany({ where: { jobId: { in: jobIds } } });
      const sales = invoices.reduce((s, i) => s + i.totalSen, 0);
      const withPackage = jobs.filter((j) => j.packageName).length;
      const jobsWithAddon = new Set<string>();
      for (const it of items) if (it.source === "COUNTER" || it.source === "APPROVAL") jobsWithAddon.add(it.jobId);
      for (const p of parts) if (p.source === "COUNTER") jobsWithAddon.add(p.jobId);
      const checklistRates = checklists.map((c) => (c.items.length ? c.items.filter((i) => i.result !== "NA").length / c.items.length : 0));
      const checklistCompletion = checklistRates.length ? (checklistRates.reduce((s2, r) => s2 + r, 0) / checklistRates.length) * 100 : 0;
      const rating = reviews.length ? reviews.reduce((s2, r) => s2 + r.rating!, 0) / reviews.length : 0;
      const avgTicket = sales / jobs.length;
      const packageConversion = (withPackage / jobs.length) * 100;
      const addonConversion = (jobsWithAddon.size / jobs.length) * 100;

      const score = calculateKpiScore({
        jobs: jobs.length,
        avgTicketSen: Math.round(avgTicket),
        packageConversion,
        addonConversion,
        checklistCompletion,
        rating,
      });

      staff.push({
        id: u.id, name: u.name, role: u.role, jobs: jobs.length, salesSen: sales, avgTicketSen: Math.round(avgTicket),
        packageConversion: Math.round(packageConversion * 10) / 10,
        addonConversion: Math.round(addonConversion * 10) / 10,
        checklistCompletion: Math.round(checklistCompletion * 10) / 10,
        rating: Math.round(rating * 10) / 10,
        score,
      });
    }
    const sorted = staff.sort((a, b) => b.score - a.score);
    return { staff: sorted, top: sorted[0] ?? null };
  }

  /** 按日薪资单：窗口（today/3d/7d/30d+）内每个 foreman 的每日账单（jobs/金额/薪资拆分/发薪状态）。 */
  async settlementByDay(windowDays: number, ref?: Date, branchId?: string | null): Promise<{
    start: Date; end: Date; rules: SalaryRules;
    foremen: { id: string; name: string; totalSen: number; totalJobs: number; totalSalesSen: number;
      daily: { date: Date; jobs: number; salesSen: number; baseSen: number; commissionSen: number; addonBonusSen: number; bonusSen: number; totalSen: number;
        payout: { id: string; status: string; paidSen: number; paidAt: Date | null } | null;
        jobsList: { jobId: string; jobNumber: string; serviceType: string; plate: string; customer: string; salesSen: number; commissionSen: number }[] }[];
      commissionRules: { commissionType: string; commissionValue: number; addonBonusSen: number } | null }[];
  }> {
    const base = ref ?? new Date();
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(base).split("-").map(Number);
    const [y, m, d] = ymd as [number, number, number];
    const todayStartUtc = Date.UTC(y, m - 1, d) - 8 * 3600000;
    const start = new Date(todayStartUtc - (windowDays - 1) * 86400000);
    const end = new Date(todayStartUtc + 86400000);

    const org = await db.organisation.findFirst({ select: { salaryRules: true } });
    const orgRules = parseSalaryRules(org?.salaryRules);
    const users = await this.repo.listUsers(branchId);
    const foremen: { id: string; name: string; totalSen: number; totalJobs: number; totalSalesSen: number; daily: { date: Date; jobs: number; salesSen: number; baseSen: number; commissionSen: number; addonBonusSen: number; bonusSen: number; totalSen: number; payout: { id: string; status: string; paidSen: number; paidAt: Date | null } | null; jobsList: { jobId: string; jobNumber: string; serviceType: string; plate: string; customer: string; salesSen: number; commissionSen: number }[] }[]; commissionRules: { commissionType: string; commissionValue: number; addonBonusSen: number } | null }[] = [];

    for (const u of users) {
      const rules = effectiveRules(u, orgRules);
      const jobs = u.jobs.filter((j) => j.status === "COMPLETED" && j.completedAt && j.completedAt >= start && j.completedAt < end);
      if (jobs.length === 0) continue;
      const jobIds = jobs.map((j) => j.id);
      const [items, invoices] = await Promise.all([
        db.serviceJobItem.findMany({ where: { jobId: { in: jobIds }, status: { not: "DECLINED" } } }),
        db.invoice.findMany({ where: { jobId: { in: jobIds } } }),
      ]);
      const salesByJob = new Map<string, number>();
      for (const inv of invoices) if (inv.jobId) salesByJob.set(inv.jobId, (salesByJob.get(inv.jobId) ?? 0) + inv.totalSen);
      const addonJobs = new Set<string>();
      for (const it of items) if (it.source === "COUNTER" || it.source === "APPROVAL") addonJobs.add(it.jobId);
      const addonJobIds = new Set<string>(jobIds.filter((id) => addonJobs.has(id)));

      // 该 foreman 窗口内完成工单明细（车辆/客户）
      const jobDetails = await db.serviceJob.findMany({
        where: { id: { in: jobIds } },
        include: { motorcycle: { select: { plate: true } }, customer: { select: { name: true } } },
      });
      const detailByJob = new Map(jobDetails.map((j) => [j.id, j]));

      // 按天分组（窗口内每天都有行——含 0 工单日，payout 状态可显示）
      const byDay = new Map<string, { date: Date; jobs: string[]; salesSen: number; addonCount: number }>();
      for (let t = start.getTime(); t < end.getTime(); t += 86400000) {
        const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
        byDay.set(key, { date: new Date(key + "T00:00:00Z"), jobs: [], salesSen: 0, addonCount: 0 });
      }
      for (const j of jobs) {
        const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(j.completedAt!);
        const cur = byDay.get(dayKey) ?? { date: new Date(dayKey + "T00:00:00Z"), jobs: [], salesSen: 0, addonCount: 0 };
        cur.jobs.push(j.id);
        cur.salesSen += salesByJob.get(j.id) ?? 0;
        if (addonJobIds.has(j.id)) cur.addonCount += 1;
        byDay.set(dayKey, cur);
      }

      const daily = [];
      for (const [, day] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const payout = await db.staffPayout.findUnique({
          where: { userId_period_periodStart: { userId: u.id, period: "day", periodStart: day.date } },
          include: { payments: { select: { amountSen: true } } },
        });
        // 无工单且无 payout 的日不展示
        if (day.jobs.length === 0 && !payout) continue;
        // 每单提成（手工覆盖优先，否则按个人算法）→ Σ + 增项奖励 + 手填 bonus
        const jobCommissions = day.jobs.map((jid) => {
          const job = jobs.find((j) => j.id === jid);
          return calcJobCommission(rules, salesByJob.get(jid) ?? 0, job?.commissionSen ?? null);
        });
        const commissionSen = jobCommissions.reduce((s2, c) => s2 + c, 0);
        const addonBonusSen = (rules.addonBonusSen ?? 0) * day.addonCount;
        const bonusSen = payout?.bonusSen ?? 0;
        const totalSen = commissionSen + addonBonusSen + bonusSen;
        daily.push({
          date: day.date,
          jobs: day.jobs.length,
          salesSen: day.salesSen,
          baseSen: 0, commissionSen, addonBonusSen, bonusSen, totalSen,
          payout: payout ? { id: payout.id, status: payout.status, paidSen: payout.payments.reduce((s2, p) => s2 + p.amountSen, 0), paidAt: payout.paidAt } : null,
          jobsList: day.jobs.map((jid, idx) => {
            const det = detailByJob.get(jid);
            const job = jobs.find((j) => j.id === jid);
            return { jobId: jid, jobNumber: job?.jobNumber ?? "", serviceType: job?.packageName ?? job?.customerRequest ?? "", plate: det?.motorcycle.plate ?? "", customer: det?.customer.name ?? "", salesSen: salesByJob.get(jid) ?? 0, commissionSen: jobCommissions[idx] ?? 0 };
          }),
        });
      }
      foremen.push({
        id: u.id, name: u.name,
        totalSen: daily.reduce((s2, dd) => s2 + dd.totalSen, 0),
        totalJobs: daily.reduce((s2, dd) => s2 + dd.jobs, 0),
        totalSalesSen: daily.reduce((s2, dd) => s2 + dd.salesSen, 0),
        daily,
        commissionRules: u.commissionRules ? (() => { try { return JSON.parse(u.commissionRules); } catch { return null; } })() : null,
      });
    }
    foremen.sort((a, b) => b.totalSen - a.totalSen);
    return { start, end, rules: orgRules, foremen };
  }

  /** 发薪历史：全部 StaffPayout（含分期 payment），按发薪时间倒序。 */
  async payoutHistory(branchId?: string | null) {
    const payouts = await db.staffPayout.findMany({
      where: branchId ? { user: { branchId } } : undefined,
      include: { user: { select: { name: true } }, payments: { select: { amountSen: true, method: true, paidAt: true } } },
      orderBy: { paidAt: "desc" },
      take: 200,
    });
    return payouts.map((p) => ({
      id: p.id, name: p.user.name, period: p.period, periodStart: p.periodStart,
      baseSen: p.baseSen, commissionSen: p.commissionSen, addonBonusSen: p.addonBonusSen, totalSen: p.totalSen,
      status: p.status, paidAt: p.paidAt, paidSen: p.payments.reduce((s, x) => s + x.amountSen, 0),
      payments: p.payments.map((x) => ({ amountSen: x.amountSen, method: x.method, paidAt: x.paidAt })),
    }));
  }
}

export const staffService = new StaffService();