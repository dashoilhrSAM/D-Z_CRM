import { NextRequest, NextResponse } from "next/server";
import { seedOccasions, openWindowCount } from "@/modules/marketing/occasion-seed";
import { db } from "@/lib/db";

/**
 * Vercel Cron 入口：每月把马来西亚内容日历向前滚动。
 *
 * WHY THIS EXISTS
 * ---------------
 * The calendar is not static data. Paydays are generated from the current month, so the
 * horizon it was seeded with is the horizon the planner has — seed it by hand once and
 * eighteen months later the Content Studio quietly has nothing to suggest. That is the
 * same silent emptiness that made production look broken when the tables existed and were
 * empty: nothing errors, the screen is just blank.
 *
 * The seed is idempotent, so running it monthly costs nothing and never duplicates.
 *
 * 鉴权：Vercel Cron 请求带 Authorization: Bearer $CRON_SECRET（vercel.json crons 配置）。
 * 手动验证：curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/marketing-calendar
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== "Bearer " + secret) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }
  try {
    const now = new Date();
    const res = await seedOccasions(now);
    const openNow = openWindowCount(
      await db.occasion.findMany({ where: { active: true }, select: { startDate: true, endDate: true, leadDays: true } }),
      now,
    );
    // Reported because it is the number that says whether the planner has anything to
    // work with today, and zero is a legitimate answer rather than a failure.
    return NextResponse.json({ ok: true, ...res, openWindows: openNow });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
