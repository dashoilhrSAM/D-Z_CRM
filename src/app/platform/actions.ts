"use server";

import { revalidatePath } from "next/cache";
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

  await platformService.setTenantStatus({
    organisationId,
    status: status as (typeof TENANT_STATUSES)[number],
    actor: { authId: guard.admin.authId, email: guard.admin.email },
    reason: String(formData.get("reason") ?? ""),
  });

  revalidatePath("/platform");
  revalidatePath("/platform/" + String(formData.get("slug") ?? ""));
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
