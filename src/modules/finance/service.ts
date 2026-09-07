import type { DbLike } from "@/modules/customers/repository";
import type { IFinanceRepository } from "./repository";
import { PrismaFinanceRepository } from "@/repositories/prisma/finance.repository";
import { paymentProvider } from "@/providers";
import { periodWindow } from "@/lib/period";

/** FinanceService — revenue / COGS / gross profit / margin (§38). Money in sen. */
export class FinanceService {
  constructor(private repo: IFinanceRepository = new PrismaFinanceRepository()) {}

  private statsOf(invoices: { totalSen: number; paidAt: Date | null; issuedAt: Date }[]) {
    const revenue = invoices.reduce((s, i) => s + i.totalSen, 0);
    return { revenue };
  }

  async dashboard() {
    const invoices = await this.repo.listInvoices();
    const now = new Date();
    const today = invoices.filter((i) => {
      const d = new Date(i.issuedAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    });
    const revenue = today.reduce((s, i) => s + i.totalSen, 0);
    return { revenue, count: today.length };
  }

  /** Revenue, COGS, gross profit, margin, avg ticket for a window. */
  async profitStats(days = 30) {
    const invoices = await this.repo.listInvoices();
    const cutoff = Date.now() - days * 86400000;
    const inWindow = invoices.filter((i) => new Date(i.issuedAt).getTime() >= cutoff && i.status !== "DRAFT");
    const revenue = inWindow.reduce((s, i) => s + i.totalSen, 0);
    const count = inWindow.length;
    // COGS = cost of parts sold; tracked via service job parts. We recompute from jobs below.
    return { revenue, count, avgTicket: count ? Math.round(revenue / count) : 0 };
  }

  /** Full profit read-model: revenue, GP, margin, trends, service vs parts split. */
  async profitDashboard(days = 90) {
    const invoices = await this.repo.listInvoices();
    const cutoff = new Date(Date.now() - days * 86400000);
    const inWindow = invoices.filter((i) => new Date(i.issuedAt) >= cutoff && i.status !== "DRAFT");

    let revenue = 0;
    let cogs = 0;
    const byDay = new Map<string, { revenue: number; cogs: number; count: number }>();
    let serviceRevenue = 0;
    let partsRevenue = 0;

    for (const inv of inWindow) {
      revenue += inv.totalSen;
      for (const item of inv.items) {
        if (item.source === "PART") partsRevenue += item.lineTotalSen;
        else serviceRevenue += item.lineTotalSen;
      }
      // COGS from job parts
      if (inv.jobId) {
        const parts = await this.partCosts(inv.jobId);
        cogs += parts;
      }
      const day = inv.issuedAt.toISOString().slice(0, 10);
      const cur = byDay.get(day) ?? { revenue: 0, cogs: 0, count: 0 };
      cur.revenue += inv.totalSen;
      cur.count += 1;
      byDay.set(day, cur);
    }

    const grossProfit = revenue - cogs;
    const margin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

    const trend = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, v]) => ({ day, revenue: v.revenue, grossProfit: v.revenue - v.cogs }));

    return {
      revenue, grossProfit, margin, avgTicket: inWindow.length ? Math.round(revenue / inWindow.length) : 0,
      count: inWindow.length, serviceRevenue, partsRevenue, trend,
    };
  }

  /** 按业务周期（日/周/月）聚合收支：revenue / cogs / grossProfit / service-parts 拆分。薪资由页面另取 settlement。 */
  async periodDashboard(period: "day" | "week" | "month", ref?: Date, branchId?: string | null) {
    const { start, end } = periodWindow(period, ref);
    const invoices = await this.repo.listInvoices();
    const inWindow = invoices.filter((i) => i.status !== "DRAFT" && (!branchId || i.branchId === branchId) && new Date(i.issuedAt) >= start && new Date(i.issuedAt) < end);

    let revenue = 0;
    let cogs = 0;
    let serviceRevenue = 0;
    let partsRevenue = 0;
    for (const inv of inWindow) {
      revenue += inv.totalSen;
      for (const item of inv.items) {
        if (item.source === "PART") partsRevenue += item.lineTotalSen;
        else serviceRevenue += item.lineTotalSen;
      }
      if (inv.jobId) cogs += await this.partCosts(inv.jobId);
    }
    const grossProfit = revenue - cogs;
    return {
      start, end,
      revenue, cogs, grossProfit,
      margin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
      count: inWindow.length,
      serviceRevenue, partsRevenue,
    };
  }

  private async partCosts(jobId: string) {
    const db = (await import("@/lib/db")).db;
    const parts = await db.serviceJobPart.findMany({ where: { jobId, status: { not: "DECLINED" } } });
    return parts.reduce((s, p) => s + p.unitCostSen * p.quantity, 0);
  }

  async list() {
    const rows = await this.repo.listInvoices();
    return rows.map((i) => ({
      id: i.id, invoiceNumber: i.invoiceNumber, status: i.status, issuedAt: i.issuedAt, paidAt: i.paidAt,
      totalSen: i.totalSen, customer: { id: i.customer.id, name: i.customer.name },
      motorcycle: i.job ? { plate: i.job.motorcycle.plate, model: i.job.motorcycle.model } : null,
    }));
  }
}

export const financeService = new FinanceService();