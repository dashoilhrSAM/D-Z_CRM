import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/api-auth";
import { autoGrantAllOrganisations } from "@/modules/commission/auto-grant";

/**
 * Vercel Cron 入口：每月 1 日补发上一个窗口里【达标但未领取】的阶梯奖励（设计稿 §3.4 方案甲）。
 *
 * 为什么需要它：技师面板上写着「每月结束时仍未领取的奖励会自动补发」——
 * **那句话必须有东西去执行**，否则界面在承诺一件没人做的事（这是最难发现的一类缺陷：
 * 界面看着对、测试全绿、而钱就是没发）。
 *
 * 幂等：CommissionClaim 的 (userId, tierId, windowKey) 唯一键兜住 ——
 * 这个 cron 多跑几次、或与技师手动领取撞在一起，都不会重复发。
 *
 * 鉴权：Vercel Cron 带 Authorization: Bearer $CRON_SECRET；缺密钥即 503（fail-closed）。
 * 手动验证：curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/commission-tiers
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  try {
    const result = await autoGrantAllOrganisations(new Date());
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
