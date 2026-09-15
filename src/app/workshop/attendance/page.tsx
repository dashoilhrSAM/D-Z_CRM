import { PageHeader } from "@/components/shared/page-header";
import { AttendancePanel, type StaffStatus } from "@/components/workshop/attendance-panel";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { scopedBranchId } from "@/lib/branch-scope";
import { businessDayUtc, safeTimezone } from "@/lib/business-day";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * 考勤（HRM P1）：全员打卡 + 当日状态 + 证据。
 *
 * 这里**不再只列技师**——原来硬过滤 role: "MECHANIC"，把柜台、销售、行政全挡在外面，
 * 而老板真正要看的是"今天谁在店里"。分行隔离照旧：分行级角色只看本店，
 * org 级角色（OWNER 等）看全部（scopedBranchId 对 org 级返回 null）。
 */
export default async function AttendancePage() {
  const lang = await getLang();
  const session = await getSessionUser();
  const org = await db.organisation.findFirst();
  const today = businessDayUtc(new Date(), safeTimezone(org?.timezone));
  const branchScope = scopedBranchId(session);

  const users = await db.user.findMany({
    where: {
      organisationId: org!.id,
      active: true,
      ...(branchScope ? { branchId: branchScope } : {}),
    },
    select: {
      id: true,
      name: true,
      role: true,
      branch: { select: { name: true } },
      attendance: {
        where: { date: today },
        select: { checkInAt: true, checkOutAt: true, workedMinutes: true, exceptionCount: true, status: true },
      },
      attendancePunches: {
        where: { businessDate: today },
        orderBy: { at: "asc" },
        select: { id: true, kind: true, at: true, verdict: true, distanceM: true },
      },
    },
    orderBy: { name: "asc" },
  });

  const rows: StaffStatus[] = users.map((u) => {
    const day = u.attendance[0];
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      branchName: u.branch?.name ?? null,
      checkInAt: day?.checkInAt?.toISOString() ?? null,
      checkOutAt: day?.checkOutAt?.toISOString() ?? null,
      workedMinutes: day?.workedMinutes ?? 0,
      exceptionCount: day?.exceptionCount ?? 0,
      status: day?.status ?? (u.attendancePunches.length ? "INCOMPLETE" : "PRESENT"),
      punches: u.attendancePunches.map((p) => ({
        id: p.id,
        kind: p.kind,
        at: p.at.toISOString(),
        verdict: p.verdict,
        distanceM: p.distanceM ?? null,
      })),
    };
  });

  return (
    <div>
      <PageHeader title={t("att.title", lang)} subtitle={t("att.subtitle", lang)} />
      <AttendancePanel
        staff={rows}
        currentUserId={session.kind === "staff" && session.user ? session.user.id : ""}
        lang={lang}
      />
    </div>
  );
}
