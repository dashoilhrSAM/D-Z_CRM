import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { readRequestIdentity } from "@/lib/supabase/identity";
import type { User, Customer } from "@prisma/client";
import type { WorkshopPersona } from "@/lib/nav-registry";

export interface SessionUser {
  kind: "staff" | "customer" | "none";
  /** 当前业务用户（staff 或 customer 记录） */
  user: User | Customer | null;
  role: string;
  name: string;
  initials: string;
  orgId: string;
  branchId: string | null;
  /** 已通过 Supabase 认证 */
  authenticated: boolean;
}

function initialsOf(name: string): string {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

const ANONYMOUS: SessionUser = { kind: "none", user: null, role: "", name: "", initials: "", orgId: "", branchId: null, authenticated: false };

/**
 * 统一当前用户解析：Supabase session → User.authId/Customer.authId 查业务记录。
 * 无 demo、无 persona——生产只认真实认证。
 *
 * 2026-09-29（P1）：不再调 auth.getUser()（**每个请求打一次 GoTrue**），
 * 改用本地验签的 getClaims()——理由与证据见 src/lib/auth/request-identity.ts。
 * 另用 React cache() 做**请求级**去重：同一渲染里 layout 与 page 各调一次时只解析一次。
 */
export const getSessionUser = cache(async (): Promise<SessionUser> => {
  const identity = await readRequestIdentity();
  if (!identity) return ANONYMOUS;

  // 员工
  const staff = await db.user.findUnique({ where: { authId: identity.id } });
  if (staff) {
    return { kind: "staff", user: staff, role: staff.role, name: staff.name, initials: initialsOf(staff.name), orgId: staff.organisationId, branchId: staff.branchId, authenticated: true };
  }
  // rider 顾客
  const rider = await db.customer.findUnique({ where: { authId: identity.id } });
  if (rider) {
    return { kind: "customer", user: rider, role: "CUSTOMER", name: rider.name, initials: initialsOf(rider.name), orgId: rider.organisationId, branchId: rider.branchId, authenticated: true };
  }
  // 已登录但未关联业务账号
  return { ...ANONYMOUS, authenticated: true };
});

/** Role → 工作台导航分组（nav-registry 按此过滤导航）。 */
export function personaForRole(role: string): WorkshopPersona {
  if (["SUPER_ADMIN", "OWNER", "HEAD_OFFICE_ADMIN", "MANAGER", "PARTS_MANAGER", "INVENTORY", "MARKETING", "ACCOUNTING", "AUDITOR"].includes(role)) return "OWNER";
  if (["COUNTER_STAFF", "SALES_MANAGER", "SALES_ADVISOR", "CUSTOMER_SERVICE"].includes(role)) return "COUNTER_STAFF";
  if (["MECHANIC", "SERVICE_MANAGER", "SERVICE_ADVISOR"].includes(role)) return "MECHANIC";
  return "OWNER";
}
