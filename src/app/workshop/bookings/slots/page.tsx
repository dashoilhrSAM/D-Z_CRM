import { db } from "@/lib/db";
import { SlotManager, SlotRowActions } from "@/components/workshop/slot-manager";
import { fmtDate } from "@/lib/format";
import { getLang } from "@/lib/get-lang";
import { getSessionUser } from "@/lib/session-user";
import { scopedBranchId } from "@/lib/branch-scope";
import { t, tpl } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function SlotsPage() {
  const lang = await getLang();
  const org = await db.organisation.findFirst();
  const branches = await db.branch.findMany({ where: { organisationId: org!.id } });
  const session = await getSessionUser();
  // 严格隔离：branch 级用户只看本分行时段；org 级看全部
  const scopeId = scopedBranchId(session);
  const scopedBranches = scopeId ? branches.filter((b) => b.id === scopeId) : branches;
  const slots = await db.appointmentSlot.findMany({
    where: { branchId: { in: scopedBranches.map((b) => b.id) } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    include: { branch: { select: { id: true, name: true, city: true } } },
    take: 300,
  });
  const stats = {
    total: slots.length,
    holidays: slots.filter((s) => s.isHoliday).length,
    full: slots.filter((s) => !s.isHoliday && s.bookedCount >= s.maxBookings).length,
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t("slot.title", lang)}</h1>
        <p className="text-sm text-muted-foreground">{tpl("slot.stats", lang, { total: stats.total, full: stats.full, holidays: stats.holidays })}</p>
      </div>
      <SlotManager branches={branches.map((b) => ({ id: b.id, label: b.name + " · " + b.city }))} />
      <div className="rounded-xl border bg-card overflow-x-auto">
        <table className="dz-table">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2.5 font-medium">{t("slot.col-branch", lang)}</th><th className="px-3 py-2.5 font-medium">{t("slot.col-date", lang)}</th><th className="px-3 py-2.5 font-medium">{t("slot.col-time", lang)}</th><th className="px-3 py-2.5 font-medium">{t("slot.col-capacity", lang)}</th><th className="px-3 py-2.5 font-medium">{t("slot.col-status", lang)}</th><th className="px-3 py-2.5 font-medium"></th></tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <tr key={s.id} className="border-t hover:bg-muted/40">
                <td className="px-3 py-2 text-xs">{s.branch.city}</td>
                <td className="px-3 py-2 text-xs">{fmtDate(s.date)}</td>
                <td className="px-3 py-2 text-xs">{s.startTime}</td>
                <td className="px-3 py-2 text-xs">{s.bookedCount}/{s.maxBookings}</td>
                <td className="px-3 py-2 text-xs">
                  {s.isHoliday ? <span className="rounded-full bg-destructive/10 text-destructive px-2 py-0.5">{t("slot.holiday", lang)}</span> : s.bookedCount >= s.maxBookings ? <span className="rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300 px-2 py-0.5">{t("slot.full", lang)}</span> : <span className="rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 px-2 py-0.5">{t("slot.open", lang)}</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  <SlotRowActions slotId={s.id} maxBookings={s.maxBookings} isHoliday={s.isHoliday} />
                </td>
              </tr>
            ))}
            {slots.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">{t("slot.empty", lang)}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}