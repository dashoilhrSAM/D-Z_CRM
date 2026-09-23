import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { expireDueDocuments } from "@/modules/documents/service";

export const dynamic = "force-dynamic";

/**
 * 每日到期扫描（P1）。
 *
 * 只把到期的文档标成 EXPIRED + 给 org 级账号发一条通知；
 * **不硬删** —— 硬删是 P4 的事，而且必须有人在场（这一步错了回不来）。
 */
export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  try {
    const organisations = await db.organisation.findMany({ select: { id: true } });
    let expired = 0;
    let notified = 0;
    for (const o of organisations) {
      const r = await expireDueDocuments({ organisationId: o.id });
      expired += r.expired;
      notified += r.notified;
    }
    return NextResponse.json({ ok: true, organisations: organisations.length, expired, notified });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
