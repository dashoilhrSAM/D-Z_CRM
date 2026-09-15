import "server-only";
import { db } from "@/lib/db";
import type { User } from "@prisma/client";
import { ROLE_MODULES, type PermissionAction } from "@/lib/auth/role-modules";

// 动作类型与默认矩阵都定义在 role-modules.ts（客户端侧边栏也要读同一份，
// 副本会漂移——2026-09-15 就漂移过一次，考勤在柜台同事的导航里消失了）。
export type { PermissionAction } from "@/lib/auth/role-modules";

export const MODULES = [
  "DASHBOARD", "LEADS", "CUSTOMERS", "MOTORCYCLES", "PIPELINE", "TEST_RIDES",
  "BOOKINGS", "WORKSHOP", "JOB_CARDS", "TECHNICIANS", "PARTS", "INVENTORY",
  "TASKS", "REMINDERS", "AUTOMATIONS", "CAMPAIGNS", "LOYALTY", "REFERRALS",
  "ANALYTICS", "REPORTS", "BRANCHES", "USERS", "INTEGRATIONS", "SETTINGS",
  "FINANCE", "MESSAGING", "AI", "ATTENDANCE",
] as const;

// 默认矩阵来自 role-modules.ts（唯一定义）。DB 里的自定义 Permission 行按 (role, module) 覆盖它。


export function defaultAllowed(role: string, module: string, action: PermissionAction): boolean {
  const wildcard = ROLE_MODULES[role]?.["*"];
  if (wildcard) return wildcard.includes(action);
  return ROLE_MODULES[role]?.[module]?.includes(action) ?? false;
}

/** Role-based access check. DB Permission rows (custom roles) override defaults. */
export async function can(user: Pick<User, "id" | "role" | "organisationId">, module: string, action: PermissionAction): Promise<boolean> {
  // custom Permission row for this (organisation, roleName, module)
  const row = await db.permission.findUnique({
    where: {
      organisationId_roleName_module: { organisationId: user.organisationId, roleName: user.role, module },
    },
  }).catch(() => null);
  if (row) {
    const map: Record<PermissionAction, boolean> = {
      view: row.canView, create: row.canCreate, edit: row.canEdit, delete: row.canDelete, export: row.canExport,
    };
    return map[action];
  }
  // wildcard row
  const wc = await db.permission.findUnique({
    where: { organisationId_roleName_module: { organisationId: user.organisationId, roleName: user.role, module: "*" } },
  }).catch(() => null);
  if (wc) {
    const map: Record<PermissionAction, boolean> = {
      view: wc.canView, create: wc.canCreate, edit: wc.canEdit, delete: wc.canDelete, export: wc.canExport,
    };
    return map[action];
  }
  return defaultAllowed(user.role, module, action);
}

/** Finance visibility (RBAC-009): only roles with FINANCE view may see revenue figures. */
export async function canSeeFinance(user: Pick<User, "id" | "role" | "organisationId">): Promise<boolean> {
  return can(user, "FINANCE", "view");
}

/** Branch scope (RBAC-010..012): roles below owner see only their own branch by default. */
export function isHeadOfficeRole(role: string): boolean {
  return ["SUPER_ADMIN", "OWNER", "HEAD_OFFICE_ADMIN", "AUDITOR"].includes(role);
}