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
const ORG_LEVEL_ROLES = new Set(["SUPER_ADMIN", "OWNER", "HEAD_OFFICE_ADMIN"]);

export type BranchScopeSession = { role: string; branchId: string | null | undefined };

export function isOrgLevelRole(role: string): boolean {
  return ORG_LEVEL_ROLES.has(role);
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