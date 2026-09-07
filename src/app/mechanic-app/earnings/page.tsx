import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { EarningsConfirm } from "@/components/mechanic/earnings-confirm";
import { getLang } from "@/lib/get-lang";
import { t, tpl } from "@/lib/i18n";
import { formatRM } from "@/lib/money";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Mechanic 收入：完成 job + 发薪确认（双向）+ 历史。 */
export default async function EarningsPage() {
  const lang = await getLang();
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) redirect("/workshop/dashboard");

  const [jobs, payouts] = await Promise.all([
    db.serviceJob.findMany({
      where: { mechanicId: session.user.id, status: "COMPLETED" },
      include: { motorcycle: { select: { brand: true, model: true, plate: true } }, invoice: { select: { totalSen: true } } },
      orderBy: { completedAt: "desc" },
      take: 50,
    }),
    db.staffPayout.findMany({
      where: { userId: session.user.id },
      include: { payments: { select: { amountSen: true, method: true, paidAt: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const pending = payouts.filter((p) => p.status !== "PAID");
  const done = payouts.filter((p) => p.status === "PAID");
  const totalCommission = jobs.reduce((s, j) => s + (j.commissionSen ?? 0), 0);
  const totalBonus = payouts.reduce((s, p) => s + p.bonusSen, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t("mech.my-earnings", lang)}</h1>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border bg-card p-4">
          <div className="text-[11px] text-muted-foreground">{t("mech.jobs-completed", lang)}</div>
          <div className="mt-1 text-2xl font-bold">{jobs.length}</div>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="text-[11px] text-muted-foreground">{t("mech.total-commission", lang)}</div>
          <div className="mt-1 text-2xl font-bold">{formatRM(totalCommission)}</div>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="text-[11px] text-muted-foreground">{t("mech.total-bonus", lang)}</div>
          <div className="mt-1 text-2xl font-bold">{formatRM(totalBonus)}</div>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-400">{tpl("mech.payment-confirm", lang, { n: pending.length })}</h3>
          <EarningsConfirm payouts={pending.map((p) => ({ id: p.id, period: p.period, periodStart: p.periodStart.toISOString(), totalSen: p.totalSen }))} />
        </div>
      )}

      <div className="rounded-2xl border bg-card p-4">
        <h3 className="font-semibold mb-2">{t("mech.completed-jobs", lang)}</h3>
        {jobs.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">{t("mech.no-completed", lang)}</p>}
        <div className="space-y-1.5">
          {jobs.map((j) => (
            <div key={j.id} className="flex items-center justify-between text-sm">
              <div>
                <span className="font-mono text-xs font-semibold text-primary">{j.jobNumber}</span>
                <span className="ml-2 text-muted-foreground">{j.motorcycle.brand} {j.motorcycle.model} · {j.motorcycle.plate}</span>
              </div>
              <span className="text-[11px] text-muted-foreground mr-1">{t("mech.commission", lang)}</span><span className="tabular-nums font-semibold">{formatRM(j.commissionSen ?? 0)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-4">
        <h3 className="font-semibold mb-2">{t("mech.payment-history", lang)}</h3>
        {done.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">{t("mech.no-payments", lang)}</p>}
        <div className="space-y-1.5">
          {done.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-sm">
              <div>
                <span className="text-muted-foreground">{p.period} · {fmtDate(p.periodStart)}</span>
              </div>
              <span className="tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{formatRM(p.totalSen)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}