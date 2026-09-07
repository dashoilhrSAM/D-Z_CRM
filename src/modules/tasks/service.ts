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

  async complete(id: string, userId: string) {
    const task = await db.task.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: new Date(), completedById: userId },
    });
    return task;
  },

  async reopen(id: string) {
    return db.task.update({ where: { id }, data: { status: "OPEN", completedAt: null, completedById: null } });
  },

  async cancel(id: string) {
    return db.task.update({ where: { id }, data: { status: "CANCELLED" } });
  },

  async update(id: string, data: { title?: string; description?: string | null; dueAt?: Date | null; priority?: string; ownerId?: string | null }) {
    return db.task.update({ where: { id }, data });
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