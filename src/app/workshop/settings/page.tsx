import Link from "next/link";
import { Users, CalendarClock, Bot, Star, Plug, ShieldCheck, FileUp, MessageSquare, Code2, QrCode } from "lucide-react";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { OrgProfileForm, BranchManager, ServiceTypeManager, LostReasonsEditor, MyBranchSettings } from "@/components/workshop/settings-forms";
import { isOrgLevelRole, canManageOrgSettings } from "@/lib/branch-scope";
import { QrSettings } from "@/components/workshop/qr-settings";
import { AttendancePolicyPanel } from "@/components/workshop/attendance-policy-panel";
import { getLang } from "@/lib/get-lang";
import { QrToggle } from "@/components/shared/qr-toggle";
import { workshopQrUrl } from "@/lib/qr";
import { t, tpl } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const lang = await getLang();
  const session = await getSessionUser();
  // 两条轴，别再合并（2026-09-17 owner 要求「manager 有跟 owner 一样的后台权限，但数据仍限本店」）：
  //  · isOrgLevel    = **数据范围**：看得到/改得了别的分店吗（只 org 级）
  //  · fullBackOffice = **功能开关**：能不能用总部级后台功能（含 MANAGER）
  // 下面凡是"列哪些数据"用 isOrgLevel，"显示哪些表单/入口"用 fullBackOffice。
  const isOrgLevel = session.kind === "staff" && isOrgLevelRole(session.role);
  const fullBackOffice = session.kind === "staff" && canManageOrgSettings(session.role);
  const org = await db.organisation.findFirst();
  const myBranch = session.branchId ? await db.branch.findUnique({ where: { id: session.branchId } }) : null;
  const organs = myBranch ? [myBranch] : [];
  const branches = isOrgLevel
    ? await db.branch.findMany({ where: { organisationId: org!.id }, orderBy: { isMain: "desc" } })
    : organs;
  const serviceTypes = await db.serviceType.findMany({ where: { organisationId: org!.id }, orderBy: { name: "asc" } });
  const users = isOrgLevel
    ? await db.user.findMany({ where: { organisationId: org!.id, active: true }, orderBy: { name: "asc" } })
    : session.branchId ? await db.user.findMany({ where: { branchId: session.branchId, active: true }, orderBy: { name: "asc" } }) : [];
  const links = [
    { href: "/workshop/staff", label: t("ws.settings.link.staff", lang), desc: tpl("ws.settings.link.staff-desc", lang, { n: users.length }), icon: Users },
    { href: "/workshop/bookings/slots", label: t("ws.settings.link.slots", lang), desc: t("ws.settings.link.slots-desc", lang), icon: CalendarClock },
    { href: "/workshop/automations", label: t("ws.settings.link.automations", lang), desc: t("ws.settings.link.automations-desc", lang), icon: Bot },
    { href: "/workshop/messaging/templates", label: t("ws.settings.link.templates", lang), desc: t("ws.settings.link.templates-desc", lang), icon: MessageSquare },
    { href: "/workshop/loyalty", label: t("ws.settings.link.loyalty", lang), desc: t("ws.settings.link.loyalty-desc", lang), icon: Star },
    ...(fullBackOffice ? [{ href: "/workshop/integrations", label: t("ws.settings.link.integrations", lang), desc: t("ws.settings.link.integrations-desc", lang), icon: Plug }] : []),
    ...(fullBackOffice ? [{ href: "/workshop/settings/audit-logs", label: t("ws.settings.link.audit", lang), desc: t("ws.settings.link.audit-desc", lang), icon: ShieldCheck }] : []),
    { href: "/workshop/import", label: t("ws.settings.link.import", lang), desc: t("ws.settings.link.import-desc", lang), icon: FileUp },
    // Developer（角色×模块矩阵编辑器）**刻意不给 MANAGER**：改矩阵 = 给自己加权限，是一条自提权路径。
    // 「后台功能跟 owner 一样」不等于「能把提权入口也交出去」。
    ...(isOrgLevel ? [{ href: "/workshop/settings/developer", label: t("ws.settings.link.developer", lang), desc: t("ws.settings.link.developer-desc", lang), icon: Code2 }] : []),
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("ws.settings.title", lang)}</h1>
        <p className="text-sm text-muted-foreground">{t("ws.settings.subtitle", lang)}</p>
      </div>

      {fullBackOffice ? (
        <>
          <div className="grid md:grid-cols-2 gap-5">
            <OrgProfileForm org={{ name: org!.name, contactPhone: org!.contactPhone, contactEmail: org!.contactEmail, address: org!.address, taxId: org!.taxId, timezone: org!.timezone, currency: org!.currency }} />
            <LostReasonsEditor current={org!.lostReasons ?? "[]"} />
          </div>
          <QrSettings orgId={org!.qrToken ?? org!.id} flags={{ enableMotorcycleQr: org!.enableMotorcycleQr, enableRiderProfileQr: org!.enableRiderProfileQr, enableWorkshopQr: org!.enableWorkshopQr }} />
          <div className="rounded-2xl border bg-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <QrCode className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">{t("qr-settings.branch-qrs", lang)}</h2>
            </div>
            {branches.length === 0 && <p className="text-sm text-muted-foreground">暂无分店 No branches</p>}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {branches.map((b) => (
                <div key={b.id} className="flex flex-col items-center gap-2 rounded-xl border p-3">
                  <div className="text-center text-sm font-medium">{b.name}</div>
                  <QrToggle value={workshopQrUrl(org!.qrToken ?? org!.id, b.id)} label={b.name} defaultShow={false} size={88} />
                </div>
              ))}
            </div>
          </div>
          {/* 店名/城市是门店身份，只有 org 级能改（updateBranch 对非 org 会**静默忽略**这两个字段）——
              所以非 org 时不渲染输入框，避免"填了、保存成功、但没变"这种静默失败。 */}
          <BranchManager
            canEditIdentity={isOrgLevel}
            branches={branches.map((b) => ({ id: b.id, name: b.name, city: b.city, phone: b.phone, address: b.address, isMain: b.isMain, operatingHours: b.operatingHours, appointmentCapacity: b.appointmentCapacity, latitude: b.latitude, longitude: b.longitude }))}
          />
          <AttendancePolicyPanel
            values={{
              photoRequired: org!.attendancePhotoRequired,
              geoRequired: org!.attendanceGeoRequired,
              geofenceM: org!.attendanceGeofenceM,
              accuracyMaxM: org!.attendanceAccuracyMaxM,
            }}
          />
          <ServiceTypeManager serviceTypes={serviceTypes.map((s) => ({ id: s.id, name: s.name, category: s.category, durationMin: s.durationMin, priceSen: s.priceSen, active: s.active }))} />
        </>
      ) : (
        <>
          {myBranch && <MyBranchSettings branch={{ id: myBranch.id, name: myBranch.name, city: myBranch.city, phone: myBranch.phone, address: myBranch.address, operatingHours: myBranch.operatingHours, appointmentCapacity: myBranch.appointmentCapacity }} />}
          <QrSettings orgId={org!.qrToken ?? org!.id} flags={{ enableMotorcycleQr: org!.enableMotorcycleQr, enableRiderProfileQr: org!.enableRiderProfileQr, enableWorkshopQr: org!.enableWorkshopQr }} showToggles={false} />
        </>
      )}

      <div>
        <h2 className="font-semibold mb-3">{t("ws.settings.config-hubs", lang)}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-xl border bg-card p-4 hover:border-primary/40 transition-colors">
              <l.icon className="h-5 w-5 text-primary" />
              <div className="font-medium text-sm mt-2">{l.label}</div>
              <div className="text-[11px] text-muted-foreground">{l.desc}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}