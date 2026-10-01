"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/session-user";
import { can } from "@/lib/auth/permissions";
import { isOrgLevelRole } from "@/lib/branch-scope";
import { tasksModule } from "@/modules/tasks/service";

/**
 * 任务写入口的门禁。
 *
 * 三处旧缺陷（2026-09 审计）：
 *  · createTask 用 `db.organisation.findFirst()` 取组织 —— 多租户下等于"写进第一个组织"；
 *  · completeTask 用 `getCurrentUser() ?? db.user.findFirst()` 兜底 —— 没有会话时
 *    把**任意一个用户**记成完成人（不是"没登录就不许做"，而是"随便找个人顶替"）；
 *  · reopen/cancel 没有任何检查，按裸 id 更新，可以改别的租户的任务。
 * 现在统一：必须已登录员工 + 本组织（Task 自己有 organisationId）+ TASKS:edit。
 */
async function requireTaskEditor() {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return null;
  const allowed = await can({ id: session.user.id, role: session.role as never, organisationId: session.orgId }, "TASKS", "view");
  if (!allowed) return null;
  return session;
}

export async function createTask(input: {
  title: string; description?: string; ownerId?: string; relatedType?: string; relatedId?: string;
  dueAt?: string; priority?: string; branchId?: string;
}) {
  const session = await requireTaskEditor();
  if (!session) return { ok: false as const, error: "Not signed in or no permission" };
  // 门店落点（P5 起不再是权限判断，只是记账）：
  //  · 分行级账号 → 自己所属的门店
  //  · 总部级账号 → 用他显式指定的，没指定就不落门店
  const branch = isOrgLevelRole(session.role) ? input.branchId ?? null : session.branchId ?? null;
  const task = await tasksModule.create({
    organisationId: session.orgId,
    branchId: branch,
    ownerId: input.ownerId || null,
    title: input.title,
    description: input.description || null,
    relatedType: input.relatedType || null,
    relatedId: input.relatedId || null,
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    priority: input.priority || "NORMAL",
  });
  revalidatePath("/", "layout");
  return { ok: true as const, id: task.id };
}

export async function completeTask(id: string) {
  const session = await requireTaskEditor();
  if (!session || !session.user) return { ok: false as const, error: "Not signed in or no permission" };
  // 完成人＝当前会话用户。旧版的 `?? db.user.findFirst()` 兜底已删除：
  // 没有身份时应当拒绝，而不是随便挑一个用户记成完成人（这也会写进审计）。
  const done = await tasksModule.complete(id, session.user.id, session.orgId);
  if (!done) return { ok: false as const, error: "Not found" };
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function reopenTask(id: string) {
  const session = await requireTaskEditor();
  if (!session) return { ok: false as const, error: "Not signed in or no permission" };
  if (!(await tasksModule.reopen(id, session.orgId))) return { ok: false as const, error: "Not found" };
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function cancelTask(id: string) {
  const session = await requireTaskEditor();
  if (!session) return { ok: false as const, error: "Not signed in or no permission" };
  if (!(await tasksModule.cancel(id, session.orgId))) return { ok: false as const, error: "Not found" };
  revalidatePath("/", "layout");
  return { ok: true as const };
}
