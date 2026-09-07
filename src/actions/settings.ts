"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { getSessionUser } from "@/lib/session-user";
import { isOrgLevelRole } from "@/lib/branch-scope";

async function requireStaff(): Promise<{ ok: true; orgLevel: boolean; branchId: string | null } | { ok: false; error: string }> {
  const session = await getSessionUser();
  if (session.kind !== "staff") return { ok: false, error: "Not authorized." };
  return { ok: true, orgLevel: isOrgLevelRole(session.role), branchId: session.branchId };
}

/** 仅 org 级（OWNER/SUPER_ADMIN/HEAD_OFFICE_ADMIN）可改组织资料。 */
export async function updateOrganisation(input: { name?: string; contactPhone?: string | null; contactEmail?: string | null; address?: string | null; taxId?: string | null; timezone?: string; currency?: string; lostReasons?: string }) {
  const auth = await requireStaff();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  if (!auth.orgLevel) return { ok: false as const, error: "Only the owner can edit company details." };
  const org = await db.organisation.findFirst();
  if (!org) return { ok: false as const, error: "No organisation" };
  await db.organisation.update({ where: { id: org.id }, data: { ...input, contactPhone: input.contactPhone ?? null, contactEmail: input.contactEmail ?? null, address: input.address ?? null, taxId: input.taxId ?? null } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * 编辑分行设置（严格 scope）：
 * - org 级：可改任意分行（含 name/city/isMain 由 owner 管理）；
 * - branch 级：只能改 **自己** 分行，且仅运营细节（phone/address/operatingHours/appointmentCapacity），name/city 不可改。
 */
export async function updateBranch(id: string, input: { name?: string; city?: string; phone?: string; address?: string; operatingHours?: string; appointmentCapacity?: number }) {
  const auth = await requireStaff();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  if (!auth.orgLevel && auth.branchId !== id) return { ok: false as const, error: "You can only edit your own branch." };

  const data: Prisma.BranchUpdateInput = {};
  if (auth.orgLevel && input.name != null) data.name = input.name;
  if (auth.orgLevel && input.city != null) data.city = input.city;
  if (input.phone != null) data.phone = input.phone;
  if (input.address != null) data.address = input.address;
  if (input.operatingHours != null) data.operatingHours = input.operatingHours;
  if (input.appointmentCapacity != null) data.appointmentCapacity = input.appointmentCapacity;

  await db.branch.update({ where: { id }, data });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** 仅 org 级可新增分行。 */
export async function createBranch(input: { name: string; city: string; phone?: string; address?: string }) {
  const auth = await requireStaff();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  if (!auth.orgLevel) return { ok: false as const, error: "Only the owner can add branches." };
  const org = await db.organisation.findFirst();
  await db.branch.create({ data: { organisationId: org!.id, name: input.name, city: input.city, phone: input.phone ?? null, address: input.address ?? null } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** 仅 org 级可管理服务类型（org 级配置，共享）。 */
export async function createServiceType(input: { name: string; category?: string; durationMin?: number; priceSen?: number }) {
  const auth = await requireStaff();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  if (!auth.orgLevel) return { ok: false as const, error: "Only the owner can manage service catalogue." };
  const org = await db.organisation.findFirst();
  await db.serviceType.create({ data: { organisationId: org!.id, name: input.name, category: input.category ?? null, durationMin: input.durationMin ?? null, priceSen: input.priceSen ?? null } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function toggleServiceType(id: string, active: boolean) {
  const auth = await requireStaff();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  if (!auth.orgLevel) return { ok: false as const, error: "Only the owner can manage service catalogue." };
  await db.serviceType.update({ where: { id }, data: { active } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** 删除一个服务类型。若已被工单/历史引用，关联字段会置空（或需先停用）。 */
export async function deleteServiceType(id: string) {
  const auth = await requireStaff();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  if (!auth.orgLevel) return { ok: false as const, error: "Only the owner can manage service catalogue." };
  await db.serviceType.delete({ where: { id } });
  revalidatePath("/", "layout");
  return { ok: true };
}