import { PageHeader } from "@/components/shared/page-header";
import { db } from "@/lib/db";
import { StaffManager } from "@/components/workshop/staff-manager";
import { getLang } from "@/lib/get-lang";
import { getSessionUser } from "@/lib/session-user";
import { applyBranchScope } from "@/lib/branch-scope";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const lang = await getLang();
  const session = await getSessionUser();
  const staff = await db.user.findMany({
    where: applyBranchScope({}, session, null),
    select: { id: true, name: true, role: true, phone: true, email: true, active: true, createdAt: true, _count: { select: { jobs: true } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return (
    <div>
      <PageHeader title={t("ws.staff.title", lang)} subtitle={t("ws.staff.subtitle", lang).replace("{n}", String(staff.length))} />
      <StaffManager canManage={["SUPER_ADMIN","OWNER","HEAD_OFFICE_ADMIN","MANAGER","MECHANIC"].includes(session.role)} staff={staff.map((s) => ({ id: s.id, name: s.name, role: s.role, phone: s.phone, email: s.email, active: s.active, jobCount: s._count.jobs }))} />
    </div>
  );
}