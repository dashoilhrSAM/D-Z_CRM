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

  /**
   * 列表页取数（有界）。压测（2026-09-30）查到：工单列表页与 dashboard 都在用无界的
   * list() —— 7,308 张工单时单请求 100ms、四并发掉到 2.3 req/s（每请求 CPU 放大 20 倍），
   * 并且 dashboard 只是为了拿两个数字就扫了整张工单表（而 dashboard 占全部渲染的 67%）。
   */
  listPage(params: { where?: Prisma.ServiceJobWhereInput; skip?: number; take?: number }, client?: DbLike) {
    return this.c(client).serviceJob.findMany({
      where: params.where,
      include: rowInclude,
      orderBy: { createdAt: "desc" },
      skip: params.skip,
      take: params.take,
    });
  }

  /** 按状态分组计数：一条查询拿到所有列的数字，不取任何行。
   *  注意名字是 countsByStatus（复数）—— 仓库里已有一个 countByStatus(单个状态) 做别的事。 */
  countsByStatus(where?: Prisma.ServiceJobWhereInput, client?: DbLike) {
    return this.c(client).serviceJob.groupBy({ by: ["status"], where, _count: { _all: true } });
  }

  countWhere(where?: Prisma.ServiceJobWhereInput, client?: DbLike) {
    return this.c(client).serviceJob.count({ where });
  }
  getById(id: string, client?: DbLike) {
    return this.c(client).serviceJob.findUnique({ where: { id }, include: jobInclude });
  }
  getByNumber(jobNumber: string, client?: DbLike) {
    // 2026-09-30（P1）：jobNumber 改成租户内唯一，findUnique 不再可用；要精确到某一家店请带 branch.organisationId。
    return this.c(client).serviceJob.findFirst({ where: { jobNumber }, include: rowInclude });
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
  async nextJobNumber(organisationId: string, client?: DbLike) {
    const c = this.c(client);
    // 2026-09-30（P1）：工单号改成租户内唯一，取号范围必须一起收窄 ——
    // 否则一家店的工单量会决定另一家店的号段（号码本身还会泄露别家的业务量）。
    const last = await c.serviceJob.findFirst({ where: { organisationId }, orderBy: { jobNumber: "desc" } });
    const base = last ? parseInt(last.jobNumber.replace(/\D/g, ""), 10) : 1023;
    return "DZ" + (isNaN(base) ? 1024 : base + 1);
  }
}