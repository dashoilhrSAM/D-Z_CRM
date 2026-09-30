"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { scopedBranchId } from "@/lib/branch-scope";

/**
 * 通知的读态标记。
 *
 * 旧版的两个洞：
 *  · `markAllNotificationsRead` 是 `updateMany({ where: { readAt: null } })` —— **完全没有条件**，
 *    一个人点「全部已读」会把**所有组织、所有同事**的通知全部标掉；
 *  · `markNotificationRead` 直接按裸 id 写，任何登录者都能改别人的通知。
 *
 * 作用域口径：**必须与列表页看到的完全一致**（`src/app/workshop/notifications/page.tsx:20-27`）。
 * 那张列表按**分行作用域**取数（分行级 → 本分行 + 系统通知；org 级 → 本组织全部分行 + 系统通知），
 * **不按 userId 过滤** —— 通知是"给这个店看的"，不是"只给某个人看的"，
 * 很多行本来就是 `userId: null` 或属于同事。
 *
 * 所以这里刻意**不**收成 `userId = 我`：那会让「全部已读」清不掉屏幕上正显示的那些行
 * ——按钮看起来点了、数字不减，是比原来更难查的一类问题。
 * 真正要关掉的是「跨组织」：`readAt` 的更新范围永远落在本组织的分行作用域内。
 */
async function notificationScope(): Promise<Record<string, unknown> | null> {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return null;
  const branchScope = scopedBranchId(session);
  // 与列表页同一套 baseWhere：分支级看本分行 + 系统通知；org 级看本组织全部分行 + 系统通知。
  return branchScope
    ? { OR: [{ branchId: branchScope }, { branchId: null }] }
    : { OR: [{ branch: { organisationId: session.orgId } }, { branchId: null }] };
}

export async function markNotificationRead(id: string) {
  const scope = await notificationScope();
  if (!scope) return { ok: false, error: "Not signed in" };
  // 先查后改：updateMany 才能带非唯一条件，"不是本店的"要与"已标记"区分开，
  // 所以先判定可见性；不可见一律 "Not found"（不泄漏存在性）。
  const visible = await db.notification.findFirst({
    where: { AND: [{ id }, scope] },
    select: { id: true },
  });
  if (!visible) return { ok: false, error: "Not found" };
  await db.notification.updateMany({ where: { AND: [{ id }, scope] }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<void> {
  const scope = await notificationScope();
  if (!scope) return;
  await db.notification.updateMany({ where: { AND: [scope, { readAt: null }] }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}
