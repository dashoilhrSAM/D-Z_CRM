"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { getSessionUser } from "@/lib/session-user";
import { isOrgLevelRole, canManageOrgSettings } from "@/lib/branch-scope";
import { audit } from "@/lib/auth/audit";
import { isValidLatLng } from "@/lib/geo";

/**
 * 两个标志是**两条不同的轴**，别合并（2026-09-17）：
 *  · `orgLevel`  = 数据范围：能不能动**别的分店**
 *  · `backOffice` = 功能开关：能不能用总部级后台功能（组织资料/考勤政策/服务目录）
 * MANAGER 有 backOffice、没有 orgLevel——owner 要的是「后台功能跟 owner 一样，数据仍限本店」。
 */
async function requireStaff(): Promise<{ ok: true; orgLevel: boolean; backOffice: boolean; branchId: string | null } | { ok: false; error: string }> {
  const session = await getSessionUser();
  if (session.kind !== "staff") return { ok: false, error: "Not authorized." };
  return {
    ok: true,
    orgLevel: isOrgLevelRole(session.role),
    backOffice: canManageOrgSettings(session.role),
    branchId: session.branchId,
  };
}

/** 后台管理者（org 级 + MANAGER）可改组织资料。 */
export async function updateOrganisation(input: { name?: string; contactPhone?: string | null; contactEmail?: string | null; address?: string | null; taxId?: string | null; timezone?: string; currency?: string; lostReasons?: string }) {
  const auth = await requireStaff();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  if (!auth.backOffice) return { ok: false as const, error: "Only the owner can edit company details." };
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
export async function updateBranch(id: string, input: { name?: string; city?: string; phone?: string; address?: string; operatingHours?: string; appointmentCapacity?: number; latitude?: number | null; longitude?: number | null }) {
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

  // HRM: 门店坐标决定考勤「算不算在店里」，所以它是要留痕的改动，不是普通字段
  // （老板把围栏悄悄挪一下，就能让所有人的越界记录变成正常）。
  const current = await db.branch.findUnique({ where: { id }, select: { latitude: true, longitude: true } });
  let geofenceChange: { before: { latitude: number | null; longitude: number | null }; after: { latitude: number | null; longitude: number | null } } | null = null;
  if (input.latitude !== undefined || input.longitude !== undefined) {
    const lat = input.latitude ?? null;
    const lng = input.longitude ?? null;
    if ((lat === null) !== (lng === null)) return { ok: false as const, error: "Latitude and longitude must be set together." };
    if (lat !== null && lng !== null && !isValidLatLng(lat, lng)) return { ok: false as const, error: "Those coordinates are not a valid location." };
    data.latitude = lat;
    data.longitude = lng;
    // 只在坐标**真的变了**时留痕：否则每次编辑分行都会多一条审计，把真正的改动淹掉
    const before = { latitude: current?.latitude ?? null, longitude: current?.longitude ?? null };
    if (before.latitude !== lat || before.longitude !== lng) geofenceChange = { before, after: { latitude: lat, longitude: lng } };
  }

  await db.branch.update({ where: { id }, data });
  if (geofenceChange) {
    const session = await getSessionUser();
    const org = await db.organisation.findFirst();
    if (org) {
      await audit({
        organisationId: org.id,
        branchId: id,
        userId: session.user?.id ?? null,
        action: "ATTENDANCE_GEOFENCE_SET",
        entity: "Branch",
        entityId: id,
        before: geofenceChange.before,
        after: geofenceChange.after,
      });
    }
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * 考勤政策（HRM）：拍照/定位是否必填、围栏半径、精度上限。
 * 营收与合规相关，所以按项目惯例**存 DB 由业务方决定**，不写源码常量（先例 promoAutoApply）。
 * 只有 org 级角色能改——这些值对所有门店生效。
 */
export async function updateAttendancePolicy(input: { photoRequired?: boolean; geoRequired?: boolean; geofenceM?: number; accuracyMaxM?: number }) {
  const auth = await requireStaff();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  if (!auth.backOffice) return { ok: false as const, error: "Only the owner can change attendance policy." };
  const org = await db.organisation.findFirst();
  if (!org) return { ok: false as const, error: "No organisation" };

  // 夹到合理区间：围栏 10–5000 米、精度上限 5–2000 米。
  // 允许 0 或负数会让"在店里"这个判断失去意义（人人越界或人人正常）。
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
  const data: Record<string, boolean | number> = {};
  if (input.photoRequired != null) data.attendancePhotoRequired = input.photoRequired;
  if (input.geoRequired != null) data.attendanceGeoRequired = input.geoRequired;
  if (input.geofenceM != null) data.attendanceGeofenceM = clamp(input.geofenceM, 10, 5000);
  if (input.accuracyMaxM != null) data.attendanceAccuracyMaxM = clamp(input.accuracyMaxM, 5, 2000);
  if (Object.keys(data).length === 0) return { ok: true as const };

  const before = {
    attendancePhotoRequired: org.attendancePhotoRequired,
    attendanceGeoRequired: org.attendanceGeoRequired,
    attendanceGeofenceM: org.attendanceGeofenceM,
    attendanceAccuracyMaxM: org.attendanceAccuracyMaxM,
  };
  await db.organisation.update({ where: { id: org.id }, data });
  await audit({
    organisationId: org.id,
    branchId: null,
    userId: null,
    action: "ATTENDANCE_POLICY",
    entity: "Organisation",
    entityId: org.id,
    before,
    after: data,
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
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
  if (!auth.backOffice) return { ok: false as const, error: "Only the owner can manage service catalogue." };
  const org = await db.organisation.findFirst();
  await db.serviceType.create({ data: { organisationId: org!.id, name: input.name, category: input.category ?? null, durationMin: input.durationMin ?? null, priceSen: input.priceSen ?? null } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Edit a service type.
 *
 * WHY THIS WAS MISSING AND WHY IT MATTERS: create/toggle/delete existed, so a service
 * could be created but never corrected. In production all eight services had a null price
 * and there was no way to set one through the UI — which quietly disabled the content
 * engine's ability to quote a price, because it will not invent one. A catalogue you can
 * only append to is a catalogue that keeps its mistakes forever.
 */
export async function updateServiceType(input: {
  id: string;
  name?: string;
  category?: string | null;
  durationMin?: number | null;
  /** null clears the price; undefined leaves it alone. */
  priceSen?: number | null;
}) {
  const auth = await requireStaff();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  if (!auth.backOffice) return { ok: false as const, error: "Only the owner can manage service catalogue." };

  const name = input.name?.trim();
  if (input.name !== undefined && !name) return { ok: false as const, error: "A service needs a name." };
  if (input.priceSen != null && (!Number.isFinite(input.priceSen) || input.priceSen < 0)) {
    return { ok: false as const, error: "A price cannot be negative." };
  }

  await db.serviceType.update({
    where: { id: input.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
      ...(input.priceSen !== undefined ? { priceSen: input.priceSen } : {}),
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function toggleServiceType(id: string, active: boolean) {
  const auth = await requireStaff();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  if (!auth.backOffice) return { ok: false as const, error: "Only the owner can manage service catalogue." };
  await db.serviceType.update({ where: { id }, data: { active } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** 删除一个服务类型。若已被工单/历史引用，关联字段会置空（或需先停用）。 */
export async function deleteServiceType(id: string) {
  const auth = await requireStaff();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  if (!auth.backOffice) return { ok: false as const, error: "Only the owner can manage service catalogue." };
  await db.serviceType.delete({ where: { id } });
  revalidatePath("/", "layout");
  return { ok: true };
}