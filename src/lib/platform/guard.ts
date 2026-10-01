import "server-only";
import { readRequestIdentity } from "@/lib/supabase/identity";
import { platformService } from "@/modules/platform/service";

/**
 * 平台台的**唯一**入口判定（P4 第二块）。
 *
 * 三条规则，都要紧：
 *  ① **只认 `PlatformAdmin.authId`** —— 租户里的 OWNER/MANAGER 再大也只是"一家店里最大"，
 *     让他们天然能跨店管理，等于把整套租户隔离从后门打开。
 *  ② 未登录 → 交回调用方去登录（带上 `next`，登录完回得来）。
 *  ③ 已登录但**不是**平台管理员 → `notFound()`：不确认这个路由存在。
 *     重定向到 /login 或 403 页面等于告诉全世界"这里有个平台台"。
 *
 * 每个 server action 必须**自己再判一次**（纵深防御）：layout 的守卫挡得住渲染，
 * 挡不住直接 POST 到 action。
 */
export interface PlatformAdminIdentity {
  authId: string;
  email: string | null;
}

export async function requirePlatformAdmin(): Promise<
  { ok: true; admin: PlatformAdminIdentity } | { ok: false; reason: "anonymous" | "not-admin" }
> {
  const identity = await readRequestIdentity();
  if (!identity) return { ok: false, reason: "anonymous" };
  const row = await platformService.adminFor(identity.id);
  if (!row) return { ok: false, reason: "not-admin" };
  return { ok: true, admin: { authId: row.authId, email: row.email } };
}
