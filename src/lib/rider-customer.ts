import "server-only";
import { readRequestIdentity } from "@/lib/supabase/identity";
import { requestPersonRef, loadCustomerForRefWith } from "@/lib/tenant/resolve";
import type { Prisma } from "@prisma/client";

/** rider 端页面普遍要用车辆与认证档案。 */
const RIDER_INCLUDE = { motorcycles: true, authProfile: true } satisfies Prisma.CustomerInclude;

/**
 * 当前 rider 顾客（带车辆/认证档案）：Supabase session → Customer.authId。
 *
 * 2026-09-29（P1）：与 getSessionUser 一样改走本地验签的身份（readRequestIdentity），
 * 不再每请求打一次 GoTrue —— 这是第三处被漏掉的热点（rider 端页面各自调一次）。
 *
 * 2026-09-30（P3b 第 3 步）：先认「本请求指定的门店」（签名 cookie → AuthLink），
 * 没有才回退唯一所属；**指定了门店却在店里查不到本人时返回 null，而不是换一家店**。
 * 解析链与取行都在 lib/tenant/resolve.ts（规则只写一遍），这里只负责给 include。
 */
export async function getRiderCustomer() {
  const identity = await readRequestIdentity();
  if (!identity) return null;
  const ref = await requestPersonRef(identity.id);
  return loadCustomerForRefWith(ref, identity.id, RIDER_INCLUDE);
}
