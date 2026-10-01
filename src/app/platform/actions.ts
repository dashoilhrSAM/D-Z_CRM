"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { platformService, TENANT_STATUSES, type ProvisionTenantResult } from "@/modules/platform/service";
import { requirePlatformAdmin } from "@/lib/platform/guard";

/**
 * 开通租户（平台台的表单动作）。
 *
 * ⚠️ **自己再判一次**管理员身份：layout 的守卫挡得住渲染，挡不住有人直接 POST 到这里。
 * 纵深防御在平台级能力上不是洁癖 —— 这个 action 能造出一整家店和它的店主账号。
 */
/**
 * 停用 / 恢复租户。与开通一样：**自己再判一次**管理员身份（直接 POST 也拦得住）。
 */
export async function setTenantStatusAction(formData: FormData): Promise<void> {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return;

  const organisationId = String(formData.get("organisationId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!organisationId || !TENANT_STATUSES.includes(status as (typeof TENANT_STATUSES)[number])) return;

  const res = await platformService.setTenantStatus({
    organisationId,
    status: status as (typeof TENANT_STATUSES)[number],
    actor: { authId: guard.admin.authId, email: guard.admin.email },
    reason: String(formData.get("reason") ?? ""),
  });

  revalidatePath("/platform");
  revalidatePath("/platform/" + String(formData.get("slug") ?? ""));
  // ⚠️ 失败**必须说出来**：把结果一丢、照样 redirect，界面看起来就像成功了 ——
  // 操作员会以为「已经停用了」，而其实什么都没发生（浏览器冒烟实测踩到）。
  if (!res.ok) redirect("/platform/" + String(formData.get("slug") ?? "") + "?err=" + encodeURIComponent(res.error));
}

/**
 * 开始/结束**限时支持访问**。两条都自己判管理员身份。
 * 期限与原因由服务层再校验一次（UI 的 min/max 只是提示）。
 */
export async function grantSupportAccessAction(formData: FormData): Promise<void> {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return;
  const organisationId = String(formData.get("organisationId") ?? "");
  if (!organisationId) return;
  const res = await platformService.grantSupportAccess({
    organisationId,
    actor: { authId: guard.admin.authId, email: guard.admin.email },
    reason: String(formData.get("reason") ?? ""),
    minutes: Number(formData.get("minutes") ?? 0),
  });
  const base = "/platform/" + String(formData.get("slug") ?? "") + "/support";
  // 原因太短 / 时长越界 —— 都要让人看见，不能静默无反应
  if (!res.ok) redirect(base + "?err=" + encodeURIComponent(res.error));
  revalidatePath(base);
}

export async function revokeSupportAccessAction(formData: FormData): Promise<void> {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return;
  const organisationId = String(formData.get("organisationId") ?? "");
  if (!organisationId) return;
  await platformService.revokeSupportAccess({ organisationId, actor: { authId: guard.admin.authId, email: guard.admin.email } });
  revalidatePath("/platform/" + String(formData.get("slug") ?? "") + "/support");
}

/**
 * 退租（永久删除）。**不可逆** —— 所以闸门在服务层（先停用、原样输入 slug、
 * 删除与复核同事务），这里只负责把表单递过去。
 */
export async function purgeTenantAction(formData: FormData): Promise<void> {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return;
  const organisationId = String(formData.get("organisationId") ?? "");
  if (!organisationId) return;
  const res = await platformService.purgeTenant({
    organisationId,
    actor: { authId: guard.admin.authId, email: guard.admin.email },
    confirmSlug: String(formData.get("confirmSlug") ?? ""),
  });
  if (!res.ok) {
    // 打字确认不对 / 还没停用 / 复核失败 —— 回本页把原因写在明面上（静默跳走最危险）
    redirect("/platform/" + String(formData.get("slug") ?? "") + "?err=" + encodeURIComponent(res.error));
  }
  revalidatePath("/platform");
  redirect("/platform?ok=" + encodeURIComponent("已退租 " + res.tombstone.slug + "（删除 " + res.deleted + " 行）"));
}

export async function createTenantAction(_prev: unknown, formData: FormData): Promise<ProvisionTenantResult> {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return { ok: false, code: "AUTH_UNAVAILABLE", error: "没有平台管理员权限" };

  const res = await platformService.provisionTenant({
    name: String(formData.get("name") ?? "").trim(),
    slug: String(formData.get("slug") ?? "").trim().toLowerCase(),
    ownerEmail: String(formData.get("ownerEmail") ?? "").trim().toLowerCase(),
    ownerName: String(formData.get("ownerName") ?? "").trim() || undefined,
    city: String(formData.get("city") ?? "").trim() || undefined,
    address: String(formData.get("address") ?? "").trim() || undefined,
    phone: String(formData.get("phone") ?? "").trim() || undefined,
    trialDays: formData.get("trialDays") ? Number(formData.get("trialDays")) : undefined,
  });

  if (res.ok) revalidatePath("/platform");
  return res;
}
