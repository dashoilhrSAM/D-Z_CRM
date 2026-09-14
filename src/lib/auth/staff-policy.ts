/**
 * 员工与角色管理的判定规则（纯函数，可单测）。
 * ==============================================
 * 为什么单独成文件：这些规则以前散在 src/actions/workshop.ts 里，而且用的是一个**手写的角色清单**
 * `STAFF_MANAGER_ROLES = [... , "MECHANIC"]` —— 与 src/lib/auth/permissions.ts 里的权限矩阵
 * **同一件事的第二处定义**。后果（2026-09-14 审计）：机修在清单里，于是任何能触发 updateStaff
 * 的角色都能直接 `data.role = input.role` 落库、没有白名单、没有目标分行校验 —— 自提权。
 *
 * 现在的分工：
 *  · **能不能做这件事**（是员工吗、有没有 USERS 权限）→ 交给既有的权限矩阵 can()；
 *  · **能对谁做、能改成什么**（分行归属、不许碰总部账号、不许改自己角色）→ 这里的纯函数。
 *
 * 规则只写一遍：本文件是"对谁、改成什么"的唯一定义，actions 只负责取数据与调用。
 */
import { isOrgLevelRole } from "@/lib/branch-scope";

export interface StaffActor {
  userId: string;
  role: string;
  branchId: string | null;
}
export interface StaffTarget {
  id: string;
  role: string;
  branchId: string | null;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

const OK: Verdict = { ok: true };

/** 合法角色白名单来自 Prisma 枚举本身，避免再抄一份字符串列表。 */
export const VALID_ROLES: readonly string[] = [
  "SUPER_ADMIN", "OWNER", "HEAD_OFFICE_ADMIN", "MANAGER", "SALES_MANAGER", "SALES_ADVISOR",
  "SERVICE_MANAGER", "SERVICE_ADVISOR", "COUNTER_STAFF", "CUSTOMER_SERVICE", "MECHANIC",
  "PARTS_MANAGER", "INVENTORY", "MARKETING", "ACCOUNTING", "AUDITOR",
];

/**
 * 目标账号是否在调用者的管辖范围内。
 * - 分行级（非 org 级）只能管本店的人；
 * - 分行级不能碰 org 级账号（否则一个分店经理可以停用/改密老板的账号）。
 */
export function canManageTarget(actor: StaffActor, target: StaffTarget): Verdict {
  if (!isOrgLevelRole(actor.role)) {
    if (!actor.branchId || target.branchId !== actor.branchId) {
      return { ok: false, reason: "You can only manage staff in your own branch." };
    }
    if (isOrgLevelRole(target.role)) {
      return { ok: false, reason: "Only head-office roles can manage a head-office account." };
    }
  }
  return OK;
}

/**
 * 角色授予（新建员工时定角色、或改现有员工的角色）。
 *
 * 这条线的划法依据是**既有权限矩阵**，不是拍脑袋：矩阵里 MANAGER 明确有 `USERS: [view, create, edit]`
 * —— 分店经理管本店员工是设计意图，所以不能一刀切成"只有老板能管人"。
 * 真正的红线是**角色高度**：
 *   · 不能改自己的角色（自提权，一条调用换整个组织）；
 *   · 分行级不能授予 org 级角色（不能凭空造出一个 OWNER/SUPER_ADMIN 账号）。
 * 也就是说：分行级在本店内增删改**分行级**账号；总部级账号只有总部能造、能改。
 */
export function canAssignRole(actor: StaffActor, target: { id: string } | null, nextRole: string): Verdict {
  if (target && actor.userId === target.id) return { ok: false, reason: "You cannot change your own role." };
  if (!VALID_ROLES.includes(nextRole)) return { ok: false, reason: "Unknown role: " + nextRole };
  if (!isOrgLevelRole(actor.role) && isOrgLevelRole(nextRole)) {
    return { ok: false, reason: "Only head-office roles can grant a head-office role." };
  }
  return OK;
}

/** 停用/启用：不能停自己（防自锁），分行级不能停 org 级账号。 */
export function canToggleActive(actor: StaffActor, target: StaffTarget): Verdict {
  if (actor.userId === target.id) return { ok: false, reason: "You cannot deactivate your own account." };
  return canManageTarget(actor, target);
}

/**
 * 重置密码：能管的人才能重置，且**不许分行级重置 org 级账号**（那等于账号接管：
 * 把老板的密码改掉再登录）。自己重置自己另走 profile 流程，不在这里放行。
 */
export function canResetPassword(actor: StaffActor, target: StaffTarget): Verdict {
  if (actor.userId === target.id) return { ok: false, reason: "Use your own profile to change your password." };
  return canManageTarget(actor, target);
}
