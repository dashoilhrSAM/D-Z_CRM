"use server";

import { revalidatePath } from "next/cache";
import { generateQrToken } from "@/lib/qr-token";
import { bookingService } from "@/modules/bookings/service";
import { inspectionService } from "@/modules/inspections/service";
import { quotationService } from "@/modules/quotations/service";
import { messagingModule } from "@/modules/messaging/service";
import { db } from "@/lib/db";
import { getRiderCustomer } from "@/lib/rider-customer";
import { audit } from "@/lib/auth/audit";
import { fmtKM } from "@/lib/format";

export async function bookService(input: {
  motorcycleId: string; serviceType: string; date: string; timeSlot: string; notes?: string; campaignId?: string; branchId?: string;
  packageId?: string; type?: "SERVICE" | "REPAIR";
  addons?: { description: string; kind: string; quantity: number; unitPriceSen: number }[];
}) {
  // 顾客身份只能来自会话：旧版从参数里取 customerId，任何人都能替别人（含别的租户的顾客）下单。
  const customer = await getRiderCustomer();
  if (!customer) return { ok: false, error: "Not signed in" };
  const branch = input.branchId
    ? await db.branch.findFirst({ where: { id: input.branchId, organisationId: customer.organisationId } })
    : await db.branch.findFirst({ where: { organisationId: customer.organisationId, isMain: true } });
  if (!branch) return { ok: false, error: "Branch not found" };
  // 车辆必须属于当前顾客（否则可以拿自己的车去挂别人的车 id 下单）
  if (input.motorcycleId) {
    const bike = await db.motorcycle.findFirst({ where: { id: input.motorcycleId, customerId: customer.id }, select: { id: true } });
    if (!bike) return { ok: false, error: "Motorcycle not found" };
  }
  // 促销活动同上：跨租户的 campaignId 不能参与本单定价/归因
  if (input.campaignId) {
    const campaign = await db.campaign.findFirst({ where: { id: input.campaignId, branch: { organisationId: customer.organisationId } }, select: { id: true } });
    if (!campaign) return { ok: false, error: "Campaign not found" };
  }
  await bookingService.create({
    branchId: branch.id,
    customerId: customer.id,
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
  // 身份来自会话，且审批必须挂在本顾客的工单上（CustomerApproval→ServiceJob.customerId）：
  // 旧版把裸 approvalId 直接交给 service，任何人都能批准/拒绝别人（含别的租户）的维修授权。
  const customer = await getRiderCustomer();
  if (!customer) return { ok: false, error: "Not signed in" };
  const approval = await db.customerApproval.findFirst({
    where: { id: approvalId, job: { customerId: customer.id } },
    select: { id: true },
  });
  // 归属不符时按「找不到」返回，不返回 permission denied，避免泄露跨租户 id 是否存在
  if (!approval) return { ok: false, error: "Approval not found" };
  const result = await inspectionService.respondApproval(approval.id, decision);
  revalidatePath("/", "layout");
  return { ok: true, ...result };
}

export async function respondQuotation(quotationId: string, decision: "APPROVED" | "REJECTED") {
  // 同上：Quotation→ServiceJob.customerId 必须是当前顾客，否则任何人可替别人确认/拒绝报价
  // （service 层 respond 只按裸 id 更新，无法表达归属）。
  const customer = await getRiderCustomer();
  if (!customer) return { ok: false, error: "Not signed in" };
  const quotation = await db.quotation.findFirst({
    where: { id: quotationId, job: { customerId: customer.id } },
    select: { id: true },
  });
  if (!quotation) return { ok: false, error: "Quotation not found" };
  await quotationService.respond(quotation.id, decision);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateProfile(input: { name?: string; phone?: string }) {
  // 身份来自会话，不从参数取 customerId：旧版 `update({ where: { id: input.customerId } })`
  // 让任何调用者都能给别的顾客（含别的租户）改名改电话。
  const customer = await getRiderCustomer();
  if (!customer) return { ok: false, error: "Not signed in" };
  await db.customer.update({ where: { id: customer.id }, data: { name: input.name, phone: input.phone } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markNotificationsRead(ids?: string[]) {
  // 2026-09-30（P0）：原来 customerId 由客户端传 —— 任何调用者都能把**别人的**通知标成已读。
  // 顾客身份只能来自会话（与本文件 bookService/updateProfile 同一口径）。
  const customer = await getRiderCustomer();
  if (!customer) return { ok: false, error: "Not signed in" };
  if (ids && ids.length > 0) {
    await db.notification.updateMany({ where: { customerId: customer.id, id: { in: ids } }, data: { readAt: new Date() } });
  } else {
    await db.notification.updateMany({ where: { customerId: customer.id, readAt: null }, data: { readAt: new Date() } });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function submitReview(input: { jobId?: string; rating: number; comment?: string }) {
  // 2026-09-30（P0）：原来 customerId/branchId 都由客户端传 —— 任何调用者都能以别人名义写评价
  // （而且会触发一条发往那个顾客的致谢消息）。顾客身份取会话；门店归属**服务端推导**：
  // 给了 jobId 就用该工单的门店（先证明工单属于本人），否则用顾客自己的门店，再兜底本组织主店
  // —— 自助注册的顾客 branchId 可能是 null，不能因为缺门店就写不进去。
  const customer = await getRiderCustomer();
  if (!customer) return { ok: false, error: "Not signed in" };

  let branchId = customer.branchId;
  let jobId: string | undefined;
  if (input.jobId) {
    const job = await db.serviceJob.findFirst({
      where: { id: input.jobId, customerId: customer.id },
      select: { id: true, branchId: true },
    });
    if (!job) return { ok: false, error: "Job not found" };
    jobId = job.id;
    branchId = job.branchId;
  }
  if (!branchId) {
    const main = await db.branch.findFirst({
      where: { organisationId: customer.organisationId, isMain: true },
      select: { id: true },
    });
    branchId = main?.id ?? null;
  }
  if (!branchId) return { ok: false, error: "No branch for this workshop" };

  await db.review.create({
    data: {
      branchId,
      customerId: customer.id,
      jobId,
      rating: Math.min(5, Math.max(1, Math.round(input.rating))),
      comment: input.comment,
      source: "APP",
      status: "SUBMITTED",
      requestedAt: new Date(),
    },
  });
  // thank-you message after a review (customer appreciation loop)
  try {
    const body = "Thank you " + customer.name.split(" ")[0] + " for your " + Math.min(5, Math.max(1, Math.round(input.rating))) + "★ review! We really appreciate it — see you at the next service. 🏍️";
    await messagingModule.sendDirect({ customerId: customer.id, body, referenceType: "REVIEW" });
  } catch { /* messaging must never break review submission */ }
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
  brand: string;
  model: string;
  year: number;
  type: string;
  color?: string;
  currentMileage: number;
}) {
  // 车主身份只能来自会话：旧版收客户端传的 customerId，任何调用者都能给别的租户的顾客挂车。
  const customer = await getRiderCustomer();
  if (!customer) return { ok: false, error: "Not signed in" };
  await db.motorcycle.create({
    data: {
      qrToken: generateQrToken(),
      // 租户来自车主本人：车辆的 (organisationId, plate) 复合唯一键在 organisationId 为 NULL 时**不生效**，
      // 所以这一列必须写；车主已经过会话校验，用它比自己再查一次组织更可靠。
      organisationId: customer.organisationId,
      customerId: customer.id,
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
  // 车辆必须属于当前顾客：旧版按裸 motorcycleId 读写，任何人能改别人（含别的租户）车辆的里程/资料，
  // 还会用受害者的 organisationId 写审计行。
  const customer = await getRiderCustomer();
  if (!customer) return { ok: false, error: "Not signed in" };
  const bike = await db.motorcycle.findFirst({ where: { id: input.motorcycleId, customerId: customer.id } });
  if (!bike) return { ok: false, error: "Motorcycle not found" };
  const oldMileage = bike.currentMileage;
  await db.motorcycle.update({
    where: { id: bike.id },
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
  if (oldMileage !== input.currentMileage) {
    await audit({
      organisationId: customer.organisationId,
      action: "BIKE_MILEAGE_UPDATE",
      entity: "MOTORCYCLE",
      entityId: bike.id,
      before: { mileage: oldMileage },
      after: { mileage: input.currentMileage },
    });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
