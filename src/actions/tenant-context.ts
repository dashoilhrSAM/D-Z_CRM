"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { readRequestIdentity } from "@/lib/supabase/identity";
import { identitiesForAuthUser } from "@/lib/tenant/identity";
import { setActiveTenant } from "@/lib/tenant/active-tenant";
import { safeNextPath } from "@/lib/auth/next-path";

/**
 * 选定"这次进哪家店"——**多店选择器与 QR 门店码共用的唯一入口**。
 *
 * ⚠️ **不变式**：`setActiveTenant` 会老老实实签任何递给它的 organisationId ——
 * 签名只保证"值出自服务端"，不保证"这个人有权进这家店"。所以这里的取值来源
 * **只有** `identitiesForAuthUser(authId)` 的候选，绝不接受表单里任意一个 id。
 * 这条不变式写在 `active-tenant.ts` 的注释里，这里用一个 `find` 把它变成代码。
 *
 * 2026-09-30（P3b 第 5 步）：这里合并了原来 `actions/rider-context.ts` 的
 * `setWorkshopContext` —— 那个函数把表单里的 organisationId **原样写进一个既不签名、
 * 也没人读的 `dz_org` cookie**（写了等于没写，而且是"看起来有隔离"的假象）。
 * 现在两个入口共用这一份校验。
 */
export async function chooseWorkshop(formData: FormData) {
  const wanted = String(formData.get("organisationId") ?? "");
  // 未登录时的回跳（QR 页会带上），过一遍白名单防开放重定向
  const next = safeNextPath(String(formData.get("next") ?? ""), "");

  const identity = await readRequestIdentity();
  if (!identity) redirect("/login" + (next ? "?next=" + encodeURIComponent(next) : ""));

  const candidates = await identitiesForAuthUser(identity.id);
  const picked = candidates.find((c) => c.organisationId === wanted);
  // 不在候选里（伪造/过期/手改表单）→ 当作没选，回选择器，**不签任何 cookie**
  if (!picked) redirect("/select-workshop?rejected=1");

  const org = await db.organisation.findUnique({ where: { id: picked.organisationId }, select: { slug: true } });
  await setActiveTenant({ organisationId: picked.organisationId, slug: org?.slug ?? "" });

  // 技师会被 mechanic-app 的布局再转一次（那里才知道角色），这里只分员工/顾客
  redirect(picked.kind === "STAFF" ? "/workshop/dashboard" : "/rider/home");
}
