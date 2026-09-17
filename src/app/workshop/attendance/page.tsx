import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { AttendancePanel } from "@/components/workshop/attendance-panel";
import { AttendanceRangePicker } from "@/components/workshop/attendance-range-picker";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { scopedBranchId, isOrgLevelRole } from "@/lib/branch-scope";
import { safeTimezone } from "@/lib/business-day";
import { can } from "@/lib/auth/permissions";
import { resolveRange } from "@/modules/attendance/range";
import { loadAttendanceReport } from "@/modules/attendance/report";
import { rollupDay } from "@/modules/attendance/policy";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * 考勤（HRM P1 打卡 + P2 台账/处置）。
 *
 * P2 补上的是 P1 缺的最后一环：P1 把证据链记全了，但看板只有「今天」，
 * 而且异常只是一个没人能清掉的数字。现在：
 *  · 区间可选（今天 / 本周 / 本月 / 自定义），并可导出 CSV 给财务算工资；
 *  · 异常进队列，有 ATTENDANCE:edit 的人逐笔「判定成立 / 判定不成立」，留痕不覆盖原始记录。
 *
 * 分行隔离照旧：分行级角色只看本店，org 级角色（OWNER 等）看全部。
 * **列出作用域内的所有人**（含区间内一条记录都没有的）——报表第一个要回答的问题
 * 往往就是「这周谁没来」，不出现的人答不了这个问题。
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const lang = await getLang();
  const sp = await searchParams;
  const session = await getSessionUser();
  const org = await db.organisation.findFirst();
  if (!org) return null;

  const timezone = safeTimezone(org.timezone);
  const range = resolveRange({ preset: sp.preset, from: sp.from, to: sp.to, timezone });
  const branchScope = scopedBranchId(session);

  // 只取 id/role/orgId，避免在 User | Customer 的联合类型上做窄化
  const me = session.kind === "staff" && session.user
    ? { id: session.user.id, name: session.name, role: session.role, organisationId: session.orgId, branchId: session.branchId }
    : null;

  const report = await loadAttendanceReport({ organisationId: org.id, branchId: branchScope }, range);

  // 本人「今天」的状态**与所选区间无关**：打卡按钮说的是此刻，不是「你选中的那段时间」
  const today = resolveRange({ preset: "today", timezone });
  const todayFrom = today.from;
  const todayPunches = me
    ? await db.attendancePunch.findMany({
        where: { userId: me.id, businessDate: todayFrom },
        select: { kind: true, at: true, verdict: true },
        orderBy: { at: "asc" },
      })
    : [];
  const todayRoll = rollupDay(todayPunches);

  const permissions = me ? { id: me.id, role: me.role as never, organisationId: me.organisationId } : null;
  const canReview = permissions ? await can(permissions, "ATTENDANCE", "edit") : false;
  const canExport = permissions ? await can(permissions, "ATTENDANCE", "export") : false;

  // 本店还没填坐标时，所有打卡都会记成 NO_GEOFENCE —— 让能改设置的人一眼看到原因，
  // 而不是以为「考勤坏了」。
  const branchMissingCoords = session.branchId
    ? !(await db.branch.count({ where: { id: session.branchId, latitude: { not: null }, longitude: { not: null } } }))
    : false;
  const showGeofenceHint = branchMissingCoords && session.kind === "staff" && isOrgLevelRole(session.role);

  return (
    <div>
      <PageHeader title={t("att.title", lang)} subtitle={t("att.subtitle", lang)} />
      {showGeofenceHint && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200" data-testid="attendance-geofence-hint">
          {t("att.geofence-missing-hint", lang)}{" "}
          <Link href="/workshop/settings" className="font-semibold underline">
            {t("ws.settings.title", lang)}
          </Link>
        </div>
      )}

      <div className="space-y-4">
        <AttendanceRangePicker
          preset={range.preset}
          fromKey={range.fromKey}
          toKey={range.toKey}
          clamped={range.clamped}
          canExport={canExport}
          lang={lang}
        />
        <AttendancePanel
          staff={report.staff}
          totals={report.totals}
          reviewQueue={report.reviewQueue}
          reviewQueueTotal={report.reviewQueueTotal}
          reviewQueueTruncated={report.reviewQueueTruncated}
          days={range.days}
          todayKey={today.fromKey}
          selfToday={
            me
              ? {
                  checkInAt: todayRoll.checkInAt?.toISOString() ?? null,
                  workedMinutes: todayRoll.workedMinutes,
                  onDuty: todayRoll.status === "INCOMPLETE",
                }
              : null
          }
          selfName={me?.name ?? ""}
          currentUserId={me?.id ?? ""}
          canReview={canReview}
          lang={lang}
        />
      </div>
    </div>
  );
}
