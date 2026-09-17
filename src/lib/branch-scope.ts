/**
 * 分行作用域（严格隔离）：
 * - org 级角色（SUPER_ADMIN / OWNER / HEAD_OFFICE_ADMIN）看全部份；
 * - 其余角色（branch 级：MANAGER / SALES / SERVICE / COUNTER / MECHANIC / INVENTORY / ...）
 *   默认只看自己 branchId 所在分行。
 *
 * 应用说明：App UI 走 Prisma（非 RLS），RLS 只防 Supabase PostgREST 直连。
 * 要在 UI 层真正隔离，主列表查询需把本工具合并进 where。
 * 注意：branch 级角色若无 branchId（misconfig），回退 null（即不加 branch 过滤，等同 org 级），
 * 避免锁死数据；新建/分配员工时应确保 branchId 有值。
 */
import type { Prisma, Role } from "@prisma/client";

const ORG_LEVEL_ROLES = new Set(["SUPER_ADMIN", "OWNER", "HEAD_OFFICE_ADMIN"]);

export type BranchScopeSession = { role: string; branchId: string | null | undefined };

export function isOrgLevelRole(role: string): boolean {
  return ORG_LEVEL_ROLES.has(role);
}

/**
 * **总部级后台功能**的开关 —— 与 isOrgLevelRole 是**两条不同的轴**，不要合并。
 *
 *   isOrgLevelRole      = 数据范围：看得见、管得着**几家店**
 *   canManageOrgSettings = 功能开关：能不能用总部级的后台功能（组织资料、考勤政策、服务目录…）
 *
 * 为什么必须分开（2026-09-17）：owner 要求「让 manager 拥有跟 owner 一样的权限去做管理」，
 * 但明确**数据仍限本店**。如果图省事把 MANAGER 塞进 ORG_LEVEL_ROLES，会一次放开三件事——
 *   ① 看到所有分店的数据（不想要）
 *   ② staff-policy 里"分行级不能碰总部账号/不能授予总部角色"这两条红线同时失效（自提权）
 *   ③ 能改别的分店的店名/城市（门店身份，不只是运营细节）
 * 所以两个谓词各管一件事，MANAGER 只加进这一个。
 */
const BACK_OFFICE_ROLES = new Set([...ORG_LEVEL_ROLES, "MANAGER"]);

/** 能不能用总部级后台功能（不影响他能看到哪几家店的数据）。 */
export function canManageOrgSettings(role: string): boolean {
  return BACK_OFFICE_ROLES.has(role);
}

/** org 级 → null（不分枝过滤）；branch 级 → session.branchId。 */
export function scopedBranchId(session: BranchScopeSession): string | null {
  if (isOrgLevelRole(session.role)) return null;
  return session.branchId ?? null;
}

/**
 * 合并作用域到 where（严格隔离）：
 * - branch 级角色：强制锁到 session.branchId（忽略 URL ?branch= 覆盖，防越权看其它分行）；
 * - org 级角色：有显式 ?branch= 则按其过滤，否则不加（看全部份）。
 */
export function applyBranchScope<T extends Record<string, unknown>>(
  where: T,
  session: BranchScopeSession,
  explicitBranch?: string | null,
): T {
  const id = scopedBranchId(session);
  if (id) {
    (where as Record<string, unknown>).branchId = id;
  } else if (explicitBranch) {
    (where as Record<string, unknown>).branchId = explicitBranch;
  }
  return where;
}

/**
 * Branch-scoped where for listing assignable staff (mechanics / managers) — strict isolation.
 * Org-level roles → all branches; branch-level roles → only their own branch's staff.
 * Used by the mechanic-assignment dropdowns / board so a KL user never sees (or can assign)
 * a Testing-branch mechanic, and vice versa.
 */
export function scopedStaffWhere(session: BranchScopeSession, roles: readonly Role[]): Prisma.UserWhereInput {
  const id = scopedBranchId(session);
  return { role: { in: [...roles] }, active: true, ...(id ? { branchId: id } : {}) };
}
