/**
 * 门店相关的两个**不同**的谓词，以及"写入要落在哪家门店"的解析。
 *
 * ⚠️ P5（2026-10-01）：**branch 不再是数据分区轴**。
 * 一个 `Organisation` 就是一家店（`Branch` 降级为隐藏的 1:1 门店记录），
 * 所以"按 branchId 收窄查询"既没有意义，又把一个历史漏洞留在代码里：
 * 原来的规则是"总部角色不过滤、分行角色过滤"，于是**同一家店里的两个人看到的数据不一样**，
 * 而那纯粹是他们账号上 `branchId` 字段的差别。
 *
 * 现在：**所有查询只按 `organisationId` 收窄**（P2 的作用域地图已经在做这件事）。
 * 本文件里三个"隔离"API（原 `scopedBranchId` / `applyBranchScope` / `scopedStaffWhere`）
 * 的**语义已退役**，保留是过渡期的编译兼容 —— 它们一律不再注入 branch 条件。
 * 机械清理（把恒为空的分支参数从 30 多处调用点删掉）留在下一片，因为它不影响行为。
 */
import type { Prisma, Role } from "@prisma/client";

const ORG_LEVEL_ROLES = new Set(["SUPER_ADMIN", "OWNER", "HEAD_OFFICE_ADMIN"]);

export type BranchScopeSession = { role: string; branchId: string | null | undefined };

/** ⚠️ 这条是**数据范围**轴（历史语义：看得见几家店）。P5 之后一家店只有一个 org，见文件头。 */
export function isOrgLevelRole(role: string): boolean {
  return ORG_LEVEL_ROLES.has(role);
}

/**
 * **总部级后台功能**的开关 —— 与 isOrgLevelRole 是**两条不同的轴**，不要合并。
 *
 *   isOrgLevelRole      = 数据范围（P5 之后已退化，见文件头）
 *   canManageOrgSettings = 功能开关：能不能用总部级的后台功能（组织资料、考勤政策、服务目录…）
 *
 * 为什么必须分开（2026-09-17）：owner 要求「让 manager 拥有跟 owner 一样的权限去做管理」，
 * 但明确**数据仍限本店**。如果图省事把 MANAGER 塞进 ORG_LEVEL_ROLES，会一次放开三件事——
 *   ① 看到所有分店的数据（P5 之后这条已经不存在了）
 *   ② staff-policy 里"分行级不能碰总部账号/不能授予总部角色"这两条红线同时失效（自提权）
 *   ③ 能改别的分店的店名/城市（门店身份，不只是运营细节）
 * 所以两个谓词各管一件事 —— **这一条（功能开关）继续有效**，P5 只退役数据那一条。
 */
const BACK_OFFICE_ROLES = new Set([...ORG_LEVEL_ROLES, "MANAGER"]);

/** 能不能用总部级后台功能（不影响他能看到哪几家店的数据）。 */
export function canManageOrgSettings(role: string): boolean {
  return BACK_OFFICE_ROLES.has(role);
}

/**
 * ⚠️ **已退役（P5）**：恒返回 `null` = 「不加 branch 过滤」。
 * 保留函数是为了不改 30 多处调用点的编译；语义上它现在什么也不做。
 * 调用点里那些 `branchId: scopedBranchId(session) ?? undefined` 会在下一片机械删除。
 */
export function scopedBranchId(_session: BranchScopeSession): string | null {
  void _session;
  return null;
}

/**
 * ⚠️ **已退役（P5）**：原样返回 `where`，**不再注入 branchId**（包括 URL 上的 `?branch=`）。
 * 一家店只有一个门店，按分行过滤等于不过滤；而"分行级忽略显式参数、总部级允许"
 * 那套规则正是要退役的东西。
 */
export function applyBranchScope<T extends Record<string, unknown>>(
  where: T,
  _session?: BranchScopeSession,
  _explicitBranch?: string | null,
): T {
  void _session;
  void _explicitBranch;
  return where;
}

/**
 * Branch-scoped where for listing assignable staff (mechanics / managers).
 *
 * ⚠️ **已退役（P5）**：不再按 branch 收窄 —— 同一家店里的技师彼此可指派，
 * 这正是原来那条"KL 的用户看不到 Testing 门店技师"的规则要放弃的东西。
 */
export function scopedStaffWhere(_session: BranchScopeSession, roles: readonly Role[]): Prisma.UserWhereInput {
  void _session;
  return { role: { in: [...roles] }, active: true };
}

/**
 * **写入**要落在哪家门店 —— 这不是权限，是记账。
 *
 * 新行（工单/任务/考勤…）需要一个 branchId 才能落库，而一家店只有一个门店，
 * 所以用"这个人自己所属的门店"即可；`Branch` 仍然是隐藏的 1:1 记录，不参与可见性。
 */
export function writeBranchId(session: BranchScopeSession): string | null {
  return session.branchId ?? null;
}
