import "server-only";
import { db } from "@/lib/db";
import { readRequestIdentity } from "@/lib/supabase/identity";

/**
 * 当前 rider 顾客（带车辆/认证档案）：Supabase session → Customer.authId。
 *
 * 2026-09-29（P1）：与 getSessionUser 一样改走本地验签的身份（readRequestIdentity），
 * 不再每请求打一次 GoTrue —— 这是第三处被漏掉的热点（rider 端页面各自调一次）。
 */
export async function getRiderCustomer() {
  const identity = await readRequestIdentity();
  if (!identity) return null;
  return db.customer.findUnique({
    where: { authId: identity.id },
    include: { motorcycles: true, authProfile: true },
  });
}
