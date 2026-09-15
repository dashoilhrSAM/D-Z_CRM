"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { AttendancePunch } from "@/components/shared/attendance-punch";
import { PunchDetailDialog, locationSummary, type PunchDetail } from "@/components/workshop/punch-detail-dialog";
import { t, tpl } from "@/lib/i18n";
import { fmtTime } from "@/lib/format";
import type { Lang } from "@/lib/i18n";

export type PunchEvidence = PunchDetail;

export interface StaffStatus {
  id: string;
  name: string;
  role: string;
  branchName: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  workedMinutes: number;
  exceptionCount: number;
  status: string;
  punches: PunchEvidence[];
}

/** verdict → i18n 键后缀（服务端常量是 SUSPECT_REUSE 这种，键是 att.verdict-suspect-reuse）。 */
const verdictKey = (v: string) => v.toLowerCase().replace(/_/g, "-");

/** 结论的颜色：正常=绿，配置缺口=灰（不该怪人），其余=琥珀（待人确认）。 */
function verdictTone(verdict: string): string {
  if (verdict === "OK") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300";
  if (verdict === "NO_GEOFENCE") return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300";
}

/**
 * 考勤面板：本人打卡（拍照 + 定位）+ 全员当日状态与证据。
 *
 * 两件事是刻意的：
 *  · **地点直接显示在行上**（距门店多少米 / 未取到定位），不用悬停才发现——老板扫一眼
 *    就要能看出"人是不是在店里」，藏进 title 属性等于没显示；
 *  · 点证据条打开**详情弹窗**（照片 + 时间 + 地点 + 判定 + 右上角关闭），
 *    而不是像原来那样直接跳到一个裸照片：单独一张照片判断不了任何事。
 */
export function AttendancePanel({ staff, currentUserId, lang }: { staff: StaffStatus[]; currentUserId: string; lang: Lang }) {
  const router = useRouter();
  const [open, setOpen] = useState<{ punch: PunchEvidence; name: string } | null>(null);
  const me = staff.find((s) => s.id === currentUserId);
  const onDuty = !!me && me.status === "INCOMPLETE";

  // 在岗置顶，其余按名字
  const sorted = [...staff].sort((a, b) => {
    const aOn = a.status === "INCOMPLETE" ? 1 : 0;
    const bOn = b.status === "INCOMPLETE" ? 1 : 0;
    if (aOn !== bOn) return bOn - aOn;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-4">
      {me && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">
                {me.name} <span className="text-xs text-muted-foreground">{t("att.you", lang)}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {onDuty ? (
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    {tpl("att.on-duty-since", lang, { time: me.checkInAt ? fmtTime(new Date(me.checkInAt)) : "" })}
                  </span>
                ) : me.checkInAt ? (
                  tpl("att.worked-today", lang, { m: String(me.workedMinutes) })
                ) : (
                  t("att.not-checked", lang)
                )}
              </div>
            </div>
            <AttendancePunch kind={onDuty ? "OUT" : "IN"} lang={lang} />
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="border-b bg-muted/30 px-4 py-3">
          <div className="font-semibold">{t("att.board-title", lang)}</div>
          <div className="text-xs text-muted-foreground">{t("att.board-subtitle", lang)}</div>
        </div>
        {sorted.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">{t("att.no-staff", lang)}</div>}
        <div className="divide-y divide-border/60">
          {sorted.map((s) => {
            const on = s.status === "INCOMPLETE";
            // 行上显示的是**最近一笔**打卡的地点：那才是"他现在在哪"的答案
            const latest = s.punches.length ? s.punches[s.punches.length - 1] : null;
            return (
              <div key={s.id} className="px-4 py-3" data-testid={"attendance-row-" + s.id}>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-semibold text-primary">
                    {s.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {s.name}
                      {s.id === currentUserId ? " (" + t("att.you", lang) + ")" : ""}
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">{s.role.replace(/_/g, " ")}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      <span>
                        {s.checkInAt
                          ? tpl("att.in-out-line", lang, {
                              in: fmtTime(new Date(s.checkInAt)),
                              out: s.checkOutAt ? fmtTime(new Date(s.checkOutAt)) : "—",
                            }) + (s.workedMinutes > 0 ? " · " + tpl("att.minutes", lang, { m: String(s.workedMinutes) }) : "")
                          : t("att.not-checked", lang)}
                      </span>
                      {latest && (
                        <span
                          className={
                            "inline-flex items-center gap-1 " +
                            (latest.lat == null ? "text-amber-700 dark:text-amber-300" : "text-foreground/70")
                          }
                          data-testid={"attendance-row-location-" + s.id}
                        >
                          <MapPin className="h-3 w-3" />
                          {locationSummary(latest, lang)}
                        </span>
                      )}
                    </div>
                  </div>
                  {s.exceptionCount > 0 && (
                    <span
                      className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                      data-testid={"attendance-exceptions-" + s.id}
                    >
                      {tpl("att.exceptions", lang, { n: String(s.exceptionCount) })}
                    </span>
                  )}
                  <span
                    className={
                      "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold " +
                      (on
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")
                    }
                  >
                    {on ? t("att.on-duty", lang) : s.checkInAt ? t("att.checked-out", lang) : t("att.not-checked", lang)}
                  </span>
                </div>

                {/* 证据条：点开是详情弹窗（照片 + 时间 + 地点 + 判定） */}
                {s.punches.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2 pl-12">
                    {s.punches.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setOpen({ punch: p, name: s.name })}
                        data-testid={"punch-chip-" + p.id}
                        data-punch-id={p.id}
                        className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] hover:bg-accent"
                      >
                        <span className="font-semibold">{p.kind === "IN" ? t("att.in", lang) : t("att.out", lang)}</span>
                        <span className="tabular-nums text-muted-foreground">{fmtTime(new Date(p.at))}</span>
                        <span className={"rounded-full px-1.5 py-0.5 font-bold " + verdictTone(p.verdict)}>
                          {t("att.verdict-" + verdictKey(p.verdict), lang)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {open && (
        <PunchDetailDialog punch={open.punch} staffName={open.name} lang={lang} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
