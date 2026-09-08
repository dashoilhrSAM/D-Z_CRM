import Link from "next/link";
import { Users, CalendarClock, Bot, Star, Plug, ShieldCheck, FileUp, MessageSquare, Code2 } from "lucide-react";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { OrgProfileForm, BranchManager, ServiceTypeManager, LostReasonsEditor, MyBranchSettings } from "@/components/workshop/settings-forms";
import { isOrgLevelRole } from "@/lib/branch-scope";
import { QrSettings } from "@/components/workshop/qr-settings";
import { getLang } from "@/lib/get-lang";
import { t, tpl } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const lang = await getLang();
  const session = await getSessionUser();
  // 严格 scope：org 级(OWNER/SUPER_ADMIN/HEAD_OFFICE_ADMIN)管理全部份；branch 级(MANAGER 等)只能看/改自己分行
  const isOrgLevel = session.kind === "staff" && isOrgLevelRole(session.role);
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
    ...(isOrgLevel ? [{ href: "/workshop/integrations", label: t("ws.settings.link.integrations", lang), desc: t("ws.settings.link.integrations-desc", lang), icon: Plug }] : []),
    ...(isOrgLevel ? [{ href: "/workshop/settings/audit-logs", label: t("ws.settings.link.audit", lang), desc: t("ws.settings.link.audit-desc", lang), icon: ShieldCheck }] : []),
    { href: "/workshop/import", label: t("ws.settings.link.import", lang), desc: t("ws.settings.link.import-desc", lang), icon: FileUp },
    ...(isOrgLevel ? [{ href: "/workshop/settings/developer", label: t("ws.settings.link.developer", lang), desc: t("ws.settings.link.developer-desc", lang), icon: Code2 }] : []),
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("ws.settings.title", lang)}</h1>
        <p className="text-sm text-muted-foreground">{t("ws.settings.subtitle", lang)}</p>
      </div>

      {isOrgLevel ? (
        <>
          <div className="grid md:grid-cols-2 gap-5">
            <OrgProfileForm org={{ name: org!.name, contactPhone: org!.contactPhone, contactEmail: org!.contactEmail, address: org!.address, taxId: org!.taxId, timezone: org!.timezone, currency: org!.currency }} />
            <LostReasonsEditor current={org!.lostReasons ?? "[]"} />
          </div>
          <QrSettings orgId={org!.qrToken ?? org!.id} flags={{ enableMotorcycleQr: org!.enableMotorcycleQr, enableRiderProfileQr: org!.enableRiderProfileQr, enableWorkshopQr: org!.enableWorkshopQr }} />
          <BranchManager branches={branches.map((b) => ({ id: b.id, name: b.name, city: b.city, phone: b.phone, address: b.address, isMain: b.isMain, operatingHours: b.operatingHours, appointmentCapacity: b.appointmentCapacity }))} />
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