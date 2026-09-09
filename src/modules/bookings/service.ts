import type { IBookingRepository } from "./repository";
import { PrismaBookingRepository } from "@/repositories/prisma/bookings.repository";
import type { BookingSource, BookingStatus, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { jobService } from "@/modules/service-jobs/service";
import { quotationService } from "@/modules/quotations/service";
import { messagingModule } from "@/modules/messaging/service";
import type { DbLike } from "@/modules/customers/repository";

export type BookingStatusInput = BookingStatus;

export class BookingService {
  constructor(private repo: IBookingRepository = new PrismaBookingRepository()) {}

  async list() {
    const rows = await this.repo.list();
    return rows.map((b) => ({
      id: b.id, status: b.status, source: b.source, serviceType: b.serviceType,
      date: b.date, timeSlot: b.timeSlot, notes: b.notes,
      customer: { id: b.customer.id, name: b.customer.name, phone: b.customer.phone },
      motorcycle: { brand: b.motorcycle.brand, model: b.motorcycle.model, plate: b.motorcycle.plate },
      job: b.job ? { id: b.job.id, jobNumber: b.job.jobNumber, status: b.job.status } : null,
    }));
  }

  async getById(id: string) {
    const b = await this.repo.getById(id);
    if (!b) return null;
    return {
      id: b.id, status: b.status, source: b.source, serviceType: b.serviceType,
      date: b.date, timeSlot: b.timeSlot, notes: b.notes,
      customer: { id: b.customer.id, name: b.customer.name, phone: b.customer.phone },
      motorcycle: { id: b.motorcycle.id, brand: b.motorcycle.brand, model: b.motorcycle.model, plate: b.motorcycle.plate, year: b.motorcycle.year },
      job: b.job,
    };
  }

  /** Create a booking (rider app or counter). BOOK-008/031-035: slot capacity guard. */
  async create(input: {
    branchId: string; customerId: string; motorcycleId: string;
    serviceType: string; date: Date; timeSlot: string; notes?: string; source: BookingSource; campaignId?: string;
    packageId?: string; type?: "SERVICE" | "REPAIR";
    addons?: { description: string; kind: string; quantity: number; unitPriceSen: number }[];
  }) {
    // prevent overbooking: if an AppointmentSlot is configured for this branch/date/time, respect its capacity
    const slot = await db.appointmentSlot.findUnique({
      where: { branchId_date_startTime: { branchId: input.branchId, date: input.date, startTime: input.timeSlot } },
    });
    if (slot && !slot.isHoliday && slot.bookedCount >= slot.maxBookings) {
      throw new Error("SLOT_FULL");
    }
    const created = await this.repo.create({
      branch: { connect: { id: input.branchId } },
      customer: { connect: { id: input.customerId } },
      motorcycle: { connect: { id: input.motorcycleId } },
      serviceType: input.serviceType,
      type: input.type ?? "SERVICE",
      servicePackage: input.packageId ? { connect: { id: input.packageId } } : undefined,
      serviceAddons: input.addons && input.addons.length > 0 ? input.addons as never : undefined,
      date: input.date,
      timeSlot: input.timeSlot,
      notes: input.notes,
      source: input.source,
      campaign: input.campaignId ? { connect: { id: input.campaignId } } : undefined,
    });
    if (slot) {
      await db.appointmentSlot.update({ where: { id: slot.id }, data: { bookedCount: { increment: 1 } } });
    }
    const org = await db.organisation.findFirst();
    if (org) {
      await db.auditLog.create({
        data: { organisationId: org.id, branchId: input.branchId, action: "BOOKING_CREATED", entity: "BOOKING", entityId: String((created as { id: string }).id), after: JSON.stringify({ serviceType: input.serviceType, date: input.date, timeSlot: input.timeSlot }) },
      });
      // AUTO-008: BOOKING_CREATED trigger
      try {
        const { automationModule } = await import("@/modules/automation/service");
        await automationModule.run(org.id, "BOOKING_CREATED", { customerId: input.customerId, dedupeKey: String((created as { id: string }).id), bookingId: (created as { id: string }).id, motorcycleId: input.motorcycleId, relatedType: "BOOKING", relatedId: (created as { id: string }).id, branchId: input.branchId });
      } catch { /* automation must never break booking */ }
    }
    return created;
  }

  /** Workshop booking actions (§20): confirm / reschedule / cancel / check in / no show. */
  async transition(id: string, status: BookingStatusInput, extra?: { date?: Date; timeSlot?: string }) {
    const data: Record<string, unknown> = { status };
    if (extra?.date) data.date = extra.date;
    if (extra?.timeSlot) data.timeSlot = extra.timeSlot;
    const updated = await this.repo.update(id, data as never);
    // BOOK-011..019: confirmation message on CONFIRMED (recorded in Message history)
    if (status === "CONFIRMED") {
      try {
        const booking = await db.booking.findUnique({ where: { id }, include: { customer: true, motorcycle: true, branch: true } });
        if (booking) {
          const body = "Hi " + booking.customer.name + ", your " + booking.serviceType + " booking for " + booking.motorcycle.brand + " " + booking.motorcycle.model + " at " + booking.branch.name + " is confirmed for " + booking.date.toISOString().slice(0, 10) + " " + booking.timeSlot + ". Ref: " + booking.id.slice(-6).toUpperCase();
          await messagingModule.sendDirect({ customerId: booking.customerId, body, referenceType: "BOOKING", referenceId: booking.id, branchId: booking.branchId });
        }
      } catch { /* messaging must never break the transition */ }
    }
    // customer notifications on booking changes (rider feed + workshop center)
    if (status === "RESCHEDULED" || status === "CANCELLED") {
      try {
        const booking = await db.booking.findUnique({ where: { id } });
        if (booking) {
          const when = booking.date.toISOString().slice(0, 10) + " " + booking.timeSlot;
          await db.notification.create({
            data: {
              customerId: booking.customerId,
              branchId: booking.branchId,
              title: status === "CANCELLED" ? "Booking cancelled" : "Booking rescheduled",
              body: status === "CANCELLED"
                ? "Your " + booking.serviceType + " booking on " + when + " was cancelled. Book a new slot anytime."
                : "Your " + booking.serviceType + " booking has been rescheduled to " + when + ".",
              type: status === "CANCELLED" ? "BOOKING_CANCELLED" : "BOOKING_RESCHEDULED",
              link: "/rider/bookings",
            },
          }).catch(() => {});
        }
      } catch { /* notifications must never break the transition */ }
    }
    const org = await db.organisation.findFirst();
    if (org) {
      await db.auditLog.create({
        data: { organisationId: org.id, branchId: null, action: "BOOKING_STATUS_" + status, entity: "BOOKING", entityId: id, after: JSON.stringify({ status }) },
      });
    }
    return updated;
  }

  async stats() {
    const rows = await this.repo.list();
    return {
      requested: rows.filter((r) => r.status === "REQUESTED").length,
      confirmed: rows.filter((r) => r.status === "CONFIRMED").length,
      today: rows.filter((r) => {
        const d = new Date(r.date);
        const n = new Date();
        return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
      }).length,
    };
  }

  /** Check in a booking and create the associated service job (shared workflow). */
  async checkIn(bookingId: string, opts: { mileage: number; branchId: string; packageId?: string; mechanicId?: string; customerRequest?: string }): Promise<{ bookingId: string; jobId: string | null; jobNumber: string | null; type: string; customerId: string; motorcycleId: string } | null> {
    const booking = await this.repo.getById(bookingId);
    if (!booking || booking.status === "CANCELLED" || booking.status === "COMPLETED") return null;
    const type = booking.type ?? "SERVICE";
    if (booking.jobId) {
      await this.repo.update(bookingId, { status: "CHECKED_IN" } as never);
      return { bookingId, jobId: booking.jobId, jobNumber: booking.job?.jobNumber ?? null, type, customerId: booking.customerId, motorcycleId: booking.motorcycleId };
    }
    // Model A: 维修（REPAIR）check-in 不预建 job——仅置 CHECKED_IN，跳 RepairJobForm 现场创建并绑定 booking
    if (type === "REPAIR") {
      await this.repo.update(bookingId, { status: "CHECKED_IN" } as never);
      return { bookingId, jobId: null, jobNumber: null, type: "REPAIR", customerId: booking.customerId, motorcycleId: booking.motorcycleId };
    }
    const res = await db.$transaction(async (tx: DbLike) => {
      const lastJob = await (tx as PrismaClient).serviceJob.findFirst({ orderBy: { jobNumber: "desc" } });
      const base = lastJob ? parseInt(lastJob.jobNumber.replace(/\D/g, ""), 10) : 1023;
      const jobNumber = "DZ" + (isNaN(base) ? 1024 : base + 1);
      // service 内容：counter 可覆盖，缺省用 booking 里 rider 选好的（套餐 + 附加服务）
      const pkgId = opts.packageId ?? booking.servicePackageId ?? undefined;
      const addons = (booking.serviceAddons as { description: string; kind: string; quantity: number; unitPriceSen: number }[] | null) ?? [];
      const job = await (tx as PrismaClient).serviceJob.create({
        data: {
          jobNumber,
          // job 归属 booking 所在 branch（多分支时不能用 main branch 硬绑）
          branchId: opts.branchId ?? booking.branchId,
          customerId: booking.customerId,
          motorcycleId: booking.motorcycleId,
          booking: { connect: { id: booking.id } },
          mileage: opts.mileage,
          customerRequest: opts.customerRequest ?? booking.notes ?? undefined,
          servicePackageId: pkgId,
          mechanicId: opts.mechanicId || undefined,
          type: "SERVICE",
          status: "WAITING",
        },
      });
      // 同步 booking 的 service 内容（rider 选的套餐 + 附加服务）到 job
      await jobService.attachPackage(job.id, pkgId, addons, tx);
      await this.repo.update(bookingId, { status: "CHECKED_IN" } as never, tx);
      return { bookingId, jobId: job.id, jobNumber };
    });
    // QUOT-001: 服务 job 建后自动生成报价单（PENDING）；维修 job 不自动建（counter 加配件/工时后 Send）
    if (res && type === "SERVICE") {
      try { await quotationService.send(res.jobId); } catch (e) { console.error("quotation create failed:", e); }
    }
    if (!res) return null;
    return { ...res, type: "SERVICE", customerId: booking.customerId, motorcycleId: booking.motorcycleId };
  }
}

export const bookingService = new BookingService();
