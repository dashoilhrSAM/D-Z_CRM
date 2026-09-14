import { NextRequest, NextResponse } from "next/server";
import { sendDueReminders } from "@/actions/reminders";
import { requireCronSecret } from "@/lib/api-auth";

/**
 * Vercel Cron 入口：每日发送到期/逾期服务提醒（§生产功能启用）。
 * 鉴权：Vercel Cron 请求带 Authorization: Bearer $CRON_SECRET（vercel.json crons 配置）。
 * 手动验证：curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/reminders
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // fail-closed：密钥没配就是 503，不是"跳过校验照常群发"。
  // 这是会给真实客户发 WhatsApp 的入口，旧的 `if (secret)` 写法在密钥缺失时等于公开端点。
  const denied = requireCronSecret(req);
  if (denied) return denied;
  try {
    const result = await sendDueReminders();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
