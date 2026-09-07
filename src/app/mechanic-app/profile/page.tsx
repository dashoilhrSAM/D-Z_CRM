import Link from "next/link";
import { Settings as SettingsIcon } from "lucide-react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { AttendanceButton } from "@/components/mechanic/attendance-button";
import { EarningsConfirm } from "@/components/mechanic/earnings-confirm";
import { SignOutIconButton } from "@/components/rider/sign-out-button";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";
import { formatRM } from "@/lib/money";

export const dynamic = "force-dynamic";

/** Mechanic 个人页（参考 rider profile）：头像/名字 + 统计 + 打卡（与 workshop 考勤同步）。 */
export default async function MechanicProfilePage() {
  const lang = await getLang();
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) redirect("/workshop/dashboard");
  const me = session.user;

  const [user, jobs, pendingPayouts, reviews] = await Promise.all([
    db.user.findUnique({ where: { id: me.id }, include: { attendance: { orderBy: { date: "desc" }, take: 1 } } }),
    db.serviceJob.findMany({ where: { mechanicId: me.id, status: "COMPLETED" }, select: { id: true, completedAt: true, commissionSen: true, bonusSen: true } }),
    db.staffPayout.findMany({ where: { userId: me.id, status: "AWAITING_CONFIRM" }, select: { id: true, period: true, periodStart: true, totalSen: true }, orderBy: { createdAt: "desc" } }),
    db.review.aggregate({ _avg: { rating: true }, _count: true, where: { job: { mechanicId: me.id }, rating: { not: null } } }),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) + "T00:00:00Z";
  const todayAtt = user?.attendance.find((a) => a.date.toISOString().slice(0, 10) === today.slice(0, 10));
  // 最后动作判定：有 in 且（无 out 或 in 晚于 out）→ ON DUTY（当天可多次打卡）
  const lastIn = todayAtt?.checkInAt;
  const lastOut = todayAtt?.checkOutAt;
  const status = !lastIn ? { state: "NOT_CHECKED" as const, checkInAt: null, checkOutAt: null }
    : !lastOut || lastIn > lastOut ? { state: "ON_DUTY" as const, checkInAt: lastIn.toISOString(), checkOutAt: null }
    : { state: "OFF" as const, checkInAt: lastIn.toISOString(), checkOutAt: lastOut.toISOString() };

  const completed = jobs.length;
  const earnings = jobs.reduce((s, j) => s + (j.commissionSen ?? 1000), 0);
  const bonus = jobs.reduce((s, j) => s + (j.bonusSen ?? 0), 0);
  const avgEarnings = completed > 0 ? Math.round(earnings / completed) : 0;
  const rating = reviews._avg.rating ?? 0;
  const initials = me.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  // 月度工作统计（近 12 个月完成工单，+8 业务月）
  const now = new Date();
  const ymdNow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit" }).format(now).split("-").map(Number);
  const [cy, cm] = ymdNow as [number, number];
  const monthStats: { key: string; label: string; count: number; earningsSen: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const m = cm - i;
    const yy = cy + Math.floor((m - 1) / 12);
    const mm = ((m - 1) % 12 + 12) % 12 + 1;
    monthStats.push({ key: yy + "-" + mm, label: yy + "/" + String(mm).padStart(2, "0"), count: 0, earningsSen: 0 });
  }
  const byMonth = new Map<string, { count: number; earningsSen: number }>();
  for (const j of jobs) {
    if (!j.completedAt) continue;
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit" }).format(j.completedAt);
    const cur = byMonth.get(ymd) ?? { count: 0, earningsSen: 0 };
    cur.count += 1;
    cur.earningsSen += j.commissionSen ?? 1000;
    byMonth.set(ymd, cur);
  }
  for (const ms of monthStats) {
    const cur = byMonth.get(ms.key);
    ms.count = cur?.count ?? 0;
    ms.earningsSen = cur?.earningsSen ?? 0;
  }
  const maxMonth = Math.max(...monthStats.map((m) => m.count), 1);

  return (
    <div className="space-y-4">
      {/* 头像 + 名字（rider profile 风格） */}
      <div className="relative">
        <div className="absolute right-0 top-0 flex items-center gap-2">
          <SignOutIconButton href="/mechanic-app/login" title={t("mech.signout", lang)} />
          <Link href="/mechanic-app/settings" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted/60 text-muted-foreground hover:bg-muted" aria-label={t("settings.title", lang)}>
            <SettingsIcon className="h-4 w-4" />
          </Link>
        </div>
      </div>
      <div className="text-center">
        <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">{initials}</span>
        <h1 className="mt-3 text-xl font-bold">{me.name}</h1>
        <p className="text-sm text-muted-foreground">{t("mech.app", lang)} · {me.email ?? ""}</p>
      </div>

      {/* 统计卡 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border bg-card p-4 text-center">
          <div className="text-2xl font-bold tabular-nums">{completed}</div>
          <div className="text-xs text-muted-foreground">{t("mech.jobs-completed", lang)}</div>
        </div>
        <div className="rounded-2xl border bg-card p-4 text-center">
          <div className="text-2xl font-bold tabular-nums">{formatRM(earnings)}</div>
          <div className="text-xs text-muted-foreground">{t("mech.total-commission", lang)}</div>
        </div>
        <div className="rounded-2xl border bg-card p-4 text-center">
          <div className="text-2xl font-bold tabular-nums">{formatRM(bonus)}</div>
          <div className="text-xs text-muted-foreground">{t("mech.total-bonus", lang)}</div>
        </div>
      </div>

      {/* 发薪通知（双向确认第 1 步） */}
      {pendingPayouts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-400">{t("mech.payment-confirm", lang).replace("{n}", String(pendingPayouts.length))}</h3>
          <EarningsConfirm payouts={pendingPayouts.map((p) => ({ id: p.id, period: p.period, periodStart: p.periodStart.toISOString(), totalSen: p.totalSen }))} />
        </div>
      )}

      {/* 打卡（与 workshop OS 考勤同步） */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="mb-2 text-sm font-semibold">{t("mech.attendance", lang)}</div>
        <AttendanceButton status={status} lang={lang} />
        <p className="mt-2 text-[11px] text-muted-foreground">{t("mech.synced", lang)}</p>
      </div>

      {/* 工作统计 */}
      <div className="rounded-2xl border bg-card p-4">
        <h3 className="font-semibold mb-3">{t("mech.stats-title", lang)}</h3>
        {/* 汇总 */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="rounded-xl bg-muted/50 p-3 text-center">
            <div className="text-lg font-bold tabular-nums">{completed}</div>
            <div className="text-[10px] text-muted-foreground">{t("mech.jobs", lang)}</div>
          </div>
          <div className="rounded-xl bg-muted/50 p-3 text-center">
            <div className="text-lg font-bold tabular-nums">{formatRM(avgEarnings)}</div>
            <div className="text-[10px] text-muted-foreground">{t("mech.avg-earnings", lang)}</div>
          </div>
          <div className="rounded-xl bg-muted/50 p-3 text-center">
            <div className="text-lg font-bold tabular-nums">{rating ? rating.toFixed(1) : "—"}</div>
            <div className="text-[10px] text-muted-foreground">{t("mech.rating-star", lang)}</div>
          </div>
        </div>
        {/* 月度趋势 */}
        <div className="text-xs font-semibold text-muted-foreground mb-2">{t("mech.monthly-jobs", lang)}</div>
        <div className="space-y-1.5">
          {monthStats.map((ms) => (
            <div key={ms.key} className="flex items-center gap-2 text-[11px]">
              <span className="w-14 shrink-0 font-mono text-muted-foreground">{ms.label}</span>
              <div className="h-4 flex-1 rounded bg-muted/50 overflow-hidden">
                <div className="h-full rounded bg-primary/80" style={{ width: Math.max(2, (ms.count / maxMonth) * 100) + "%" }} />
              </div>
              <span className="w-20 shrink-0 text-right text-muted-foreground">{ms.count} · {formatRM(ms.earningsSen)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
