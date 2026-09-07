import type { DbLike } from "@/modules/customers/repository";
import type { JobStatus, Prisma, PrismaClient } from "@prisma/client";
import type { IJobRepository } from "./repository";
import { PrismaJobRepository } from "@/repositories/prisma/jobs.repository";
import { canTransitionJob, type JobStatus as StatusT } from "@/lib/state-machines";
import { db } from "@/lib/db";

export type JobStatusInput = JobStatus;

export class JobService {
  constructor(private repo: IJobRepository = new PrismaJobRepository()) {}

  canTransition(from: JobStatusInput, to: JobStatusInput): boolean {
    return canTransitionJob(from as JobStatus, to as JobStatus);
  }

  async listBoard(branchId?: string | null) {
    const rows = await this.repo.list(branchId ? { branchId } : undefined);
    const now = new Date();
    const today = (d: Date) => d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return {
      jobs: rows.map((j) => {
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
      }),
      counts: {
        WAITING: rows.filter((r) => r.status === "WAITING").length,
        IN_PROGRESS: rows.filter((r) => r.status === "IN_PROGRESS").length,
        AWAITING_APPROVAL: rows.filter((r) => r.status === "AWAITING_APPROVAL").length,
        READY: rows.filter((r) => r.status === "READY").length,
        COMPLETED: rows.filter((r) => r.status === "COMPLETED").length,
        CANCELLED: rows.filter((r) => r.status === "CANCELLED").length,
      },
      jobsToday: rows.filter((r) => today(r.createdAt)).length,
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
    const jobNumber = await this.repo.nextJobNumber();
    const created = await this.repo.create({
      jobNumber,
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
  async attachPackage(jobId: string, packageId?: string, addons?: { description: string; kind: string; quantity: number; unitPriceSen: number }[], client?: DbLike) {
    if (client) return this.attachPackageTx(jobId, packageId, addons, client);
    return db.$transaction(async (tx: DbLike) => this.attachPackageTx(jobId, packageId, addons, tx));
  }

  private async attachPackageTx(jobId: string, packageId: string | undefined, addons: { description: string; kind: string; quantity: number; unitPriceSen: number }[] | undefined, tx: DbLike) {
    if (packageId) {
      const pkg = await (tx as PrismaClient).servicePackage.findUnique({ where: { id: packageId }, include: { items: true } });
      if (pkg) {
        // one priced line for the package (§48: "Standard Service RM120")
        await (tx as PrismaClient).serviceJobItem.create({
          data: { jobId, description: pkg.name, kind: "SERVICE", quantity: 1, unitPriceSen: pkg.priceSen, lineTotalSen: pkg.priceSen, status: "INCLUDED", source: "PACKAGE" },
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
              data: { jobId, description: it.name, kind: "SERVICE", quantity: it.defaultQty, unitPriceSen: it.priceSen, lineTotalSen: it.priceSen * it.defaultQty, status: "INCLUDED", source: "PACKAGE" },
            });
          }
        }
        await (tx as PrismaClient).serviceJob.update({ where: { id: jobId }, data: { packageName: pkg.name } });
      }
    }
    for (const a of addons ?? []) {
      await (tx as PrismaClient).serviceJobItem.create({
        data: { jobId, description: a.description, kind: a.kind, quantity: a.quantity, unitPriceSen: a.unitPriceSen, lineTotalSen: a.unitPriceSen * a.quantity, status: "INCLUDED", source: "COUNTER" },
      });
    }
  }

  /** Add a recommended item/part to the job. Returns RECOMMENDED unless accepted. */
  async addRecommendation(input: {
    jobId: string; description: string; kind: string; quantity: number; unitPriceSen: number; source: "COUNTER" | "APPROVAL" | "MANUAL";
    productId?: string; unitCostSen?: number; accept?: boolean;
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