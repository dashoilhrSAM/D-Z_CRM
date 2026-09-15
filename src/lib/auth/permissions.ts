import "server-only";
import { db } from "@/lib/db";
import type { User } from "@prisma/client";

export type PermissionAction = "view" | "create" | "edit" | "delete" | "export";

export const MODULES = [
  "DASHBOARD", "LEADS", "CUSTOMERS", "MOTORCYCLES", "PIPELINE", "TEST_RIDES",
  "BOOKINGS", "WORKSHOP", "JOB_CARDS", "TECHNICIANS", "PARTS", "INVENTORY",
  "TASKS", "REMINDERS", "AUTOMATIONS", "CAMPAIGNS", "LOYALTY", "REFERRALS",
  "ANALYTICS", "REPORTS", "BRANCHES", "USERS", "INTEGRATIONS", "SETTINGS",
  "FINANCE", "MESSAGING", "AI", "ATTENDANCE",
] as const;

// Built-in default matrix (role -> module -> actions). "*" = all modules.
// Custom Permission rows in the DB override these per (role, module).
const DEFAULT_MATRIX: Record<string, Record<string, PermissionAction[]>> = {
  SUPER_ADMIN: { "*": ["view", "create", "edit", "delete", "export"] },
  OWNER: { "*": ["view", "create", "edit", "delete", "export"] },
  HEAD_OFFICE_ADMIN: { "*": ["view", "create", "edit", "delete", "export"] },
  MANAGER: {
    "*": ["view", "create", "edit", "export"],
    FINANCE: ["view", "export"],
    SETTINGS: ["view", "edit"],
    USERS: ["view", "create", "edit"],
  },
  SALES_MANAGER: {
    "*": ["view", "export"],
    // HRM: 销售团队的考勤（本店的更正由销售经理批）
    ATTENDANCE: ["view", "create", "edit"],
    LEADS: ["view", "create", "edit", "delete", "export"],
    PIPELINE: ["view", "create", "edit"],
    TEST_RIDES: ["view", "create", "edit"],
    TASKS: ["view", "create", "edit", "delete"],
    CUSTOMERS: ["view", "create", "edit"],
    ANALYTICS: ["view", "export"],
    REPORTS: ["view", "export"],
  },
  SALES_ADVISOR: {
    // HRM: 销售顾问自己打卡（拍照 + 定位）
    ATTENDANCE: ["view", "create"],
    LEADS: ["view", "create", "edit"],
    PIPELINE: ["view", "create", "edit"],
    TEST_RIDES: ["view", "create", "edit"],
    TASKS: ["view", "create", "edit"],
    CUSTOMERS: ["view", "create", "edit"],
    MOTORCYCLES: ["view", "create", "edit"],
    DASHBOARD: ["view"],
  },
  SERVICE_MANAGER: {
    "*": ["view", "export"],
    ATTENDANCE: ["view", "create", "edit"],
    BOOKINGS: ["view", "create", "edit", "delete"],
    WORKSHOP: ["view", "create", "edit"],
    JOB_CARDS: ["view", "create", "edit", "delete"],
    TECHNICIANS: ["view", "create", "edit"],
    REMINDERS: ["view", "create", "edit"],
    PARTS: ["view"],
    ANALYTICS: ["view", "export"],
  },
  SERVICE_ADVISOR: {
    ATTENDANCE: ["view", "create"],
    BOOKINGS: ["view", "create", "edit"],
    WORKSHOP: ["view", "create", "edit"],
    JOB_CARDS: ["view", "create", "edit"],
    CUSTOMERS: ["view", "create", "edit"],
    MOTORCYCLES: ["view", "create", "edit"],
    REMINDERS: ["view", "edit"],
    DASHBOARD: ["view"],
  },
  COUNTER_STAFF: {
    DASHBOARD: ["view"],
    ATTENDANCE: ["view", "create"],
    CUSTOMERS: ["view", "create", "edit"],
    BOOKINGS: ["view", "create", "edit"],
    JOB_CARDS: ["view", "create", "edit"],
    WORKSHOP: ["view"],
    INVENTORY: ["view"],
    AI: ["view"],
  },
  CUSTOMER_SERVICE: {
    DASHBOARD: ["view"],
    ATTENDANCE: ["view", "create"],
    CUSTOMERS: ["view", "create", "edit"],
    BOOKINGS: ["view", "create", "edit"],
    REMINDERS: ["view", "create", "edit"],
    TASKS: ["view", "create", "edit"],
    MESSAGING: ["view", "create"],
    LOYALTY: ["view", "edit"],
  },
  MECHANIC: {
    DASHBOARD: ["view"],
    ATTENDANCE: ["view", "create"],
    WORKSHOP: ["view", "edit"],
    JOB_CARDS: ["view", "edit"],
    TECHNICIANS: ["view"],
    INVENTORY: ["view"],
    PARTS: ["view"],
  },
  PARTS_MANAGER: {
    "*": ["view", "export"],
    ATTENDANCE: ["view", "create"],
    PARTS: ["view", "create", "edit", "delete"],
    INVENTORY: ["view", "create", "edit", "delete", "export"],
    BRANCHES: ["view"],
    ANALYTICS: ["view", "export"],
  },
  INVENTORY: {
    ATTENDANCE: ["view", "create"],
    PARTS: ["view", "create", "edit"],
    INVENTORY: ["view", "create", "edit", "export"],
    DASHBOARD: ["view"],
  },
  MARKETING: {
    ATTENDANCE: ["view", "create"],
    CAMPAIGNS: ["view", "create", "edit", "delete"],
    LOYALTY: ["view", "edit"],
    REFERRALS: ["view"],
    CUSTOMERS: ["view"],
    ANALYTICS: ["view", "export"],
    AI: ["view"],
    DASHBOARD: ["view"],
  },
  ACCOUNTING: {
    ATTENDANCE: ["view", "create"],
    FINANCE: ["view", "create", "edit", "export"],
    REPORTS: ["view", "export"],
    ANALYTICS: ["view", "export"],
    INVOICES: ["view", "create", "edit"],
    DASHBOARD: ["view"],
  },
  AUDITOR: {
    "*": ["view", "export"],
    USERS: ["view"],
    SETTINGS: ["view"],
  },
};

export function defaultAllowed(role: string, module: string, action: PermissionAction): boolean {
  const wildcard = DEFAULT_MATRIX[role]?.["*"];
  if (wildcard) return wildcard.includes(action);
  return DEFAULT_MATRIX[role]?.[module]?.includes(action) ?? false;
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
