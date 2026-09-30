"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { scopedBranchId } from "@/lib/branch-scope";

/**
 * 预约时段（AppointmentSlot）的门禁。
 *
 * AppointmentSlot 只有 branchId —— 归属只能经 branch.organisationId 判定。
 * 本文件此前**一行会话检查都没有**：任何已登录员工（甚至任何能构造 Server Action 请求的人）
 * 都能改/删任意组织的时段，generateSlots 更是能往任意 branchId 里写行。
 * 分行级用户额外锁到自己分行（与全站列表口径一致）。
 */
async function requireSlotEditor() {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return null;
  return { session, branchScope: scopedBranchId(session) };
}

export async function generateSlots(input: { branchId: string; days: number; times: string[]; maxBookings: number }) {
  const me = await requireSlotEditor();
  if (!me) return { ok: false, error: "Not signed in" };
  // 分行级用户只能给自己的分行生成时段（org 级可以指定任一本组织分行）
  if (me.branchScope && input.branchId !== me.branchScope) return { ok: false, error: "Branch not found" };
  const branch = await db.branch.findFirst({
    where: { id: input.branchId, organisationId: me.session.orgId },
    select: { id: true },
  });
  if (!branch) return { ok: false, error: "Branch not found" };
  let created = 0;
  for (let d = 0; d < input.days; d++) {
    const date = new Date(Date.now() + d * 86400000);
    date.setHours(0, 0, 0, 0);
    for (const t of input.times) {
      const exists = await db.appointmentSlot.findUnique({
        where: { branchId_date_startTime: { branchId: input.branchId, date, startTime: t } },
      });
      if (!exists) {
        await db.appointmentSlot.create({ data: { branchId: input.branchId, date, startTime: t, maxBookings: input.maxBookings } });
        created++;
      }
    }
  }
  revalidatePath("/", "layout");
  return { ok: true, created };
}

/**
 * 先查后改：AppointmentSlot 没有 organisationId，用 `{ id, branch: { organisationId } }`
 * 关系过滤一次判定存在与归属，跨租户一律返回 "Not found"（不泄漏存在性）。
 * 不能用 update({ where: { id, organisationId } })——Prisma 的 update 只接受唯一键。
 */
async function slotInScope(id: string, organisationId: string, branchScope: string | null) {
  return db.appointmentSlot.findFirst({
    where: { id, branch: { organisationId }, ...(branchScope ? { branchId: branchScope } : {}) },
    select: { id: true },
  });
}

export async function updateSlot(id: string, data: { maxBookings?: number; isHoliday?: boolean }) {
  const me = await requireSlotEditor();
  if (!me) return { ok: false, error: "Not signed in" };
  const slot = await slotInScope(id, me.session.orgId, me.branchScope);
  if (!slot) return { ok: false, error: "Not found" };
  await db.appointmentSlot.update({ where: { id }, data });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteSlot(id: string) {
  const me = await requireSlotEditor();
  if (!me) return { ok: false, error: "Not signed in" };
  const slot = await slotInScope(id, me.session.orgId, me.branchScope);
  if (!slot) return { ok: false, error: "Not found" };
  await db.appointmentSlot.delete({ where: { id } });
  revalidatePath("/", "layout");
  return { ok: true };
}
