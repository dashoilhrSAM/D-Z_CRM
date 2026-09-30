"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { readRequestIdentity } from "@/lib/supabase/identity";
import { identitiesForAuthUser } from "@/lib/tenant/identity";
import { setActiveTenant } from "@/lib/tenant/active-tenant";

/**
 * 选定门店（多店选择器，P3b 第 4 步）。
 *
 * ⚠️ **不变式**：`setActiveTenant` 会老老实实签任何递给它的 organisationId ——
 * 签名只保证"值出自服务端"，不保证"这个人有权进这家店"。所以这里的取值来源
 * **只有** `identitiesForAuthUser(authId)` 的候选，绝不接受请求里任意一个 id。
 * 这条不变式写在 `active-tenant.ts` 的注释里，这里用一个 `find` 把它变成代码。
 */
export async function chooseWorkshop(formData: FormData) {
  const identity = await readRequestIdentity();
  if (!identity) redirect("/login");

  const wanted = String(formData.get("organisationId") ?? "");
  const candidates = await identitiesForAuthUser(identity.id);
  const picked = candidates.find((c) => c.organisationId === wanted);
  // 不在候选里（伪造/过期/手改表单）→ 当作没选，回选择器，**不签任何 cookie**
  if (!picked) redirect("/select-workshop?rejected=1");

  const org = await db.organisation.findUnique({ where: { id: picked.organisationId }, select: { slug: true } });
  await setActiveTenant({ organisationId: picked.organisationId, slug: org?.slug ?? "" });

  // 技师会被 mechanic-app 的布局再转一次（那里才知道角色），这里只分员工/顾客
  redirect(picked.kind === "STAFF" ? "/workshop/dashboard" : "/rider/home");
}
