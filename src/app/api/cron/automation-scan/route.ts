import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/api-auth";
import { runTimeBasedAutomations } from "@/modules/automation/scan";

/**
 * Vercel Cron 入口：每天扫一遍**时间类**的自动化触发器。
 *
 * 为什么需要它：SERVICE_DUE（保养到期）/ BOOKING_APPROACHING（明天要来）/
 * CUSTOMER_INACTIVE（客户流失）不是「某件事发生」型，不能靠事件点触发，
 * 必须每天看一次 —— 在此之前这三种规则在界面上能建、但**永远不会跑** ✗。
 *
 * 鉴权：与其它 cron 一致，Bearer $CRON_SECRET，没配密钥就 503（fail-closed）。
 * 手动验证：curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/automation-scan
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  try {
    const result = await runTimeBasedAutomations();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
