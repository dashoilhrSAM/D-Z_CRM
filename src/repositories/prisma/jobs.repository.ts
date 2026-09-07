import type { Prisma, PrismaClient } from "@prisma/client";
import type { DbLike, IJobRepository, JobFull } from "@/modules/service-jobs/repository";
import { db } from "@/lib/db";

const jobInclude = {
  customer: true,
  motorcycle: true,
  mechanic: true,
  items: true,
  parts: { include: { product: true } },
  findings: { include: { approval: true } },
  approvals: true,
  checklist: { include: { items: true } },
  invoice: { include: { items: true, payments: true } },
  booking: true,
  branch: true,
  reminder: true,
  photos: { orderBy: { angle: "asc" } },
  quotation: true,
} satisfies Prisma.ServiceJobInclude;

const rowInclude = {
  customer: true,
  motorcycle: true,
  mechanic: { select: { id: true, name: true } },
  items: true,
  parts: true,
  approvals: { select: { status: true } },
} satisfies Prisma.ServiceJobInclude;

export class PrismaJobRepository implements IJobRepository {
  private c(client?: DbLike): PrismaClient | Prisma.TransactionClient {
    return client ?? db;
  }
  list(where?: Prisma.ServiceJobWhereInput, client?: DbLike) {
    return this.c(client).serviceJob.findMany({ where, include: rowInclude, orderBy: { createdAt: "desc" } });
  }
  getById(id: string, client?: DbLike) {
    return this.c(client).serviceJob.findUnique({ where: { id }, include: jobInclude });
  }
  getByNumber(jobNumber: string, client?: DbLike) {
    return this.c(client).serviceJob.findUnique({ where: { jobNumber }, include: rowInclude });
  }
  create(data: Prisma.ServiceJobUncheckedCreateInput, client?: DbLike) {
    return this.c(client).serviceJob.create({ data, include: jobInclude });
  }
  update(id: string, data: Prisma.ServiceJobUpdateInput, client?: DbLike) {
    return this.c(client).serviceJob.update({ where: { id }, data, include: jobInclude });
  }
  count(client?: DbLike) {
    return this.c(client).serviceJob.count();
  }
  countByStatus(status: import("@prisma/client").JobStatus, client?: DbLike) {
    return this.c(client).serviceJob.count({ where: { status } });
  }
  async nextJobNumber(client?: DbLike) {
    const c = this.c(client);
    const last = await c.serviceJob.findFirst({ orderBy: { jobNumber: "desc" } });
    const base = last ? parseInt(last.jobNumber.replace(/\D/g, ""), 10) : 1023;
    return "DZ" + (isNaN(base) ? 1024 : base + 1);
  }
}