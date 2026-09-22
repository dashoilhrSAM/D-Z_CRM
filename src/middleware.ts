// Defense in depth: the sidebar hides links (UX), this re-checks the same
// registry at the request level (authorization).
//
// Two auth modes:
//  1. Supabase Auth — sb-*-auth-token present. Business-level authorization
//     is enforced server-side (nav-registry/permissions + RLS via JWT
//     claims); middleware only gates unauthenticated requests.
//  2. Legacy real auth — dz_session signed token (prototype, kept for migration).
// No demo mode, no persona — production only accepts real auth.
import { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { SESSION_COOKIE, verifyToken } from "@/lib/auth/session-core";

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

// Rider 顾客私有页（未登录需登录；登录页/公开页放行）
const RIDER_PRIVATE = ["/rider/bookings", "/rider/approvals", "/rider/invoices", "/rider/motorcycles", "/rider/profile", "/rider/settings", "/rider/service-status", "/rider/service-history", "/rider/notifications"];
function isRiderPrivate(pathname: string): boolean {
  return RIDER_PRIVATE.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * 不需要登录会话的 API —— 名单必须显式、必须短，每一项都要说明它靠什么鉴权。
 *
 * 2026-09-14 审计实测：matcher 不含 /api 时，`curl /api/export?type=customers`
 * 不带任何 Cookie 就能拿到全组织客户 CSV（姓名/电话/邮箱），商品导出还带成本价。
 * 所以 API 层的默认改成**拒绝**，公开的在这里逐个列出来。
 */
const API_PUBLIC = [
  "/api/webhooks", // Meta 回调：靠 x-hub-signature-256 校验（见 webhooks/whatsapp/route.ts）
  "/api/storage",  // 资源托管：产品图/海报的 <img src>，公开页也会引用
  "/api/cron",     // Vercel Cron：靠 CRON_SECRET Bearer，且**缺密钥即拒绝**（fail-closed）
  "/api/hooks",    // Supabase Auth Hook：靠 Standard Webhooks HMAC 签名（requireSmsHookSignature，fail-closed）
];
function isApiPublic(pathname: string): boolean {
  return API_PUBLIC.some((p) => matchesPrefix(pathname, p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isWorkshop = pathname.startsWith("/workshop");

  // 注入 x-pathname（server layout 读当前路径）
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);

  // 1. Supabase Auth session. getUser() also refreshes tokens.
  const { response, user } = await updateSession(req);

  // 2. API 层门禁（纵深防御的第一道；第二道在 src/lib/api-auth.ts，逐路由 requireStaff()）。
  if (pathname.startsWith("/api")) {
    if (isApiPublic(pathname)) {
      response.headers.set("x-pathname", pathname);
      return response;
    }
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    // 骑手（CUSTOMER）不直接调 API：他们的数据走页面与 Server Action。
    // 这里读的是 JWT claims，够不上"权威"（角色改动要重新登录才生效），
    // 所以真正的判定仍在路由里的 requireStaff()——这一层只是让匿名请求连门都进不来。
    if (((user.user_metadata?.role as string) ?? "") === "CUSTOMER") {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    response.headers.set("x-pathname", pathname);
    return response;
  }
  if (user) {
    // —— 路由隔离矩阵（角色级；layout 层用 DB 权威数据兜底）——
    // JWT claims 由登录时 injectBizClaims 写入 user_metadata（orgId/branchId/role/userId/customerId）
    const role = (user.user_metadata?.role as string) ?? "";
    const isCustomer = role === "CUSTOMER";
    const isMechanic = role === "MECHANIC";
    const go = (path: string): NextResponse => {
      const url = new URL(path, req.url);
      const r = NextResponse.redirect(url);
      r.headers.set("x-pathname", pathname);
      return r;
    };

    // /workshop/*：仅员工且非 MECHANIC（rider → rider app，mechanic → mechanic app）
    if (pathname.startsWith("/workshop")) {
      if (isCustomer) return go("/rider/home");
      if (isMechanic) return go("/mechanic-app");
    }
    // /mechanic-app/*：仅 MECHANIC
    if (pathname.startsWith("/mechanic-app")) {
      if (isCustomer) return go("/rider/home");
      if (!isMechanic) return go("/workshop/dashboard");
    }
    // /rider/* 私有页：仅 CUSTOMER
    if (isRiderPrivate(pathname)) {
      if (isMechanic) return go("/mechanic-app");
      if (!isCustomer) return go("/workshop/dashboard");
    }
    response.headers.set("x-pathname", pathname);
    return response;
  }

  // rider 私有页：未登录 → 重定向到 /rider/login。
  if (!isWorkshop && isRiderPrivate(pathname)) {
    const url = new URL("/rider/login", req.url);
    url.searchParams.set("next", pathname);
    const r = NextResponse.redirect(url);
    r.headers.set("x-pathname", pathname);
    return r;
  }

  // mechanic-app：未登录 → 技师专属登录页（/mechanic-app/login 本身放行）
  if (pathname.startsWith("/mechanic-app")) {
    if (pathname === "/mechanic-app/login") {
      response.headers.set("x-pathname", pathname);
      return response;
    }
    const url = new URL("/mechanic-app/login", req.url);
    url.searchParams.set("next", pathname);
    const r = NextResponse.redirect(url);
    r.headers.set("x-pathname", pathname);
    return r;
  }

  // 非 workshop 路径（rider 等）：无 Supabase session 时放行——页面自身处理登录引导/重定向。
  // 只有 workshop 路径才走 legacy session 逻辑。
  if (!isWorkshop) {
    response.headers.set("x-pathname", pathname);
    return response;
  }

  // 2. Legacy real auth: signed session token (prototype, kept for migration).
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const payload = await verifyToken(token);
  if (!payload) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    const r = NextResponse.redirect(url);
    r.headers.set("x-pathname", pathname);
    return r;
  }
  response.headers.set("x-pathname", pathname);
  return response;
}

export const config = {
  // ⚠️ /api/:path* 必须在这里：少了它，所有 API 路由都绕过 middleware（2026-09-14 审计实测）。
  matcher: ["/workshop/:path*", "/rider/:path*", "/mechanic-app/:path*", "/api/:path*"],
};
