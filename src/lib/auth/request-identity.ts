/**
 * JWT claims → 请求身份。**零依赖**：edge middleware 与 node server 共用，也可直接单测。
 *
 * 为什么需要它（2026-09-29 P1 容量评估）：本项目原来的鉴权路径是
 * auth.getUser()，而它**每次调用都打一次 GoTrue**。一次页面渲染要走
 * middleware + getSessionUser（走 rider 页面还有 getRiderCustomer），
 * 等于每请求 2 次跨网络往返；按 500 家门店的模型是 8,570 万次/月，
 * 而且 Supabase 的 /auth/v1/user 默认**按 IP 限流 30 次/5 分钟**，
 * 而所有请求来自同一小撮 Vercel 出口 IP —— 这是规模一上来就会 429、
 * 且报错与真实原因无关的典型形态。
 *
 * getClaims() 在本项目**本地验签**：生产项目的 /auth/v1/.well-known/jwks.json
 * 返回 ES256(P-256) 非对称公钥，supabase-js 用 WebCrypto 验签并缓存 JWKS，
 * 稳态下不发 Auth 请求。若项目将来改用对称密钥，库会自动退回一次服务端校验
 * （行为不变，只是没有收益）——所以这个改动不会因为密钥策略变化而失效。
 *
 * 这里只做**映射**，不做决策：没有 sub 就是"没有身份"，其余交给调用方。
 */
export interface RequestIdentity {
  id: string;
  email?: string;
  user_metadata: Record<string, unknown>;
}

export interface JwtClaimsLike {
  sub?: unknown;
  email?: unknown;
  user_metadata?: unknown;
}

export function identityFromClaims(claims: JwtClaimsLike | null | undefined): RequestIdentity | null {
  if (!claims || typeof claims.sub !== "string" || claims.sub.length === 0) return null;
  const meta = claims.user_metadata;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    user_metadata: meta !== null && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Record<string, unknown>)
      : {},
  };
}
