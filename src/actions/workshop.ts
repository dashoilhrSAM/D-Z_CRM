"use server";

import { revalidatePath } from "next/cache";
import { jobService } from "@/modules/service-jobs/service";
import { bookingService } from "@/modules/bookings/service";
import { completionService } from "@/services/completion";
import { inspectionService } from "@/modules/inspections/service";
import { crmService } from "@/modules/crm/service";
import { inventoryService } from "@/modules/inventory/service";
import { quotationService } from "@/modules/quotations/service";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { audit } from "@/lib/auth/audit";
import { scopedBranchId } from "@/lib/branch-scope";
import { createClient } from "@supabase/supabase-js";

export async function createJob(input: {
  customerId: string; motorcycleId: string; mileage: number; customerRequest?: string;
  packageId?: string; mechanicId?: string; type?: "SERVICE" | "REPAIR";
  addons?: { description: string; kind: string; quantity: number; unitPriceSen: number; productId?: string; unitCostSen?: number }[];
  parts?: { productId: string; quantity: number; unitPriceSen: number; unitCostSen?: number }[];
  labour?: { description: string; kind: string; quantity: number; unitPriceSen: number }[];
  bookingId?: string;
}) {
  const org = await db.organisation.findFirst();
  // strict branch isolation: create the job in the current user's branch (org-level falls back to main)
  const session = await getSessionUser();
  const branchScope = scopedBranchId(session);
  const branch = await db.branch.findFirst({ where: { organisationId: org!.id, ...(branchScope ? { id: branchScope } : { isMain: true }) } });
  const branchId = branch!.id;
  // the mechanic must belong to the job's branch (no cross-branch assignment)
  if (input.mechanicId) {
    const mech = await db.user.findUnique({ where: { id: input.mechanicId }, select: { branchId: true } });
    if (mech && mech.branchId && mech.branchId !== branchId) {
      throw new Error("Mechanic belongs to a different branch.");
    }
  }
  const isRepair = input.type === "REPAIR";
  const job = await jobService.create({
    branchId,
    customerId: input.customerId,
    motorcycleId: input.motorcycleId,
    mileage: input.mileage,
    customerRequest: input.customerRequest,
    packageId: isRepair ? undefined : input.packageId,
    mechanicId: input.mechanicId,
    type: isRepair ? "REPAIR" : "SERVICE",
    addons: (isRepair ? input.labour : input.addons)?.map((a) => ({ description: a.description, kind: a.kind, quantity: a.quantity, unitPriceSen: a.unitPriceSen })),
  });
  // repair parts → ServiceJobPart (no package item duplication)
  for (const p of input.parts ?? []) {
    await db.serviceJobPart.create({
      data: { jobId: job.id, productId: p.productId, quantity: p.quantity, unitCostSen: p.unitCostSen ?? 0, unitPriceSen: p.unitPriceSen, lineTotalSen: p.unitPriceSen * p.quantity, status: "ACCEPTED", source: "COUNTER" },
    });
  }
  // accepted parts from recommendations (service addons)
  for (const a of input.addons ?? []) {
    if (a.kind === "PART" && a.productId) {
      await db.serviceJobPart.create({
        data: { jobId: job.id, productId: a.productId, quantity: a.quantity, unitCostSen: a.unitCostSen ?? 0, unitPriceSen: a.unitPriceSen, lineTotalSen: a.unitPriceSen * a.quantity, status: "ACCEPTED", source: "COUNTER" },
      });
    }
  }
  // Model A: 若来自 check-in 的维修 booking，则把新 job 绑定到该 booking（booking.jobId 唯一）
  if (input.bookingId) {
    const booking = await db.booking.findUnique({ where: { id: input.bookingId } });
    if (!booking) throw new Error("Booking not found");
    if (booking.jobId) throw new Error("Booking already has a job");
    if (booking.status !== "CHECKED_IN" && booking.status !== "CONFIRMED" && booking.status !== "REQUESTED") {
      // 允许从 check-in 流继续，其他状态回退为不绑定，避免误绑
    }
    await db.booking.update({ where: { id: input.bookingId }, data: { jobId: job.id } });
    // 同步 job.booking 反向关系（可选：jobService.create 未连 booking，这里统一由 booking.jobId 驱动）
  }
  revalidatePath("/", "layout");
  return { ok: true, id: job.id, jobNumber: job.jobNumber };
}

export async function transitionJob(id: string, to: "WAITING" | "IN_PROGRESS" | "AWAITING_APPROVAL" | "QC_CHECK" | "WAITING_PARTS" | "ON_HOLD" | "READY" | "COMPLETED" | "CANCELLED") {
  if (to === "COMPLETED") {
    const result = await completionService.complete(id);
    revalidatePath("/", "layout");
    return { ok: true, result };
  }
  try {
    await jobService.transition(id, to);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function assignMechanic(id: string, mechanicId: string | null) {
  const before = await db.serviceJob.findUnique({
    where: { id },
    select: { id: true, jobNumber: true, branchId: true, mechanicId: true, type: true },
  });
  // QUOT-001: 维修 job 必须报价已确认；服务 job 若已有报价也必须确认（无报价历史工单不受限）
  if (mechanicId) {
    const q = await db.quotation.findUnique({ where: { jobId: id } });
    const needsQuote = before?.type === "REPAIR" || !!q;
    if (needsQuote && (!q || q.status !== "APPROVED")) return { ok: false, error: "Quotation must be approved by the customer before assigning a mechanic." };
    // strict branch isolation: the mechanic must belong to this job's branch
    if (before?.branchId) {
      const mech = await db.user.findUnique({ where: { id: mechanicId }, select: { branchId: true } });
      if (mech && mech.branchId && mech.branchId !== before.branchId) {
        return { ok: false, error: "Mechanic belongs to a different branch." };
      }
    }
  }
  await jobService.assignMechanic(id, mechanicId);
  // 给被指派技师发一条站内通知（mechanic app alerts feed）
  if (mechanicId && before && before.mechanicId !== mechanicId) {
    await db.notification
      .create({
        data: {
          userId: mechanicId,
          branchId: before.branchId,
          title: "New job assigned",
          body: before.jobNumber + " — service job assigned to you",
          type: "JOB",
          link: "/mechanic-app/jobs/" + before.id,
        },
      })
      .catch(() => {});
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function sendQuotation(jobId: string) {
  const quotation = await quotationService.send(jobId);
  revalidatePath("/", "layout");
  return { ok: true, quotation };
}

export async function bookingAction(id: string, action: "CONFIRMED" | "RESCHEDULED" | "CANCELLED" | "CHECKED_IN" | "NO_SHOW", extra?: { date?: string; timeSlot?: string; mileage?: number; packageId?: string; mechanicId?: string }) {
  if (action === "CHECKED_IN") {
    const org = await db.organisation.findFirst();
    const session = await getSessionUser();
    const branchScope = scopedBranchId(session);
    const branch = await db.branch.findFirst({ where: { organisationId: org!.id, ...(branchScope ? { id: branchScope } : { isMain: true }) } });
    const mileage = extra?.mileage ?? 0;
    if (extra?.mechanicId) {
      const mech = await db.user.findUnique({ where: { id: extra.mechanicId }, select: { branchId: true } });
      if (mech && mech.branchId && mech.branchId !== branch!.id) {
        return { ok: false as const, error: "Mechanic belongs to a different branch." };
      }
    }
    const result = await bookingService.checkIn(id, {
      mileage,
      branchId: branch!.id,
      packageId: extra?.packageId,
      mechanicId: extra?.mechanicId,
    });
    if (!result) {
      return { ok: false as const, error: "Booking not found or already cancelled/completed." };
    }
    await audit({
      organisationId: org!.id,
      branchId: branch!.id,
      action: "CHECKED_IN",
      entity: "BOOKING",
      entityId: id,
      after: { mileage, job: result?.jobNumber ?? null },
    });
    revalidatePath("/", "layout");
    return { ok: true, result };
  }
  await bookingService.transition(id, action, extra ? { date: extra.date ? new Date(extra.date + "T00:00:00Z") : undefined, timeSlot: extra.timeSlot } : undefined);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function acceptRecommendation(jobId: string, kind: "item" | "part", id: string) {
  await jobService.setItemStatus(jobId, kind, id, "ACCEPTED");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function declineRecommendation(jobId: string, kind: "item" | "part", id: string) {
  await jobService.setItemStatus(jobId, kind, id, "DECLINED");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function sendReminder(customerId: string, motorcycleId: string, nextServiceMileage: number) {
  const body = "Hi, your motorcycle may be approaching its next scheduled service.\n\nRecommended: " +
    nextServiceMileage.toLocaleString() + " km\n\nWould you like to make a booking?";
  await crmService.sendMessage({ customerId, body });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function createPurchaseOrder(input: { supplierId: string; items: { productId: string; quantity: number; unitCostSen: number }[] }) {
  const org = await db.organisation.findFirst();
  const session = await getSessionUser();
  const branchScope = scopedBranchId(session);
  const branch = await db.branch.findFirst({ where: { organisationId: org!.id, ...(branchScope ? { id: branchScope } : { isMain: true }) } });
  await inventoryService.createPurchaseOrder({ branchId: branch!.id, supplierId: input.supplierId, items: input.items });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function receivePurchaseOrder(poId: string) {
  const org = await db.organisation.findFirst();
  const session = await getSessionUser();
  const branchScope = scopedBranchId(session);
  const branch = await db.branch.findFirst({ where: { organisationId: org!.id, ...(branchScope ? { id: branchScope } : { isMain: true }) } });
  const result = await inventoryService.receivePurchaseOrder(poId, branch!.id);
  revalidatePath("/", "layout");
  return { ok: true, receivedAt: result.receivedAt };
}

export async function updateJobDetails(input: {
  jobId: string;
  mileage?: number;
  customerRequest?: string;
  mechanicId?: string | null;
}) {
  const job = await db.serviceJob.findUnique({ where: { id: input.jobId }, include: { branch: { select: { id: true, organisationId: true } } } });
  if (!job) return { ok: false, error: "Job not found" };
  const data: Record<string, unknown> = {};
  if (input.mileage !== undefined) data.mileage = input.mileage;
  if (input.customerRequest !== undefined) data.customerRequest = input.customerRequest || null;
  if (input.mechanicId !== undefined) {
    if (input.mechanicId) {
      // strict branch isolation: mechanic must belong to the job's branch
      const mech = await db.user.findUnique({ where: { id: input.mechanicId }, select: { branchId: true } });
      if (mech && mech.branchId && job.branchId && mech.branchId !== job.branchId) {
        return { ok: false, error: "Mechanic belongs to a different branch." };
      }
      data.mechanic = { connect: { id: input.mechanicId } };
    } else data.mechanic = { disconnect: true };
  }
  await db.serviceJob.update({ where: { id: input.jobId }, data });
  // audit: record mileage edits made while editing the job (hardening flow)
  if (input.mileage !== undefined && input.mileage !== job.mileage) {
    await audit({
      organisationId: job.branch.organisationId,
      branchId: job.branch.id,
      action: "JOB_MILEAGE_UPDATE",
      entity: "SERVICE_JOB",
      entityId: input.jobId,
      before: { mileage: job.mileage },
      after: { mileage: input.mileage },
    });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Mileage correction flow (hardening): mechanic/front desk fixes a wrong odometer
 *  reading — updates both the job and the motorcycle record, and writes an
 *  MILEAGE_CORRECTION audit entry with the reason. */
export async function correctMileage(input: { jobId: string; newMileage: number; reason?: string }) {
  const job = await db.serviceJob.findUnique({
    where: { id: input.jobId },
    include: {
      branch: { select: { id: true, organisationId: true } },
      motorcycle: { select: { id: true, currentMileage: true } },
    },
  });
  if (!job) return { ok: false, error: "Job not found" };
  const newMileage = Math.max(0, Math.round(input.newMileage));
  if (newMileage === job.mileage && newMileage === job.motorcycle.currentMileage) return { ok: true, changed: false };
  await db.$transaction([
    db.serviceJob.update({ where: { id: input.jobId }, data: { mileage: newMileage } }),
    db.motorcycle.update({ where: { id: job.motorcycleId }, data: { currentMileage: newMileage } }),
  ]);
  await audit({
    organisationId: job.branch.organisationId,
    branchId: job.branch.id,
    action: "MILEAGE_CORRECTION",
    entity: "SERVICE_JOB",
    entityId: input.jobId,
    before: { jobMileage: job.mileage, bikeMileage: job.motorcycle.currentMileage },
    after: { mileage: newMileage, reason: input.reason?.trim() || null },
  });
  revalidatePath("/", "layout");
  return { ok: true, changed: true };
}

/** Add priced service lines to a job (additional services from the market catalogue). */
export async function addJobServiceItems(input: {
  jobId: string;
  items: { description: string; priceSen: number }[];
}) {
  if (input.items.length === 0) return { ok: true };
  await db.serviceJobItem.createMany({
    data: input.items.map((it) => ({
      jobId: input.jobId,
      description: it.description,
      kind: "SERVICE",
      quantity: 1,
      unitPriceSen: it.priceSen,
      lineTotalSen: it.priceSen,
      status: "INCLUDED",
      source: "COUNTER",
    })),
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Remove a job line (item or part) by id. */
export async function removeJobItem(input: { jobId: string; kind: "item" | "part"; itemId: string }) {
  if (input.kind === "item") await db.serviceJobItem.delete({ where: { id: input.itemId } });
  else await db.serviceJobPart.delete({ where: { id: input.itemId } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function addAiRecommendation(input: {
  jobId: string; kind: "item" | "part"; description: string; quantity: number; unitPriceSen: number;
  productId?: string; unitCostSen?: number;
}) {
  const r = await jobService.addRecommendation({
    jobId: input.jobId, description: input.description, kind: input.kind, quantity: input.quantity,
    unitPriceSen: input.unitPriceSen, productId: input.productId, unitCostSen: input.unitCostSen,
    source: "COUNTER", accept: true,
  });
  revalidatePath("/", "layout");
  return { ok: true, id: (r as { id: string }).id };
}

const STAFF_MANAGER_ROLES = ["SUPER_ADMIN", "OWNER", "HEAD_OFFICE_ADMIN", "MANAGER", "MECHANIC"];

export async function createStaff(input: { name: string; role: string; phone?: string; email?: string; password?: string }) {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user || !STAFF_MANAGER_ROLES.includes(session.role)) throw new Error("No permission to manage staff");
  const org = await db.organisation.findFirst();
  // 分行归属：优先创建者所在分行（branch 级 manager/mechanic 建到本分行）；org 级无分支回退主店
  const branch = (session.branchId ? await db.branch.findUnique({ where: { id: session.branchId } }) : null)
    ?? await db.branch.findFirst({ where: { organisationId: org!.id, isMain: true } });
  // 若提供 email + password：创建 Supabase auth 账号（staff 可登录），并绑定 User.authId。
  let authId: string | null = null;
  const email = (input.email ?? "").trim();
  if (email && input.password && input.password.length >= 6) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: { name: input.name.trim() },
    });
    if (error) throw new Error("Failed to create staff login: " + error.message);
    authId = data.user.id;
  }
  const created = await db.user.create({
    data: {
      organisationId: org!.id,
      branchId: branch?.id,
      name: input.name.trim(),
      role: input.role as never,
      phone: input.phone || null,
      email: input.email || null,
      active: true,
      authId,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true, authCreated: !!authId, authEmail: authId ? email : null, userId: created.id };
}

export async function toggleStaffActive(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { active: true } });
  await db.user.update({ where: { id: userId }, data: { active: !u?.active } });
  revalidatePath("/", "layout");
  return { ok: true, active: !u?.active };
}
export async function updateStaff(userId: string, input: { name?: string; role?: string; phone?: string; email?: string; active?: boolean }) {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user || !STAFF_MANAGER_ROLES.includes(session.role)) throw new Error("No permission to edit staff");
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!u) throw new Error("Staff not found");
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.role !== undefined) data.role = input.role as never;
  if (input.phone !== undefined) data.phone = input.phone || null;
  if (input.email !== undefined) data.email = input.email || null;
  if (input.active !== undefined) data.active = input.active;
  await db.user.update({ where: { id: userId }, data });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** 重置某员工登录密码（用 Supabase admin，仅支持有 authId 的账号）。密码只能重置，不能明文查看（存的是哈希）。 */
export async function resetStaffPassword(userId: string, password: string) {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user || !STAFF_MANAGER_ROLES.includes(session.role)) throw new Error("No permission to reset password");
  if (password.length < 6) throw new Error("Password must be at least 6 characters");
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, authId: true } });
  if (!u) throw new Error("Staff not found");
  if (!u.authId) throw new Error("This staff has no login account yet");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await supabase.auth.admin.updateUserById(u.authId, { password });
  if (error) throw new Error("Failed to reset password: " + error.message);
  revalidatePath("/", "layout");
  return { ok: true };
}
