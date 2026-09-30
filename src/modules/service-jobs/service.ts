import type { DbLike } from "@/modules/customers/repository";
import type { JobStatus, Prisma, PrismaClient } from "@prisma/client";
import type { IJobRepository, JobRow } from "./repository";
import { PrismaJobRepository } from "@/repositories/prisma/jobs.repository";
import { canTransitionJob, type JobStatus as StatusT } from "@/lib/state-machines";
import { db } from "@/lib/db";

export type JobStatusInput = JobStatus;

/** 工单列表/看板的过滤条件（branch 隔离 + 状态 + 机修本人）。 */
function boardWhere(opts: { branchId?: string | null; status?: string; statuses?: string[]; mechanicId?: string; todayOnly?: boolean }): Prisma.ServiceJobWhereInput {
  const where: Prisma.ServiceJobWhereInput = {};
  if (opts.branchId) where.branchId = opts.branchId;
  if (opts.todayOnly) {
    const { start, end } = serverDayRange(new Date());
    where.createdAt = { gte: start, lt: end };
  }
  const statusList = opts.statuses ?? (opts.status ? [opts.status] : []);
  if (statusList.length === 1) where.status = statusList[0] as Prisma.ServiceJobWhereInput["status"];
  else if (statusList.length > 1) where.status = { in: statusList as Prisma.ServiceJobWhereInput["status"][] } as Prisma.ServiceJobWhereInput["status"];
  if (opts.mechanicId) where.mechanicId = opts.mechanicId;
  return where;
}

/**
 * 服务器本地日的起止（与重构前 today() 的判定一致）。
 * 用区间比较而不是「取回来再逐行判断」—— 后者要求先把行读出来，就没法有界了。
 */
function serverDayRange(now: Date): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { start, end: new Date(start.getTime() + 86400000) };
}

/**
 * 柜台加项（attachPackage 的 addons）。productId / serviceTypeId 可选：
 * 旧调用方不传就照旧（那一行按 LEGACY 处理并出现在"无法归因"报告里），
 * 但**能传就必须传**——佣金按 SKU / 服务配置依赖这两个字段。
 */
export interface AddonInput {
  description: string;
  kind: string;
  quantity: number;
  unitPriceSen: number;
  productId?: string | null;
  serviceTypeId?: string | null;
}

export class JobService {
  constructor(private repo: IJobRepository = new PrismaJobRepository()) {}

  canTransition(from: JobStatusInput, to: JobStatusInput): boolean {
    return canTransitionJob(from as JobStatus, to as JobStatus);
  }

  /**
   * 看板/列表的**数字部分**：各状态计数 + 今日新建数。两条查询，不取任何行。
   *
   * 单独拆出来的理由（2026-09-30 压测）：dashboard 原来调 listBoard() 只为拿
   * jobsToday 与计数，却把整张工单表连同明细读进内存 —— 而 dashboard 占全部
   * 渲染的 67%（自动刷新）。数字不该用取全表的代价换。
   */
  async boardSummary(branchId?: string | null, mechanicId?: string): Promise<{ counts: Record<string, number>; jobsToday: number; total: number }> {
    const where = boardWhere({ branchId, mechanicId });
    const { start, end } = serverDayRange(new Date());
    const dayWhere: Prisma.ServiceJobWhereInput = { ...where, createdAt: { gte: start, lt: end } };
    const [byStatus, jobsToday] = await Promise.all([
      this.repo.countsByStatus(where),
      this.repo.countWhere(dayWhere),
    ]);
    const counts: Record<string, number> = { WAITING: 0, IN_PROGRESS: 0, AWAITING_APPROVAL: 0, READY: 0, COMPLETED: 0, CANCELLED: 0 };
    let total = 0;
    for (const row of byStatus) {
      counts[row.status] = row._count._all;
      total += row._count._all;
    }
    return { counts, jobsToday, total };
  }

  /** 表格视图：**有界分页**，状态过滤与分页都在数据库里做（原来是全量取回来再内存过滤切片）。 */
  async listBoardRows(opts: { branchId?: string | null; status?: string; statuses?: string[]; mechanicId?: string; todayOnly?: boolean; page?: number; pageSize?: number }) {
    const pageSize = Math.max(1, opts.pageSize ?? 25);
    const page = Math.max(1, opts.page ?? 1);
    const where = boardWhere(opts);
    const [rows, total] = await Promise.all([
      this.repo.listPage({ where, skip: (page - 1) * pageSize, take: pageSize }),
      this.repo.countWhere(where),
    ]);
    return { jobs: rows.map((j) => this.toBoardRow(j)), total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /**
   * 看板视图：**每一列各取前 N 条**。
   * 原来是先取全量、再在内存里 filter 出每列前 12 条 —— 一列一个全表扫描的代价。
   */
  async listBoardColumns(opts: { branchId?: string | null; mechanicId?: string; perColumn?: number }) {
    const perColumn = Math.max(1, opts.perColumn ?? 12);
    const base = boardWhere(opts);
    const statuses = ["WAITING", "IN_PROGRESS", "AWAITING_APPROVAL", "READY", "COMPLETED"] as const;
    const [columns, summary] = await Promise.all([
      Promise.all(
        statuses.map(async (s) => {
          const rows = await this.repo.listPage({ where: { ...base, status: s }, take: perColumn });
          return [s, rows.map((j) => this.toBoardRow(j))] as const;
        }),
      ),
      this.boardSummary(opts.branchId, opts.mechanicId),
    ]);
    return { columns: Object.fromEntries(columns) as Record<(typeof statuses)[number], ReturnType<JobService["toBoardRow"]>[]>, counts: summary.counts, jobsToday: summary.jobsToday };
  }

  /** 单张工单 → 看板/列表行。算法与重构前逐字一致，只是抽出来给三条路径共用。 */
  private toBoardRow(j: JobRow) {
    const now = new Date();
    const today = (d: Date) => d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const acceptedItems = j.items.filter((i) => i.status !== "DECLINED");
    const acceptedParts = j.parts.filter((p) => p.status !== "DECLINED");
    const totalSen = acceptedItems.reduce((s, i) => s + i.lineTotalSen, 0) + acceptedParts.reduce((s, p) => s + p.lineTotalSen, 0);
    return {
      id: j.id, jobNumber: j.jobNumber, status: j.status, mileage: j.mileage,
      packageName: j.packageName, customerRequest: j.customerRequest,
      customer: { id: j.customer.id, name: j.customer.name, phone: j.customer.phone },
      motorcycle: { brand: j.motorcycle.brand, model: j.motorcycle.model, plate: j.motorcycle.plate, year: j.motorcycle.year },
      mechanic: j.mechanic,
      createdAt: j.createdAt, startedAt: j.startedAt, readyAt: j.readyAt, completedAt: j.completedAt,
      totalSen,
      pendingApprovals: j.approvals.filter((a) => a.status === "PENDING").length,
      isToday: today(j.createdAt),
    };
  }

  async getDetail(id: string) {
    const j = await this.repo.getById(id);
    if (!j) return null;
    const acceptedItems = j.items.filter((i) => i.status !== "DECLINED");
    const acceptedParts = j.parts.filter((p) => p.status !== "DECLINED");
    const totalSen = acceptedItems.reduce((s, i) => s + i.lineTotalSen, 0) + acceptedParts.reduce((s, p) => s + p.lineTotalSen, 0);
    return {
      ...j,
      summary: {
        totalSen,
        itemsSen: acceptedItems.reduce((s, i) => s + i.lineTotalSen, 0),
        partsSen: acceptedParts.reduce((s, p) => s + p.lineTotalSen, 0),
      },
    };
  }

  /** Create a service job (counter flow, §22). Returns the new job id. */
  async create(input: {
    branchId: string; customerId: string; motorcycleId: string; mileage: number;
    customerRequest?: string; packageId?: string; mechanicId?: string; type?: "SERVICE" | "REPAIR";
    addons?: { description: string; kind: string; quantity: number; unitPriceSen: number }[];
  }): Promise<{ id: string; jobNumber: string }> {
    // 工单的租户取自**分行**（Branch.organisationId 是必填的，分行是权威来源），
    // 不接受调用方传值：传错就会写出与分行不一致的工单，而 (organisationId, jobNumber)
    // 复合唯一键只认这一列。分行不存在时**必须报错**，不能放 undefined ——
    // 复合唯一键不约束 organisationId 为 NULL 的行，静默写 NULL 等于唯一性失效。
    const branch = await db.branch.findUnique({ where: { id: input.branchId }, select: { organisationId: true } });
    if (!branch) throw new Error("Cannot create a job: branch not found (" + input.branchId + ")");
    const organisationId = branch.organisationId;
    const jobNumber = await this.repo.nextJobNumber(organisationId);
    const created = await this.repo.create({
      jobNumber,
      organisationId,
      branchId: input.branchId,
      customerId: input.customerId,
      motorcycleId: input.motorcycleId,
      mileage: input.mileage,
      customerRequest: input.customerRequest,
      servicePackageId: input.packageId || undefined,
      mechanicId: input.mechanicId || undefined,
      type: input.type ?? "SERVICE",
      status: "WAITING",
    });
    await this.attachPackage(created.id, input.packageId, input.addons);
    return { id: created.id, jobNumber };
  }

  /** Attach package line items + counter add-ons to a job (INCLUDED). */
  async attachPackage(jobId: string, packageId?: string, addons?: AddonInput[], client?: DbLike) {
    if (client) return this.attachPackageTx(jobId, packageId, addons, client);
    return db.$transaction(async (tx: DbLike) => this.attachPackageTx(jobId, packageId, addons, tx));
  }

  private async attachPackageTx(jobId: string, packageId: string | undefined, addons: AddonInput[] | undefined, tx: DbLike) {
    if (packageId) {
      const pkg = await (tx as PrismaClient).servicePackage.findUnique({ where: { id: packageId }, include: { items: true } });
      if (pkg) {
        // one priced line for the package (§48: "Standard Service RM120")
        await (tx as PrismaClient).serviceJobItem.create({
          // packageId：工单里最大的一笔钱通常是套餐行（不对应任何 SKU/服务），
          // 佣金侧因此需要"套餐"这一档作用域，否则它只能落到默认规则。
          data: { jobId, description: pkg.name, kind: "SERVICE", quantity: 1, unitPriceSen: pkg.priceSen, lineTotalSen: pkg.priceSen, status: "INCLUDED", source: "PACKAGE", packageId: pkg.id },
        });
        // verified component lines (zero price) + packaged parts (for COGS + stock)
        for (const it of pkg.items) {
          if (it.kind === "PART" && it.productId) {
            const prod = await (tx as PrismaClient).product.findUnique({ where: { id: it.productId } });
            await (tx as PrismaClient).serviceJobPart.create({
              data: { jobId, productId: it.productId, quantity: it.defaultQty, unitCostSen: prod?.costPriceSen ?? 0, unitPriceSen: 0, lineTotalSen: 0, status: "INCLUDED", source: "PACKAGE" },
            });
          } else {
            await (tx as PrismaClient).serviceJobItem.create({
              // 组件行若指向某个商品（如机油），就把 productId 记下来——它让"按 SKU 配佣金"能落到这一行。
              data: { jobId, description: it.name, kind: "SERVICE", quantity: it.defaultQty, unitPriceSen: it.priceSen, lineTotalSen: it.priceSen * it.defaultQty, status: "INCLUDED", source: "PACKAGE", productId: it.productId ?? null },
            });
          }
        }
        await (tx as PrismaClient).serviceJob.update({ where: { id: jobId }, data: { packageName: pkg.name } });
      }
    }
    for (const a of addons ?? []) {
      await (tx as PrismaClient).serviceJobItem.create({
        data: { jobId, description: a.description, kind: a.kind, quantity: a.quantity, unitPriceSen: a.unitPriceSen, lineTotalSen: a.unitPriceSen * a.quantity, status: "INCLUDED", source: "COUNTER", productId: a.productId ?? null, serviceTypeId: a.serviceTypeId ?? null },
      });
    }
  }

  /** Add a recommended item/part to the job. Returns RECOMMENDED unless accepted. */
  async addRecommendation(input: {
    jobId: string; description: string; kind: string; quantity: number; unitPriceSen: number; source: "COUNTER" | "APPROVAL" | "MANUAL";
    productId?: string; serviceTypeId?: string; unitCostSen?: number; accept?: boolean;
  }) {
    const status = input.accept ? "ACCEPTED" : "RECOMMENDED";
    if (input.kind.toUpperCase() === "PART" && input.productId) {
      return db.serviceJobPart.create({
        data: {
          jobId: input.jobId, productId: input.productId, quantity: input.quantity,
          unitCostSen: input.unitCostSen ?? 0, unitPriceSen: input.unitPriceSen,
          lineTotalSen: input.unitPriceSen * input.quantity, status, source: input.source,
        },
      });
    }
    return db.serviceJobItem.create({
      data: {
        jobId: input.jobId, description: input.description, kind: input.kind, quantity: input.quantity,
        unitPriceSen: input.unitPriceSen, lineTotalSen: input.unitPriceSen * input.quantity, status, source: input.source,
        // 注意：旧版本只在 PART 分支用了 productId，服务行把它丢掉了——佣金侧因此看不到这条线是什么。
        productId: input.productId ?? null, serviceTypeId: input.serviceTypeId ?? null,
      },
    });
  }

  async setItemStatus(jobId: string, kind: "item" | "part", itemId: string, status: "INCLUDED" | "RECOMMENDED" | "ACCEPTED" | "DECLINED") {
    if (kind === "item") await db.serviceJobItem.update({ where: { id: itemId }, data: { status } });
    else await db.serviceJobPart.update({ where: { id: itemId }, data: { status } });
    return this.getDetail(jobId);
  }

  /** Status transition with business rules (§21). JOB-022/023: every change is timestamped + recorded. */
  async transition(id: string, to: JobStatusInput) {
    const job = await this.repo.getById(id);
    if (!job) throw new Error("Job not found");
    if (job.status === "COMPLETED" || job.status === "CANCELLED") throw new Error("Job is already closed");
    if (!this.canTransition(job.status, to)) throw new Error("Illegal transition " + job.status + " to " + to);
    // SOP-001: pre-service condition photos must be complete before starting service
    if (to === "IN_PROGRESS" && (job.photos?.length ?? 0) < 5) {
      throw new Error("Pre-service photos required — capture all 5 angles (front / back / left / right / meter) before starting service.");
    }
    // QUOT-001: repair jobs (or jobs with a quotation) must be approved before starting service
    if (to === "IN_PROGRESS") {
      const q = await db.quotation.findUnique({ where: { jobId: id } });
      const needsQuote = job.type === "REPAIR" || !!q;
      if (needsQuote && (!q || q.status !== "APPROVED")) throw new Error("Quotation must be approved by the customer before starting service.");
    }
    const data: Prisma.ServiceJobUpdateInput = { status: to };
    if (to === "IN_PROGRESS") {
      data.startedAt = job.startedAt ?? new Date();
      // JOB-016: estimate completion from service duration (package items/type — default 2h)
      if (!job.estimatedCompletionAt) {
        const durationMin = await db.serviceType.findFirst({ where: { name: { contains: (job.packageName ?? "").replace(/ .*/, "") } } }).then((st) => st?.durationMin ?? null).catch(() => null);
        const mins = durationMin ?? 120;
        data.estimatedCompletionAt = new Date(Date.now() + mins * 60000);
      }
    }
    if (to === "READY") data.readyAt = new Date();
    const updated = await this.repo.update(id, data);
    // JOB-022/023: timestamped, user-attributed status history
    await db.jobStatusHistory.create({
      data: { jobId: id, fromStatus: job.status, toStatus: to, changedAt: new Date() },
    });
    // customer status notifications on every state change (rider feed + workshop center)
    const NOTIF: Record<string, { title: string; body: string; type: string }> = {
      IN_PROGRESS: { title: "Service started", body: job.jobNumber + " — work has begun on your motorcycle.", type: "JOB_IN_PROGRESS" },
      AWAITING_APPROVAL: { title: "Approval needed", body: "The mechanic found extra work — please review in the app.", type: "JOB_APPROVAL" },
      QC_CHECK: { title: "QC check in progress", body: job.jobNumber + " — final quality check underway.", type: "JOB_QC" },
      WAITING_PARTS: { title: "Waiting for parts", body: job.jobNumber + " — your motorcycle is waiting for parts to arrive.", type: "JOB_WAITING_PARTS" },
      ON_HOLD: { title: "Job on hold", body: job.jobNumber + " — service has been paused.", type: "JOB_ON_HOLD" },
      READY: { title: "Your motorcycle is ready", body: job.jobNumber + " — ready for collection.", type: "JOB_READY" },
      COMPLETED: { title: "Service completed", body: job.jobNumber + " — thank you for choosing us.", type: "JOB_COMPLETED" },
    };
    const n = NOTIF[to];
    if (n) {
      await db.notification.create({
        data: { customerId: job.customerId, branchId: job.branchId, title: n.title, body: n.body, type: n.type, link: "/rider/service-status" },
      }).catch(() => {});
    }
    if (to === "READY") {
      // JOB-025: ready triggers customer notification (link included above)
      void null;
      // AUTO-012: JOB_READY trigger
      try {
        const { automationModule } = await import("@/modules/automation/service");
        await automationModule.run(job.customer.organisationId, "JOB_READY", { customerId: job.customerId, dedupeKey: id, jobId: id, motorcycleId: job.motorcycleId, relatedType: "JOB", relatedId: id });
      } catch { /* automation must never break transition */ }
    }
    return updated;
  }

  async assignMechanic(id: string, mechanicId: string | null) {
    return this.repo.update(id, { mechanic: mechanicId ? { connect: { id: mechanicId } } : { disconnect: true } });
  }

  async byCustomer(customerId: string) {
    const rows = (await this.repo.list()).filter((j) => j.customerId === customerId);
    return rows.map((j) => ({ id: j.id, jobNumber: j.jobNumber, status: j.status, mileage: j.mileage, packageName: j.packageName, completedAt: j.completedAt, createdAt: j.createdAt }));
  }
}

export const jobService = new JobService();