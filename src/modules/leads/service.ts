// Leads module — CRUD, duplicate detection, assignment, pipeline, conversion.
import { db } from "@/lib/db";

export interface LeadCreateInput {
  organisationId: string;
  branchId?: string | null;
  customerName: string;
  phone?: string | null;
  email?: string | null;
  sourceId?: string | null;
  stageId?: string | null;
  motorcycleInterest?: string | null;
  modelInterest?: string | null;
  notes?: string | null;
  estimatedValueSen?: number | null;
  assignedUserId?: string | null;
  nextFollowUpAt?: Date | null;
  tags?: string | null;
  /** MKT-015: campaign that drove this lead (campaign-link attribution). */
  campaignId?: string | null;
}

export const leadsModule = {
  /** Duplicate detection (LEAD-021/022): same phone or email on another OPEN lead. */
  async findDuplicates(orgId: string, phone?: string | null, email?: string | null, excludeId?: string) {
    if (!phone && !email) return [];
    const or: { phone?: string; email?: string }[] = [];
    if (phone) or.push({ phone });
    if (email) or.push({ email });
    const dupes = await db.lead.findMany({
      where: { organisationId: orgId, OR: or, status: "OPEN", id: excludeId ? { not: excludeId } : undefined },
      select: { id: true, leadNumber: true, customerName: true, phone: true, email: true, createdAt: true },
      take: 5,
    });
    return dupes;
  },

  async nextLeadNumber(): Promise<string> {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const prefix = "LD-" + today + "-";
    const last = await db.lead.findFirst({ where: { leadNumber: { startsWith: prefix } }, orderBy: { leadNumber: "desc" } });
    const seq = last ? parseInt(last.leadNumber.slice(prefix.length), 10) + 1 : 1;
    return prefix + String(seq).padStart(3, "0");
  },

  async create(input: LeadCreateInput) {
    let stageId = input.stageId;
    if (!stageId) {
      const first = await db.leadStage.findFirst({ where: { organisationId: input.organisationId, active: true }, orderBy: { order: "asc" } });
      stageId = first?.id ?? null;
    }
    const leadNumber = await this.nextLeadNumber();
    const lead = await db.lead.create({
      data: {
        leadNumber,
        organisationId: input.organisationId,
        branchId: input.branchId ?? null,
        customerName: input.customerName,
        phone: input.phone ?? null,
        email: input.email ?? null,
        sourceId: input.sourceId ?? null,
        stageId,
        motorcycleInterest: input.motorcycleInterest ?? null,
        modelInterest: input.modelInterest ?? null,
        notes: input.notes ?? null,
        estimatedValueSen: input.estimatedValueSen ?? null,
        assignedUserId: input.assignedUserId ?? null,
        nextFollowUpAt: input.nextFollowUpAt ?? null,
        tags: input.tags ?? null,
        campaignId: input.campaignId ?? null,
      },
    });
    await db.leadActivity.create({ data: { leadId: lead.id, type: "CREATED", note: "Lead created", userId: input.assignedUserId ?? null } });
    // AUTO-006: LEAD_CREATED trigger
    try {
      const { automationModule } = await import("@/modules/automation/service");
      await automationModule.run(input.organisationId, "LEAD_CREATED", { leadId: lead.id, dedupeKey: lead.id, assignedUserId: input.assignedUserId, relatedType: "LEAD", relatedId: lead.id });
    } catch { /* automation must never break lead creation */ }
    return lead;
  },

  async list(opts: {
    organisationId: string;
    branchId?: string;
    sourceId?: string;
    stageId?: string;
    assignedUserId?: string;
    status?: string;
    search?: string;
    skip?: number;
    take?: number;
  }) {
    const where: Record<string, unknown> = { organisationId: opts.organisationId };
    if (opts.branchId) where.branchId = opts.branchId;
    if (opts.sourceId) where.sourceId = opts.sourceId;
    if (opts.stageId) where.stageId = opts.stageId;
    if (opts.assignedUserId) where.assignedUserId = opts.assignedUserId;
    if (opts.status) where.status = opts.status;
    if (opts.search) {
      where.OR = [
        { customerName: { contains: opts.search } },
        { phone: { contains: opts.search } },
        { email: { contains: opts.search } },
        { leadNumber: { contains: opts.search } },
      ];
    }
    const [items, total] = await Promise.all([
      db.lead.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: opts.skip ?? 0,
        take: opts.take ?? 50,
        include: { source: true, stage: true, assignedUser: { select: { id: true, name: true } } },
      }),
      db.lead.count({ where }),
    ]);
    return { items, total };
  },

  async get(id: string) {
    return db.lead.findUnique({
      where: { id },
      include: {
        source: true,
        stage: true,
        assignedUser: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true, city: true } },
        convertedCustomer: { select: { id: true, name: true } },
        activities: { orderBy: { createdAt: "desc" }, take: 50 },
        testRides: { orderBy: { rideDate: "desc" }, take: 10 },
      },
    });
  },

  async update(id: string, data: Partial<LeadCreateInput> & { lostReason?: string | null }) {
    const before = await db.lead.findUnique({ where: { id } });
    if (!before) throw new Error("LEAD_NOT_FOUND");
    const updated = await db.lead.update({
      where: { id },
      data: {
        customerName: data.customerName ?? undefined,
        phone: data.phone ?? undefined,
        email: data.email ?? undefined,
        sourceId: data.sourceId ?? undefined,
        stageId: data.stageId ?? undefined,
        motorcycleInterest: data.motorcycleInterest ?? undefined,
        modelInterest: data.modelInterest ?? undefined,
        notes: data.notes ?? undefined,
        estimatedValueSen: data.estimatedValueSen ?? undefined,
        assignedUserId: data.assignedUserId ?? undefined,
        nextFollowUpAt: data.nextFollowUpAt ?? undefined,
        tags: data.tags ?? undefined,
        lostReason: data.lostReason ?? undefined,
      },
    });
    if (data.stageId && data.stageId !== before.stageId) {
      await db.leadActivity.create({ data: { leadId: id, type: "STAGE_CHANGED", note: "Stage changed", userId: data.assignedUserId ?? null } });
    }
    if (data.assignedUserId && data.assignedUserId !== before.assignedUserId) {
      await db.leadActivity.create({ data: { leadId: id, type: "ASSIGNED", note: "Lead reassigned", userId: data.assignedUserId } });
      // NOTIF-002: notify the newly assigned salesperson
      await db.notification.create({
        data: { userId: data.assignedUserId, branchId: before.branchId, title: "New lead assigned", body: before.customerName + " (" + before.leadNumber + ")", type: "LEAD" },
      });
    }
    return updated;
  },

  async addActivity(id: string, type: string, note: string, userId?: string | null) {
    return db.leadActivity.create({ data: { leadId: id, type, note, userId: userId ?? null } });
  },

  /** Closed Won -> customer record without duplicate data entry (PIPE-020). */
  async convertToCustomer(id: string, opts: { branchId: string; customerId?: string }) {
    const lead = await db.lead.findUnique({ where: { id } });
    if (!lead) throw new Error("LEAD_NOT_FOUND");
    let customerId = opts.customerId;
    if (!customerId) {
      const customer = await db.customer.create({
        data: {
          organisationId: lead.organisationId,
          branchId: opts.branchId,
          name: lead.customerName,
          phone: lead.phone,
          email: lead.email,
          source: lead.sourceId ?? "Website",
          notes: lead.notes,
        },
      });
      customerId = customer.id;
    }
    await db.lead.update({
      where: { id },
      data: { status: "WON", convertedCustomerId: customerId, stageId: null },
    });
    await db.leadActivity.create({ data: { leadId: id, type: "WON", note: "Converted to customer", userId: null } });
    return customerId;
  },

  async markLost(id: string, reason: string) {
    await db.lead.update({ where: { id }, data: { status: "LOST", lostReason: reason, stageId: null } });
    await db.leadActivity.create({ data: { leadId: id, type: "LOST", note: "Closed lost: " + reason, userId: null } });
  },
};
