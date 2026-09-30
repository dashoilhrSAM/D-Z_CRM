/**
 * 请求级身份解析链（P3b 第 3 步）——**"这次请求该按哪条业务身份办事"的唯一定义**。
 *
 * 四级来源，顺序固定：
 *   ① 签名 cookie `dz_tenant` —— 用户选过的店（见 active-tenant.ts，客户端改不动）
 *   ② `/t/<slug>` 或 QR 扫码 —— 第 4 步接线（门店写在 URL 里）
 *   ③ 唯一所属 —— 今天 `User.authId` / `Customer.authId` 是**全局唯一**，
 *      所以"唯一"是数据库保证的，一次 findUnique 就是答案
 *   ④ ≥2 条 → **必须让用户选**（绝不静默挑一个 —— 那是这类系统最典型的串店入口）
 *   第 0 级（子域）留空占位，将来接法写在这里。
 *
 * 为什么本文件只做到第 ③ 级：**第 ④ 级今天不可能发生**（唯一键还在）。
 * 第 2 步松开那两个唯一键时，本文件末尾 `uniqueOwnerLookup` 的两行
 * `findUnique({ where: { authId } })` 会**直接编译不过** —— 这正是我们要的：
 * 编译器会逼着把它换成 `identitiesForAuthUser(authId)` 的候选链 + 选择器，
 * 而不是靠人记得回来改（本项目已经用过两次同一个手法：把规则做成类型/编译期约束）。
 *
 * 这一层只回答"**是谁**"，不回答"他能看什么"——后者仍由各 service / 守卫负责。
 */
import { db } from "@/lib/db";
import { readActiveTenant, type ActiveTenant } from "@/lib/tenant/active-tenant";
import { identityInTenant, type ResolvedIdentity } from "@/lib/tenant/identity";
import type { Prisma } from "@prisma/client";

export type RequestPersonRef =
  /** 本请求指定了门店：**只认这一家**（identity 为 null = 他在本店没有身份） */
  | { source: "tenant"; organisationId: string; identity: ResolvedIdentity | null }
  /** 本请求没有指定门店：走第 ③ 级「唯一所属」（今天 = 全局唯一键） */
  | { source: "unique" };

/**
 * 可测的主体：cookie 值由调用方传入（`readActiveTenant()` 依赖请求上下文，测试里调不了）。
 *
 * ⚠️ 指定了门店却没有身份时，返回的是 `identity: null`，**不是**退回第 ③ 级 ——
 * "你选的那家店里没有你"和"你没选、系统替你猜一家"是两件完全不同的事，
 * 后者会把 A 店的人放进 B 店。
 */
export async function requestPersonRefFor(authId: string, tenant: ActiveTenant | null): Promise<RequestPersonRef> {
  if (!authId) return { source: "unique" };
  if (!tenant?.organisationId) return { source: "unique" };
  const identity = await identityInTenant(authId, tenant.organisationId);
  return { source: "tenant", organisationId: tenant.organisationId, identity };
}

/** 生产入口：读签名 cookie 后委托给 `requestPersonRefFor`。 */
export async function requestPersonRef(authId: string): Promise<RequestPersonRef> {
  return requestPersonRefFor(authId, await readActiveTenant());
}

/**
 * 第 ③ 级「唯一所属」：今天靠的是 `User.authId` / `Customer.authId` 的全局唯一键。
 *
 * ⚠️ **第 2 步松键时这里必须改**：`findUnique({ where: { authId } })` 在 authId 不再是
 * 唯一键之后会编译失败（Prisma 只允许对唯一字段用 findUnique），这是**有意的护栏**。
 * 换法：`identitiesForAuthUser(authId)` → 0 条 = 没身份、1 条 = 用它、
 * ≥2 条 = 交给多店选择器（第 4 步）。
 */
export function uniqueOwnerStaffWhere(authId: string): Prisma.UserWhereUniqueInput {
  return { authId };
}

/** 见 `uniqueOwnerStaffWhere` 的说明（同一处护栏）。 */
export function uniqueOwnerCustomerWhere(authId: string): Prisma.CustomerWhereUniqueInput {
  return { authId };
}

/**
 * 本请求该取哪一条**员工**行：指定了门店 → 链接里那一条（= 本店那条）；
 * 没有指定 → 唯一所属。**null = 这个请求下他没有员工身份**（不要再去别家店找）。
 *
 * 为什么"该取哪条"要单独成函数：三个消费者（session-user / rider-customer /
 * injectBizClaims）各写一遍"先看 cookie 再看唯一键"就必然漂移 —— 规则只写一遍，
 * 取行只是把它变成查询。
 */
export function staffWhereFor(ref: RequestPersonRef, authId: string): Prisma.UserWhereUniqueInput | null {
  if (ref.source === "unique") return uniqueOwnerStaffWhere(authId);
  if (ref.identity?.kind !== "STAFF" || !ref.identity.userId) return null;
  return { id: ref.identity.userId };
}

/** 骑手版，见 `staffWhereFor`。 */
export function customerWhereFor(ref: RequestPersonRef, authId: string): Prisma.CustomerWhereUniqueInput | null {
  if (ref.source === "unique") return uniqueOwnerCustomerWhere(authId);
  if (ref.identity?.kind !== "CUSTOMER" || !ref.identity.customerId) return null;
  return { id: ref.identity.customerId };
}

/** 按解析结果取**员工**行。 */
export async function loadStaffForRef(ref: RequestPersonRef, authId: string) {
  const where = staffWhereFor(ref, authId);
  return where ? db.user.findUnique({ where }) : null;
}

/** 按解析结果取**骑手**行（不带关联）。 */
export async function loadCustomerForRef(ref: RequestPersonRef, authId: string) {
  const where = customerWhereFor(ref, authId);
  return where ? db.customer.findUnique({ where }) : null;
}

/**
 * 带 `include` 的骑手行（rider 端要车辆/认证档案）。
 * 单独一个函数是因为 Prisma 的返回类型跟着 include 走，可选 include 的泛型表达不出来。
 */
export async function loadCustomerForRefWith<T extends Prisma.CustomerInclude>(
  ref: RequestPersonRef,
  authId: string,
  include: T,
): Promise<Prisma.CustomerGetPayload<{ include: T }> | null> {
  const where = customerWhereFor(ref, authId);
  return where ? db.customer.findUnique({ where, include }) : null;
}
