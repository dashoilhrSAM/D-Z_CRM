import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { identityFromClaims, type RequestIdentity } from "@/lib/auth/request-identity";

/**
 * Edge middleware 用 Supabase session 刷新 + 取当前身份。
 *
 * 2026-09-29（P1）：这里原来调 auth.getUser()——**每个请求都打一次 GoTrue**。
 * 现在用 getClaims()：本项目是非对称签名（ES256），它在本地用 WebCrypto 验签，
 * JWKS 由库缓存在函数实例里，稳态下零网络往返。返回的身份只有
 * { id, email, claims }，而 middleware 需要的恰好就是 claims（app_metadata 优先）里的业务
 * claims（role/orgId/branchId）与"有没有登录"这两件事。
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // 会话刷新容错：refresh token 失效时会 throw（如项目迁移后的旧会话），
  // 此时清掉旧 auth cookie、按未登录处理（middleware 据此跳登录），避免整个页面 500。
  // getClaims() 也会在需要时先刷新会话，所以这条容错路径依然必要。
  let user: RequestIdentity | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    user = identityFromClaims(data?.claims);
  } catch (e) {
    for (const c of request.cookies.getAll()) {
      if (c.name.startsWith("sb-")) {
        response.cookies.set(c.name, "", { maxAge: -1, path: "/" });
        request.cookies.set(c.name, "");
      }
    }
  }
  return { response, user, supabase };
}
