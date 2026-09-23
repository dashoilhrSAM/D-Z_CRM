import type { CustomerSummary } from "@/types";
import { fmtDate } from "@/lib/format";
import { DEFAULT_SERVICE_INTERVAL_KM } from "@/lib/constants";
import type { ICustomerRepository } from "./repository";
import { PrismaCustomerRepository } from "@/repositories/prisma/customers.repository";

/**
 * CustomerService — computes customer read-models (passport, lists, search).
 * No JSX here; pure business logic (§101).
 */
export class CustomerService {
  constructor(private repo: ICustomerRepository = new PrismaCustomerRepository()) {}

  async listSummaries(): Promise<CustomerSummary[]> {
    const customers = await this.repo.listWith();
    const now = new Date();
    return customers
      .map((c) => {
        const completed = c.jobs.filter((j) => j.status === "COMPLETED");
        const spend = completed.reduce((sum, j) => sum + (j.invoice?.totalSen ?? 0), 0);
        const lastVisit = completed
          .map((j) => j.completedAt ?? j.createdAt)
          .sort((a, b) => b.getTime() - a.getTime())[0];
        const due = c.reminders
          .filter((r) => !r.closedAt)
          .sort((a, b) => a.nextServiceMileage - b.nextServiceMileage)[0];
        const newest = [...c.motorcycles].sort((a, b) => b.currentMileage - a.currentMileage)[0];
        let dueStatus: CustomerSummary["dueStatus"] = "NONE";
        if (due) {
          const gap = (due.nextServiceMileage ?? Number.MAX_SAFE_INTEGER) - (newest?.currentMileage ?? 0);
          dueStatus = gap <= 0 ? "DUE" : gap <= DEFAULT_SERVICE_INTERVAL_KM * 0.5 ? "DUE_SOON" : "UPCOMING";
          if (due.status === "BOOKED" || due.status === "COMPLETED") dueStatus = "BOOKED";
        }
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          joinedAt: c.joinedAt,
          motorcycles: c.motorcycles.map((m) => ({
            id: m.id, brand: m.brand, model: m.model, plate: m.plate, year: m.year, currentMileage: m.currentMileage,
          })),
          lifetimeSpendSen: spend,
          visits: completed.length,
          lastVisitAt: lastVisit ?? null,
          daysSinceVisit: lastVisit ? Math.floor((now.getTime() - lastVisit.getTime()) / 86400000) : null,
          dueStatus,
          nextServiceMileage: due?.nextServiceMileage ?? newest?.nextServiceMileage ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getPassport(customerId: string) {
    const c = await this.repo.getById(customerId);
    if (!c) return null;
    const completed = c.jobs
      .filter((j) => j.status === "COMPLETED")
      .sort((a, b) => (b.completedAt ?? b.createdAt).getTime() - (a.completedAt ?? a.createdAt).getTime());
    const lifetimeSpend = completed.reduce((sum, j) => sum + (j.invoice?.totalSen ?? 0), 0);
    const visits = completed.length;
    const last = completed[0] ?? null;
    const reminder = c.reminders.filter((r) => !r.closedAt).sort((a, b) => a.nextServiceMileage - b.nextServiceMileage)[0] ?? null;
    const oilHistory = completed
      .filter((j) => j.items.some((i) => /oil|minyak/i.test(i.description)))
      .map((j) => ({ at: j.completedAt ?? j.createdAt, mileage: j.mileage }));
    const tyres = completed
      .filter((j) => j.items.some((i) => /tyre|tayar/i.test(i.description)))
      .map((j) => ({ at: j.completedAt ?? j.createdAt, mileage: j.mileage }));
    return {
      // authId 一并带出：客户详情页要据此决定能不能"重置登录密码"（没有登录账号的客户不显示该动作）。
      customer: { id: c.id, name: c.name, phone: c.phone, email: c.email, authId: c.authId, joinedAt: c.joinedAt, notes: c.notes, internalNotes: c.internalNotes, tags: c.tags },
      motorcycles: c.motorcycles,
      stats: {
        visits,
        lifetimeSpend,
        lastServiceDate: last?.completedAt ?? null,
        lastServiceMileage: last?.mileage ?? null,
        nextServiceMileage: reminder?.nextServiceMileage ?? null,
        nextServiceEstDate: reminder?.estimatedDate ?? null,
        lastServiceLabel: last ? fmtDate(last.completedAt ?? last.createdAt) : "—",
      },
      jobs: completed.map((j) => ({
        id: j.id, jobNumber: j.jobNumber, completedAt: j.completedAt ?? j.createdAt, mileage: j.mileage,
        packageName: j.packageName ?? "General Service",
        totalSen: j.invoice?.totalSen ?? 0,
        items: j.items.map((i) => i.description),
        parts: j.parts.map((p) => p.product.name + " ×" + p.quantity),
      })),
      oilHistory,
      tyres,
      messages: c.messages,
      reminders: c.reminders,
    };
  }

  async search(q: string) {
    const rows = await this.repo.search(q);
    return rows.map((c) => ({
      id: c.id, name: c.name, phone: c.phone,
      motorcycles: c.motorcycles.map((m) => ({ id: m.id, brand: m.brand, model: m.model, plate: m.plate, year: m.year, currentMileage: m.currentMileage })),
    }));
  }
}

export const customerService = new CustomerService();
