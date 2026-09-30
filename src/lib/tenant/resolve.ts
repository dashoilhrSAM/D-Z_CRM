/**
 * 请求级身份解析链（P3b 第 3 步）——**"这次请求该按哪条业务身份办事"的唯一定义**。
 *
 * 四级来源，顺序固定：
 *   ① 签名 cookie `dz_tenant` —— 用户选过的店（见 active-tenant.ts，客户端改不动）
 *   ② `/t/<slug>` 或 QR 扫码 —— 门店写在 URL 里（入口页在 P3b 第 4 步后半段接）
 *   ③ 唯一所属 —— 他在平台上**恰好**一条身份（`identitiesForAuthUser` 数出来的"恰好"，
 *      **不是**数据库唯一键的巧合）
 *   ④ ≥2 条 → **必须让用户选**（绝不静默挑一个 —— 那是这类系统最典型的串店入口）
 *   第 0 级（子域）留空占位，将来接法写在这里。
 *
 * 2026-09-30（第 2 步）：`User.authId` / `Customer.authId` 已从全局唯一降为租户内唯一，
 * 所以第 ③ 级不再能用 `findUnique({ where: { authId } })` —— 那正是编译器在上一步点出来的
 * 三处报错。现在第 ③/④ 级都由 AuthLink 的候选数决定：0 条 = 没身份、1 条 = 唯一所属、
 * ≥2 条 = 送选择器。代价是热路径多一次 AuthLink 查询（authId 上有索引），换来的是
 * "多条时到底该进哪家店"这个判断不再依赖巧合。
 *
 * 这一层只回答"**是谁**"，不回答"他能看什么"——后者仍由各 service / 守卫负责。
 */
import { db } from "@/lib/db";
import { readActiveTenant, type ActiveTenant } from "@/lib/tenant/active-tenant";
import { identityInTenant, identitiesForAuthUser, type ResolvedIdentity } from "@/lib/tenant/identity";
import type { Prisma } from "@prisma/client";

export type RequestPersonRef =
  /** 本请求指定了门店：**只认这一家**（identity 为 null = 他在本店没有身份） */
  | { source: "tenant"; organisationId: string; identity: ResolvedIdentity | null }
  /** 没指定门店，但他在平台上**恰好**一条身份 → 唯一所属，直接用它（单店体验不变） */
  | { source: "unique"; identity: ResolvedIdentity }
  /** 没指定门店，他在**多家店**都有身份 → **必须让他选**，绝不静默挑一个 */
  | { source: "choice"; candidates: ResolvedIdentity[] }
  /** 已认证，但平台里没有任何业务身份 */
  | { source: "none" };

/**
 * 可测的主体：cookie 值由调用方传入（`readActiveTenant()` 依赖请求上下文，测试里调不了）。
 *
 * ⚠️ 指定了门店却没有身份时，返回的是 `identity: null`，**不是**退回第 ③ 级 ——
 * "你选的那家店里没有你"和"你没选、系统替你猜一家"是两件完全不同的事，
 * 后者会把 A 店的人放进 B 店。
 */
export async function requestPersonRefFor(authId: string, tenant: ActiveTenant | null): Promise<RequestPersonRef> {
  if (!authId) return { source: "none" };
  if (tenant?.organisationId) {
    const identity = await identityInTenant(authId, tenant.organisationId);
    return { source: "tenant", organisationId: tenant.organisationId, identity };
  }
  // 第 ③/④ 级：AuthLink 是"他属于哪几家店"的唯一事实来源。
  // 注意这里**不能**用 `findFirst({ where: { authId } })` 图省事 —— 多条时它会静默挑一条，
  // 而那正是串店。"唯一"必须由**数出来**，不能由查询的巧合决定。
  const candidates = await identitiesForAuthUser(authId);
  if (candidates.length === 0) return { source: "none" };
  if (candidates.length === 1) return { source: "unique", identity: candidates[0] };
  return { source: "choice", candidates };
}

/** 生产入口：读签名 cookie 后委托给 `requestPersonRefFor`。 */
export async function requestPersonRef(authId: string): Promise<RequestPersonRef> {
  return requestPersonRefFor(authId, await readActiveTenant());
}

/**
 * 本请求"就是这一条"的业务身份；`choice` / `none` 一律 null ——
 * 这两条路调用方必须自己处理（前者送选择器、后者当没有业务账号），**不许猜一条**。
 */
export function boundIdentity(ref: RequestPersonRef): ResolvedIdentity | null {
  if (ref.source === "tenant" || ref.source === "unique") return ref.identity;
  return null;
}

/**
 * 本请求该取哪一条**员工**行；**null = 这个请求下他没有员工身份**
 * （不要再去别家店找）。规则只写一遍，取行只是把它变成查询。
 */
export function staffWhereFor(ref: RequestPersonRef): Prisma.UserWhereUniqueInput | null {
  const id = boundIdentity(ref);
  return id?.kind === "STAFF" && id.userId ? { id: id.userId } : null;
}

/** 骑手版，见 `staffWhereFor`。 */
export function customerWhereFor(ref: RequestPersonRef): Prisma.CustomerWhereUniqueInput | null {
  const id = boundIdentity(ref);
  return id?.kind === "CUSTOMER" && id.customerId ? { id: id.customerId } : null;
}

/** 按解析结果取**员工**行。 */
export async function loadStaffForRef(ref: RequestPersonRef) {
  const where = staffWhereFor(ref);
  return where ? db.user.findUnique({ where }) : null;
}

/** 按解析结果取**骑手**行（不带关联）。 */
export async function loadCustomerForRef(ref: RequestPersonRef) {
  const where = customerWhereFor(ref);
  return where ? db.customer.findUnique({ where }) : null;
}

/**
 * 带 `include` 的骑手行（rider 端要车辆/认证档案）。
 * 单独一个函数是因为 Prisma 的返回类型跟着 include 走，可选 include 的泛型表达不出来。
 */
export async function loadCustomerForRefWith<T extends Prisma.CustomerInclude>(
  ref: RequestPersonRef,
  include: T,
): Promise<Prisma.CustomerGetPayload<{ include: T }> | null> {
  const where = customerWhereFor(ref);
  return where ? db.customer.findUnique({ where, include }) : null;
}
