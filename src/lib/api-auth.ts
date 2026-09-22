/**
 * API 路由的统一门禁。
 * ==================
 * 为什么单独成文件：D&Z 的授权是**逐 action / 逐路由手写**的，写法不统一就会出现
 * 「同一个文件里一半函数有校验、一半没有」——src/actions/invoices.ts 就是先例
 * （setInvoiceDiscount 有 staff+分行校验，同文件的 settleInvoices/addInvoicePayment 什么都没有）。
 * 2026-09-14 审计实测：/api/export?type=customers 不带任何 Cookie 就能下载全组织客户 CSV。
 *
 * 约定：
 *  · **API 层的默认是"必须登录且必须是员工"**，公开的少数几个（webhook / 静态资源）在
 *    middleware 里显式列白名单——默认拒绝，而不是默认放行。
 *  · 骑手（CUSTOMER）不算 staff：他们走页面（Server Action），不直接调 API。
 *  · 这一层是**纵深防御的第二道**，不是唯一一道：真正决定"能不能改这一行数据"的校验
 *    仍应写在业务里（分行归属、目标归属），这里只回答"你是谁、你是不是员工"。
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getSessionUser, type SessionUser } from "@/lib/session-user";

export function apiUnauthorized(message = "Unauthorized"): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status: 401 });
}

export function apiForbidden(message = "Forbidden"): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status: 403 });
}

/** 要求已登录员工。返回 { session } 或 { response }（后者直接 return 给调用方）。 */
export async function requireStaff(): Promise<{ session: SessionUser } | { response: NextResponse }> {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return { response: apiUnauthorized() };
  return { session };
}

/**
 * cron 端点的密钥校验：**fail-closed**。
 *
 * 旧写法是 `if (secret) { ...校验... }` —— 密钥缺失时整段鉴权被跳过，端点变成公开可触发。
 * 而 /api/cron/reminders 是**会给真实客户群发 WhatsApp** 的入口，不能有这样的默认值。
 * 现在：没配密钥 → 503（显式失败、能被监控看到）；密钥不对 → 401。
 */
export function requireCronSecret(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== "Bearer " + secret) return apiUnauthorized();
  return null;
}

/**
 * Supabase Auth Hook（Send SMS）的鉴权：与 cron 同一套 fail-closed 口径。
 *
 * 为什么不能走 requireStaff()：调用方是 Supabase，不是人，它只会带
 * `Authorization: Bearer <dashboard 里配置的 secret>`。
 *
 * 也正因如此，这个端点必须**假定全世界可打**——它收到的 payload 里有明文验证码，
 * 参数里有任意手机号。三条硬要求：
 *  · 没配 secret → 503（显式失败、能被监控看见），绝不"跳过校验照常发短信"；
 *  · secret 不对 → 401；
 *  · 用恒定时间比较，避免按字节比较的时序侧信道（与 whatsapp webhook 同口径）。
 */
export function requireSmsHookSecret(req: NextRequest): NextResponse | null {
  const secret = process.env.SMS_HOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "SMS_HOOK_SECRET is not configured" }, { status: 503 });
  }
  const expected = Buffer.from("Bearer " + secret);
  const provided = Buffer.from(req.headers.get("authorization") ?? "");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return apiUnauthorized("Unauthorized hook caller");
  }
  return null;
}
