import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSmsHookSignature } from "@/lib/api-auth";
import { smsProvider } from "@/providers";
import { allowedCountryCodes, buildOtpSms, isAllowedPhone, maskPhone, otpExpireMinutes } from "@/lib/otp";

/**
 * Supabase Auth Hook —— Send SMS。
 *
 * Supabase 生成的验证码不经它自己的短信供应商，而是 POST 到这里，由我们的网关真发。
 * 仪表盘配置：Authentication → Hooks → Send SMS → HTTPS，
 * URL = https://<domain>/api/hooks/send-sms，然后**复制仪表盘生成的 secret**
 * （形如 v1,whsec_<base64>）到 Vercel 环境变量 SMS_HOOK_SECRET。
 *
 * 为什么是本仓库的 API 路由而不是 Supabase Edge Function：
 *  · provider 抽象、验证码文案、审计记账都在这里，Edge Function 等于把它们再抄一遍；
 *  · 一条 Vercel 部署链路（CI / 回滚 / 日志），不必为本功能再维护一个手工 deploy 的面板操作。
 *
 * 鉴权**不是 Bearer token**：GoTrue 实测只发 webhook-id / webhook-timestamp /
 * webhook-signature 三个签名头（Standard Webhooks 规范），不发 Authorization。
 * 所以这里用 requireSmsHookSignature 做 HMAC 验签（含时间戳容差，防重放）。
 *
 * 三条不可退让的规则：
 *  1. **fail-closed 验签**：没配/配错 secret 就 503，绝不放行。
 *     这个路由在 middleware 的公开名单里，它唯一的防线就是那个 secret。
 *  2. **验证码绝不进日志**。日志只出现脱敏号码与供应商回执 id；错误信息也只带技术原因。
 *  3. **只在供应商真的接收后才返回 2xx**。返回 200 而其实没发出去，用户界面会显示
 *     "验证码已发送"然后永远等不到——宁可让 Supabase 把错误透给客户端。
 *
 * 与注册/登录 action 的分工：action 负责"要不要发"（限流、号码归属、shouldCreateUser），
 * 这里负责"真的发出去"并记账。两层都用 src/lib/otp.ts 的同一份判据，避免策略漂移。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SendSmsHookPayload {
  user?: { id?: string; phone?: string };
  sms?: { otp?: string };
}

/**
 * 找出这次发送该挂到哪条审计行上。
 *
 * 注意不能用 status: "REQUESTED" 过滤：GoTrue 失败时会**重试 3 次**
 * （defaultHTTPHookRetries=3，且 payload 在重试循环外生成，所以三次是同一个验证码）。
 * 第一次成功后那行已经变成 SENT，再按 REQUESTED 找就会为每次重试新建一行，
 * 审计表里出现"一条验证码发了 3 次"的假象。因此这里取最近 10 分钟内该号码的最新一行，
 * 无论状态（BLOCKED 除外——那是被拒绝的记录，不该被后续请求改写）。
 */
async function findLatestAttempt(phoneE164: string) {
  return db.otpAttempt.findFirst({
    where: { phoneE164, status: { not: "BLOCKED" }, createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
  });
}

export async function POST(req: NextRequest) {
  // 必须先拿**原始报文**：签名是对 body 字节做的，先 json() 再拿文本就再也对不上了。
  const raw = await req.text();
  const denied = requireSmsHookSignature(req, raw);
  if (denied) return denied;

  let payload: SendSmsHookPayload;
  try {
    payload = JSON.parse(raw) as SendSmsHookPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const phone = payload.user?.phone ?? "";
  const otp = payload.sms?.otp ?? "";
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
    return NextResponse.json({ ok: false, error: "invalid phone" }, { status: 400 });
  }
  if (!/^\d{4,8}$/.test(otp)) {
    return NextResponse.json({ ok: false, error: "invalid otp" }, { status: 400 });
  }

  // 第二道号段防线：action 已经拦过一次，这里再拦一次。
  // 单靠 action 不够——hook 是独立的公开入口，而短信是按条计费的（SMS pumping）。
  if (!isAllowedPhone(phone)) {
    await recordAttempt(phone, null, "BLOCKED", "country not allowed: " + allowedCountryCodes().join(","));
    return NextResponse.json({ ok: false, error: "country not allowed" }, { status: 403 });
  }

  const expireMinutes = otpExpireMinutes();
  const result = await smsProvider.send(phone, buildOtpSms(otp, expireMinutes));

  // 日志只带脱敏号码：+6013****832 / provider / ok / externalId。
  // 这一行是排查"客户说没收到"时唯一的现场，所以必须存在，也必须是脱敏的。
  console.log(
    "[send-sms-hook] " + maskPhone(phone) + " provider=" + smsProvider.name + " ok=" + result.ok +
    (result.externalId ? " id=" + result.externalId : "") + (result.error ? " error=" + result.error : ""),
  );

  await recordAttempt(phone, result.externalId, result.ok ? "SENT" : "FAILED", result.error ?? null);

  if (!result.ok) {
    // 非 2xx 是刻意的：Supabase 会把它变成客户端可见的错误，而不是假装已发送。
    // 用 503 而不是 502：GoTrue 对 503 会重试（最多 3 次，同一个验证码），
    // 对供应商的瞬时抖动这点重试是有用的；硬失败重试也只是多花几秒。
    return NextResponse.json({ ok: false, error: "sms provider failed" }, { status: 503 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}

/**
 * 审计：把这次发送挂到 action 预写的那条 REQUESTED 行上（同一号码、10 分钟内最近一条）。
 * 找不到就新建——**不吞掉**这次发送记录，否则"仪表盘手动触发的 OTP"将完全不留痕。
 */
async function recordAttempt(phoneE164: string, externalId: string | null, status: string, error: string | null) {
  try {
    const pending = await findLatestAttempt(phoneE164);
    if (pending) {
      await db.otpAttempt.update({
        where: { id: pending.id },
        data: { provider: smsProvider.name, externalId, status, error },
      });
      return;
    }
    await db.otpAttempt.create({
      data: { phoneE164, purpose: "HOOK", provider: smsProvider.name, externalId, status, error },
    });
  } catch (e) {
    // 记账失败不能影响发送结果：短信已经发出去了，用户该收到验证码。
    // 但必须留下痕迹，否则这类失败会彻底静默。
    console.error("[send-sms-hook] audit write failed: " + (e instanceof Error ? e.message : String(e)));
  }
}
