"use server";

import { revalidatePath } from "next/cache";
import { platformService, type ProvisionTenantResult } from "@/modules/platform/service";
import { requirePlatformAdmin } from "@/lib/platform/guard";

/**
 * 开通租户（平台台的表单动作）。
 *
 * ⚠️ **自己再判一次**管理员身份：layout 的守卫挡得住渲染，挡不住有人直接 POST 到这里。
 * 纵深防御在平台级能力上不是洁癖 —— 这个 action 能造出一整家店和它的店主账号。
 */
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
