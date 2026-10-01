/**
 * 当前门店（tenant）上下文：**签名** cookie。
 *
 * 为什么必须签名：旧代码（`actions/rider-context.ts` 的 `setWorkshopContext`，P3b 第 5 步已删）
 * 写过一个 `dz_org` cookie，而**全项目没有任何地方读它**。
 * 这不是"忘了读"，而是读它本身不安全 —— cookie 是客户端可随意写的，
 * 谁都能把自己的门店改成隔壁那家，于是"隔离"变成一句注释。
 * 所以这里用 HMAC 签名：值由服务端签发，客户端改一个字节就验不过。
 *
 * 它解决的是 P3b 的核心问题：**登录时不知道该进哪家店**。
 * `AuthLink` 回答了"这个 auth 账号属于哪几家店"，而 cookie 记住"他这次选了哪家"。
 * 两者分开是对的：
 *   · 归属关系是事实，存在数据库里（AuthLink）；
 *   · 这次访问选哪家是会话状态，放在 cookie 里，且必须可验证。
 *
 * 与 `Organisation.slug` 的关系：slug 是运营用的门牌号（URL 里出现，如 /t/d-z-smart-workshop），
 * cookie 里存 organisationId + slug 两份 —— 前者是权限判断的依据，后者用于显示与生成链接。
 * 校验时以 **organisationId 为准**，slug 只作展示（改名不该让所有人掉线）。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const TENANT_COOKIE = "dz_tenant";

/** 有效期：30 天。选它是为了让"回店里"不用每次重选，同时不是永久 —— 换店是常态。 */
export const TENANT_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export interface ActiveTenant {
  organisationId: string;
  slug: string;
}

function signingSecret(): string {
  // AUTH_SECRET 是既有部署里已经存在的密钥（Supabase 会话验签也用它），
  // 复用它避免再引入一个"忘了配就静默失效"的环境变量。
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("active-tenant: 缺少 AUTH_SECRET —— 没有它 cookie 无法验签，隔离会静默失效");
  return s;
}

function hmac(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

/** 签发 cookie 值：`<organisationId>.<slug>.<签名>`。 */
export function signTenant(tenant: ActiveTenant): string {
  if (!tenant.organisationId) throw new Error("signTenant: organisationId 必填");
  const payload = tenant.organisationId + "." + tenant.slug;
  return payload + "." + hmac(payload);
}

/**
 * 验签并解析。任何异常一律返回 null（**fail-closed**）：
 * 宁可让用户重选一次门店，也不能拿一个可疑的值去决定"他能看哪家店的数据"。
 */
export function verifyTenant(value: string | undefined | null): ActiveTenant | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [organisationId, slug, sig] = parts;
  if (!organisationId || !sig) return null;
  let expected: string;
  try {
    expected = hmac(organisationId + "." + slug);
  } catch {
    return null; // 没配 AUTH_SECRET 时不放行，而不是"暂时不校验"
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return { organisationId, slug };
}

/** 读当前请求的门店上下文。未选/被篡改 → null。 */
export async function readActiveTenant(): Promise<ActiveTenant | null> {
  const store = await cookies();
  return verifyTenant(store.get(TENANT_COOKIE)?.value);
}

/**
 * 写入（登录、选择门店、扫码进入时用）。
 *
 * ⚠️ **不变式：只能传"该用户确实有 AuthLink 的门店"。**
 * 这个函数会老老实实签任何给它的 organisationId —— 签名保证的是"值出自服务端"，
 * 不保证"这个人有权进这家店"。所以调用方必须先
 * `identitiesForAuthUser(authId)` 取候选，**从候选里选**，
 * 绝不要把请求参数（URL/表单里的 orgId）直接递进来 ——
 * 那等于把刚锁上的门又打开。正确的写法见 tests/tenant-active-tenant.test.ts 里那条说明。
 */
export async function setActiveTenant(tenant: ActiveTenant): Promise<void> {
  const store = await cookies();
  store.set(TENANT_COOKIE, signTenant(tenant), {
    path: "/",
    maxAge: TENANT_COOKIE_MAX_AGE,
    httpOnly: true, // 客户端脚本不需要读它；不给读就少一条被偷的路径
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearActiveTenant(): Promise<void> {
  const store = await cookies();
  store.delete(TENANT_COOKIE);
}
