"use server";

import { cookies, headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/session-user";
import { MODULES, defaultAllowed, type PermissionAction } from "@/lib/auth/permissions";
import { BUSINESS_DATA_DELETE_ORDER, accessorFor } from "@/lib/tenant/business-data-scope";

/** Developer Settings 门禁 cookie（HttpOnly，15 分钟）。 */
const DEV_COOKIE = "dz_dev";
const DEV_TTL_SECONDS = 15 * 60;

async function assertOwner(): Promise<{ userId: string; email: string; orgId: string } | { error: string }> {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return { error: "Not authenticated." };
  if (session.role !== "OWNER" && session.role !== "SUPER_ADMIN") return { error: "Owner access required." };
  return { userId: session.user.id, email: session.user.email ?? "", orgId: session.orgId };
}

/** 验证 Owner 密码 → 种 15 分钟门禁 cookie（sudo 式）。 */
export async function verifyDeveloperPassword(password: string) {
  const who = await assertOwner();
  if ("error" in who) return { ok: false as const, error: who.error };
  if (!who.email) return { ok: false as const, error: "No email on account." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: who.email, password });
  if (error) return { ok: false as const, error: "Incorrect password." };
  const store = await cookies();
  const reqHeaders = await headers();
  // secure 按实际协议：生产 https（x-forwarded-proto）才设，本地 http（含局域网 IP）不设——否则 Secure cookie 在 http 下被浏览器拒绝导致解锁无反应
  const isHttps = reqHeaders.get("x-forwarded-proto") === "https";
  store.set(DEV_COOKIE, randomUUID(), { httpOnly: true, sameSite: "lax", secure: isHttps, path: "/", maxAge: DEV_TTL_SECONDS });
  return { ok: true as const };
}

/** 退出 Developer 门禁。 */
export async function clearDeveloperSession() {
  const store = await cookies();
  store.delete(DEV_COOKIE);
  return { ok: true as const };
}

export async function hasDeveloperAccess(): Promise<boolean> {
  const store = await cookies();
  return !!store.get(DEV_COOKIE)?.value;
}

/**
 * 角色 × 模块 访问开关（仅 view 权限）。
 * enabled=true：显式允许（默认不允许时写 canView:true；默认允许则删行回默认）
 * enabled=false：显式禁止（写 canView:false）
 */
export async function setModuleAccess(role: string, module: string, enabled: boolean) {
  const who = await assertOwner();
  if ("error" in who) return { ok: false as const, error: who.error };
  if (!(MODULES as readonly string[]).includes(module)) return { ok: false as const, error: "Unknown module: " + module };

  const existing = await db.permission.findUnique({
    where: { organisationId_roleName_module: { organisationId: who.orgId, roleName: role, module } },
  });
  const defaultView = defaultAllowed(role, module, "view" as PermissionAction);

  if (enabled) {
    if (defaultView) {
      // 默认允许 → 删行回默认
      if (existing) await db.permission.delete({ where: { id: existing.id } });
    } else {
      // 默认不允许 → 显式允许
      if (!existing || !existing.canView) {
        await db.permission.upsert({
          where: { organisationId_roleName_module: { organisationId: who.orgId, roleName: role, module } },
          create: { organisationId: who.orgId, roleName: role, module, canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false, scope: "BRANCH" },
          update: { canView: true },
        });
      }
    }
  } else {
    // 显式禁止
    await db.permission.upsert({
      where: { organisationId_roleName_module: { organisationId: who.orgId, roleName: role, module } },
      create: { organisationId: who.orgId, roleName: role, module, canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false, scope: "BRANCH" },
      update: { canView: false },
    });
  }
  await db.auditLog.create({ data: { organisationId: who.orgId, userId: who.userId, action: "PERMISSION_TOGGLE", entity: "Permission", entityId: module, after: role + " " + module + " → " + (enabled ? "on" : "off") } });
  return { ok: true as const };
}

/** 重置某角色×模块 为默认（删覆盖行）。 */
export async function resetModuleAccess(role: string, module: string) {
  const who = await assertOwner();
  if ("error" in who) return { ok: false as const, error: who.error };
  await db.permission.deleteMany({ where: { organisationId: who.orgId, roleName: role, module } });
  return { ok: true as const };
}

/** 一键第一波开放（docs/ONBOARDING_PLAN.md §2.1）：对全部角色关闭进阶模块。 */
export async function applyFirstWavePreset() {
  const who = await assertOwner();
  if ("error" in who) return { ok: false as const, error: who.error };
  const FIRST_WAVE_OPEN = new Set([
    "DASHBOARD", "CUSTOMERS", "MOTORCYCLES", "BOOKINGS", "WORKSHOP", "JOB_CARDS",
    "REMINDERS", "SETTINGS", "USERS", "FINANCE", "TECHNICIANS", "PARTS", "INVENTORY",
  ]);
  const roles = (await db.user.findMany({ where: { organisationId: who.orgId }, select: { role: true }, distinct: ["role"] })).map((u) => u.role as string);
  const closed = (MODULES as readonly string[]).filter((m) => !FIRST_WAVE_OPEN.has(m));
  let n = 0;
  for (const role of roles) {
    for (const mod of closed) {
      await db.permission.upsert({
        where: { organisationId_roleName_module: { organisationId: who.orgId, roleName: role, module: mod } },
        create: { organisationId: who.orgId, roleName: role, module: mod, canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false, scope: "BRANCH" },
        update: { canView: false },
      });
      n++;
    }
  }
  await db.auditLog.create({ data: { organisationId: who.orgId, userId: who.userId, action: "PERMISSION_PRESET", entity: "Permission", entityId: "first-wave", after: "applied first-wave preset (" + n + " rows)" } });
  return { ok: true as const, rows: n };
}

/* ---- 数据管理：清空业务数据（保留配置：org/branch/user/服务目录/套餐/时段/产品/权限等） ---- */

/**
 * 清空本租户的全部业务数据（事务；保留 Organisation/Branch/User/配置表）。返回各表删除数。
 *
 * 2026-09-30 多租户修正（P0）：原实现对 40 张表 `deleteMany({})` —— **没有任何租户收窄**。
 * 单租户时看不出来；库里有第二家门店后，任何一家的 owner 点一下这个按钮，
 * **所有租户的业务数据一起被删**，且审计行只记录了操作者自己的 orgId，事后无法界定范围。
 *
 * 现在每张表的收窄条件由 `lib/tenant/business-data-scope.ts` 唯一定义
 * （删除顺序与作用域写在同一处，避免"加了表忘了加作用域"的漂移），
 * 并由 `tests/business-data-scope.test.ts` 断言"没有任何一项退化成空条件"。
 */
export async function resetBusinessData() {
  const who = await assertOwner();
  if ("error" in who) return { ok: false as const, error: who.error };
  const counts: Record<string, number> = {};
  await db.$transaction(async (tx) => {
    const deleter = tx as unknown as Record<string, { deleteMany: (args: unknown) => Promise<{ count: number }> }>;
    for (const table of BUSINESS_DATA_DELETE_ORDER) {
      const r = await deleter[accessorFor(table.model)].deleteMany({ where: table.where(who.orgId) });
      counts[table.model] = r.count;
    }
  });
  await db.auditLog.create({
    data: {
      organisationId: who.orgId,
      userId: who.userId,
      action: "DATA_RESET",
      entity: "BusinessData",
      entityId: who.orgId,
      after: "cleared business data for organisation " + who.orgId + " (" + JSON.stringify(counts) + ")",
    },
  });
  return { ok: true as const, counts };
}

/** 数据概览（Developer Settings 顶部显示）。 */
export async function getDeveloperOverview() {
  const who = await assertOwner();
  if ("error" in who) return { ok: false as const, error: who.error };
  const scope = { organisationId: who.orgId };
  const [customers, motorcycles, jobs, bookings, invoices, reminders, products, users] = await Promise.all([
    db.customer.count({ where: scope }),
    // 下列模型没有 organisationId，经关系收窄（与 business-data-scope 同一套路径）。
    db.motorcycle.count({ where: { customer: scope } }),
    db.serviceJob.count({ where: { branch: scope } }),
    db.booking.count({ where: { branch: scope } }),
    db.invoice.count({ where: { branch: scope } }),
    db.serviceReminder.count({ where: { customer: scope } }),
    db.product.count({ where: scope }),
    db.user.count({ where: scope }),
  ]);
  return { ok: true as const, data: { customers, motorcycles, jobs, bookings, invoices, reminders, products, users } };
}

/** 矩阵数据：org 实际角色 + 全部模块 + 有效状态（Permission 行或默认矩阵）。 */
export async function getDeveloperMatrix() {
  const who = await assertOwner();
  if ("error" in who) return { ok: false as const, error: who.error };
  const roles = (await db.user.findMany({ where: { organisationId: who.orgId }, select: { role: true }, distinct: ["role"] })).map((u) => u.role as string).sort();
  const rows = await db.permission.findMany({ where: { organisationId: who.orgId } });
  const byKey = new Map(rows.map((r) => [r.roleName + "|" + r.module, r.canView]));
  const modules = (MODULES as readonly string[]).map((m) => ({
    key: m,
    defaultFor: Object.fromEntries(roles.map((r) => [r, defaultAllowed(r, m, "view" as PermissionAction)])),
    effective: Object.fromEntries(roles.map((r) => [r, byKey.get(r + "|" + m) ?? defaultAllowed(r, m, "view" as PermissionAction)])),
    overridden: Object.fromEntries(roles.map((r) => [r, byKey.has(r + "|" + m)])),
  }));
  return { ok: true as const, roles, modules };
}
