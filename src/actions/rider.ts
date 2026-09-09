"use server";

import { revalidatePath } from "next/cache";
import { generateQrToken } from "@/lib/qr-token";
import { bookingService } from "@/modules/bookings/service";
import { inspectionService } from "@/modules/inspections/service";
import { quotationService } from "@/modules/quotations/service";
import { messagingModule } from "@/modules/messaging/service";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth/audit";
import { fmtKM } from "@/lib/format";

export async function bookService(input: {
  customerId: string; motorcycleId: string; serviceType: string; date: string; timeSlot: string; notes?: string; campaignId?: string; branchId?: string;
  packageId?: string; type?: "SERVICE" | "REPAIR";
  addons?: { description: string; kind: string; quantity: number; unitPriceSen: number }[];
}) {
  const org = await db.organisation.findFirst();
  const branch = input.branchId
    ? await db.branch.findFirst({ where: { id: input.branchId, organisationId: org!.id } })
    : await db.branch.findFirst({ where: { organisationId: org!.id, isMain: true } });
  await bookingService.create({
    branchId: branch!.id,
    customerId: input.customerId,
    motorcycleId: input.motorcycleId,
    serviceType: input.serviceType,
    packageId: input.packageId,
    type: input.type,
    addons: input.addons,
    // 业务日期：存 UTC 零点（时区无关，显示端 toISOString/fmtDate 一致）
    date: new Date(input.date + "T00:00:00Z"),
    timeSlot: input.timeSlot,
    notes: input.notes,
    source: "RIDER_APP",
    campaignId: input.campaignId,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function respondApproval(approvalId: string, decision: "APPROVED" | "DECLINED") {
  const result = await inspectionService.respondApproval(approvalId, decision);
  revalidatePath("/", "layout");
  return { ok: true, ...result };
}

export async function respondQuotation(quotationId: string, decision: "APPROVED" | "REJECTED") {
  await quotationService.respond(quotationId, decision);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateProfile(input: { customerId: string; name?: string; phone?: string }) {
  await db.customer.update({ where: { id: input.customerId }, data: { name: input.name, phone: input.phone } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markNotificationsRead(customerId: string, ids?: string[]) {
  if (ids && ids.length > 0) {
    await db.notification.updateMany({ where: { customerId, id: { in: ids } }, data: { readAt: new Date() } });
  } else {
    await db.notification.updateMany({ where: { customerId, readAt: null }, data: { readAt: new Date() } });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function submitReview(input: { customerId: string; branchId: string; jobId?: string; rating: number; comment?: string }) {
  const customer = await db.customer.findUnique({ where: { id: input.customerId } });
  await db.review.create({
    data: {
      branchId: input.branchId,
      customerId: input.customerId,
      jobId: input.jobId,
      rating: Math.min(5, Math.max(1, Math.round(input.rating))),
      comment: input.comment,
      source: "APP",
      status: "SUBMITTED",
      requestedAt: new Date(),
    },
  });
  // thank-you message after a review (customer appreciation loop)
  if (customer) {
    try {
      const body = "Thank you " + customer.name.split(" ")[0] + " for your " + Math.min(5, Math.max(1, Math.round(input.rating))) + "★ review! We really appreciate it — see you at the next service. 🏍️";
      await messagingModule.sendDirect({ customerId: input.customerId, body, referenceType: "REVIEW" });
    } catch { /* messaging must never break review submission */ }
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

function makePlate(): string {
  const pre = ["WXY", "JKL", "BQE", "WWW", "VLL", "PRH", "JMR", "JQY", "KFX", "BSS", "WUL", "VKM"];
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  const suffix = "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)] + "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)];
  return pre[Math.floor(Math.random() * pre.length)] + " " + digits + " " + suffix;
}

export async function addMotorcycle(input: {
  customerId: string;
  brand: string;
  model: string;
  year: number;
  type: string;
  color?: string;
  currentMileage: number;
}) {
  await db.motorcycle.create({
    data: {
      qrToken: generateQrToken(),
      customerId: input.customerId,
      brand: input.brand.trim(),
      model: input.model.trim(),
      year: input.year,
      type: input.type,
      color: input.color || null,
      plate: makePlate(),
      currentMileage: input.currentMileage,
      // new bike: next service is 3,000 km out from today's mileage (default interval)
      lastServiceMileage: input.currentMileage,
      nextServiceMileage: input.currentMileage + 3000,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateMotorcycle(input: {
  motorcycleId: string;
  brand: string;
  model: string;
  year: number;
  type: string;
  color?: string;
  currentMileage: number;
}) {
  const bike = await db.motorcycle.findUnique({ where: { id: input.motorcycleId }, include: { customer: { select: { organisationId: true } } } });
  const oldMileage = bike?.currentMileage;
  await db.motorcycle.update({
    where: { id: input.motorcycleId },
    data: {
      brand: input.brand.trim(),
      model: input.model.trim(),
      year: input.year,
      type: input.type,
      color: input.color || null,
      currentMileage: input.currentMileage,
    },
  });
  // audit: rider/owner odometer edit — keeps mileage corrections traceable
  if (bike && oldMileage != null && oldMileage !== input.currentMileage) {
    await audit({
      organisationId: bike.customer.organisationId,
      action: "BIKE_MILEAGE_UPDATE",
      entity: "MOTORCYCLE",
      entityId: input.motorcycleId,
      before: { mileage: oldMileage },
      after: { mileage: input.currentMileage },
    });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
