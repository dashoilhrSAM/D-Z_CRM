// Tasks module — follow-up tasks against leads/customers/bookings/vehicles.
import { db } from "@/lib/db";

export interface TaskCreateInput {
  organisationId: string;
  branchId?: string | null;
  ownerId?: string | null;
  title: string;
  description?: string | null;
  relatedType?: string | null; // LEAD | CUSTOMER | BOOKING | VEHICLE | JOB
  relatedId?: string | null;
  dueAt?: Date | null;
  priority?: string | null;
}

export const tasksModule = {
  async create(input: TaskCreateInput) {
    // ownerId 是**客户端可传**的字段。不校验的话可以指派给别的组织的员工，
    // 并顺手往那个人的通知栏写一条（下面的 notification.create 用的是同一个 id）。
    if (input.ownerId) {
      const owner = await db.user.findFirst({
        where: { id: input.ownerId, organisationId: input.organisationId },
        select: { id: true },
      });
      if (!owner) throw new Error("TASK_OWNER_NOT_IN_ORG");
    }
    const task = await db.task.create({
      data: {
        organisationId: input.organisationId,
        branchId: input.branchId ?? null,
        ownerId: input.ownerId ?? null,
        title: input.title,
        description: input.description ?? null,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        dueAt: input.dueAt ?? null,
        priority: input.priority ?? "NORMAL",
      },
    });
    // TASK-014: notify the owner of a newly assigned task
    if (input.ownerId) {
      await db.notification.create({
        data: { userId: input.ownerId, branchId: input.branchId ?? null, title: "New task assigned", body: input.title, type: "TASK" },
      });
    }
    return task;
  },

  /** Status: OVERDUE when dueAt < now and not completed (TASK-011). */
  statusOf(task: { status: string; dueAt: Date | null }): "OPEN" | "COMPLETED" | "OVERDUE" | "CANCELLED" {
    if (task.status === "COMPLETED") return "COMPLETED";
    if (task.status === "CANCELLED") return "CANCELLED";
    if (task.status === "OPEN" && task.dueAt && task.dueAt < new Date()) return "OVERDUE";
    return "OPEN";
  },

  async list(opts: { organisationId: string; branchId?: string; ownerId?: string; status?: string; relatedId?: string; search?: string; skip?: number; take?: number }) {
    const where: Record<string, unknown> = { organisationId: opts.organisationId };
    if (opts.branchId) where.branchId = opts.branchId;
    if (opts.ownerId) where.ownerId = opts.ownerId;
    if (opts.relatedId) where.relatedId = opts.relatedId;
    if (opts.search) where.title = { contains: opts.search };
    const raw = await db.task.findMany({
      where,
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
      skip: opts.skip ?? 0,
      take: opts.take ?? 100,
      include: { owner: { select: { id: true, name: true } }, completedBy: { select: { id: true, name: true } } },
    });
    const items = raw.map((t) => ({ ...t, effectiveStatus: this.statusOf(t) }));
    let filtered = items;
    if (opts.status === "OPEN") filtered = items.filter((i) => i.effectiveStatus === "OPEN");
    else if (opts.status === "OVERDUE") filtered = items.filter((i) => i.effectiveStatus === "OVERDUE");
    else if (opts.status === "COMPLETED") filtered = items.filter((i) => i.effectiveStatus === "COMPLETED");
    return { items: filtered, total: filtered.length, rawTotal: items.length };
  },

  /**
   * 状态变更一律带 organisationId：这四个方法原先只按裸 id 更新，
   * 任何登录者拿到一个 id 就能改别的租户的任务（Task 自己有 organisationId，直接用）。
   * 用 updateMany 而不是 update —— update 的 where 只接受唯一键，无法带 org 过滤；
   * 返回 count 让调用方区分"改到了"与"不是你的"。
   */
  async complete(id: string, userId: string, organisationId: string) {
    const res = await db.task.updateMany({
      where: { id, organisationId },
      data: { status: "COMPLETED", completedAt: new Date(), completedById: userId },
    });
    if (res.count === 0) return null;
    return db.task.findFirst({ where: { id, organisationId } });
  },

  async reopen(id: string, organisationId: string) {
    const res = await db.task.updateMany({
      where: { id, organisationId },
      data: { status: "OPEN", completedAt: null, completedById: null },
    });
    return res.count > 0;
  },

  async cancel(id: string, organisationId: string) {
    const res = await db.task.updateMany({ where: { id, organisationId }, data: { status: "CANCELLED" } });
    return res.count > 0;
  },

  async update(id: string, organisationId: string, data: { title?: string; description?: string | null; dueAt?: Date | null; priority?: string; ownerId?: string | null }) {
    // 改派也要落在本组织内（与 create 同一条规则）
    if (data.ownerId) {
      const owner = await db.user.findFirst({ where: { id: data.ownerId, organisationId }, select: { id: true } });
      if (!owner) throw new Error("TASK_OWNER_NOT_IN_ORG");
    }
    const res = await db.task.updateMany({ where: { id, organisationId }, data });
    return res.count > 0;
  },

  /** TASK-016 hook: auto-create follow-up tasks (e.g. after test ride completion). */
  async createFollowUp(input: TaskCreateInput & { source: string; sourceRef: string }) {
    const task = await this.create(input);
    await db.task.update({
      where: { id: task.id },
      data: { description: ((task.description ?? "") + " [auto: " + input.source + " " + input.sourceRef + "]").trim() },
    });
    return task;
  },

  /** PIPE-016: leads with no follow-up scheduled or an overdue one. */
  async staleLeads(organisationId: string, staleDays = 7) {
    const cutoff = new Date(Date.now() - staleDays * 86400000);
    return db.lead.findMany({
      where: {
        organisationId,
        status: "OPEN",
        OR: [
          { nextFollowUpAt: null, updatedAt: { lt: cutoff } },
          { nextFollowUpAt: { lt: new Date() } },
        ],
      },
      include: { source: true, stage: true, assignedUser: { select: { id: true, name: true } } },
      orderBy: { nextFollowUpAt: "asc" },
      take: 50,
    });
  },
};