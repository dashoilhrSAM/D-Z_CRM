"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, MapPin } from "lucide-react";
import { AttendancePunch } from "@/components/shared/attendance-punch";
import { AttendanceReviewQueue } from "@/components/workshop/attendance-review-queue";
import { PunchDetailDialog, locationSummary, type PunchDetail } from "@/components/workshop/punch-detail-dialog";
import { formatMinutes } from "@/modules/attendance/ledger";
import { t, tpl } from "@/lib/i18n";
import { fmtDate, fmtDateShort, fmtTime } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import type { PunchView, ReviewQueueEntry, StaffReportRow } from "@/modules/attendance/report";
import type { LedgerTotals } from "@/modules/attendance/ledger";

export type PunchEvidence = PunchDetail;

/** 本人「今天」的状态——与所选区间无关，打卡按钮永远说的是此刻。 */
export interface SelfToday {
  checkInAt: string | null;
  workedMinutes: number;
  onDuty: boolean;
}

/** verdict → i18n 键后缀（服务端常量是 SUSPECT_REUSE 这种，键是 att.verdict-suspect-reuse）。 */
const verdictKey = (v: string) => v.toLowerCase().replace(/_/g, "-");

/** 结论的颜色：正常=绿，配置缺口=灰（不该怪人），其余=琥珀（待人确认）。 */
function verdictTone(verdict: string): string {
  if (verdict === "OK") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300";
  if (verdict === "NO_GEOFENCE") return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300";
}

function Kpi({ label, value, testid, tone }: { label: string; value: string; testid: string; tone?: string }) {
  return (
    <div className="rounded-2xl border bg-card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={"mt-0.5 text-xl font-semibold tabular-nums " + (tone ?? "")} data-testid={testid}>
        {value}
      </div>
    </div>
  );
}

/**
 * 考勤面板：本人打卡 + 一段时间的台账 + 异常队列。
 *
 * 三件事是刻意的：
 *  · **地点直接显示在行上**（距门店多少米 / 未取到定位），不用悬停才发现——老板扫一眼
 *    就要能看出「人是不是在店里」，藏进 title 属性等于没显示；
 *  · 点证据条/排队项打开**详情弹窗**（照片 + 时间 + 地点 + 判定），而不是跳到一张裸照片：
 *    单独一张照片判断不了任何事；
 *  · 异常不只是一个数字，**队列里有「判定成立 / 判定不成立」**——否则那句
 *    「N 项待确认」永远没有人能清掉，P1 的证据链就断了最后一环。
 */
export function AttendancePanel({
  staff,
  totals,
  reviewQueue,
  reviewQueueTotal,
  reviewQueueTruncated,
  days,
  todayKey,
  selfToday,
  selfName,
  currentUserId,
  canReview,
  lang,
}: {
  staff: StaffReportRow[];
  totals: LedgerTotals;
  /** 待处置队列（全时段，与所选区间无关） */
  reviewQueue: ReviewQueueEntry[];
  reviewQueueTotal: number;
  reviewQueueTruncated: boolean;
  days: number;
  /** 今天的业务日：只有「今天」未闭合才叫在班，两天前那笔是忘了打下班卡 */
  todayKey: string;
  selfToday: SelfToday | null;
  selfName: string;
  currentUserId: string;
  canReview: boolean;
  lang: Lang;
}) {
  const [open, setOpen] = useState<{ punch: PunchEvidence; name: string } | null>(null);
  // 只有一天时默认展开：那正是「今天谁在店里」的原始视图，多余的点击没有意义
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const singleDay = days === 1;

  return (
    <div className="space-y-4">
      {selfToday && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">
                {selfName} <span className="text-xs text-muted-foreground">{t("att.you", lang)}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {selfToday.onDuty ? (
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    {tpl("att.on-duty-since", lang, { time: selfToday.checkInAt ? fmtTime(new Date(selfToday.checkInAt)) : "" })}
                  </span>
                ) : selfToday.checkInAt ? (
                  tpl("att.worked-today", lang, { m: String(selfToday.workedMinutes) })
                ) : (
                  t("att.not-checked", lang)
                )}
              </div>
            </div>
            <AttendancePunch kind={selfToday.onDuty ? "OUT" : "IN"} lang={lang} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label={t("att.kpi-present-days", lang)} value={String(totals.presentDays)} testid="attendance-kpi-days" />
        <Kpi label={t("att.kpi-hours", lang)} value={formatMinutes(totals.workedMinutes)} testid="attendance-kpi-hours" />
        <Kpi label={t("att.kpi-exceptions", lang)} value={String(totals.exceptionCount)} testid="attendance-kpi-exceptions" />
        <Kpi
          label={t("att.kpi-pending", lang)}
          value={String(reviewQueueTotal)}
          testid="attendance-kpi-pending"
          tone={reviewQueueTotal > 0 ? "text-amber-700 dark:text-amber-300" : ""}
        />
      </div>

      <AttendanceReviewQueue
        items={reviewQueue}
        total={reviewQueueTotal}
        truncated={reviewQueueTruncated}
        canReview={canReview}
        lang={lang}
        onOpenPunch={(punch, name) => setOpen({ punch, name })}
      />

      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="border-b bg-muted/30 px-4 py-3">
          <div className="font-semibold">{t("att.board-title", lang)}</div>
          <div className="text-xs text-muted-foreground">{t("att.board-subtitle", lang)}</div>
        </div>
        {staff.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">{t("att.no-staff", lang)}</div>}
        <div className="divide-y divide-border/60">
          {staff.map((s) => {
            const isOpen = expanded[s.id] ?? singleDay;
            const latest = s.punches.length ? s.punches[s.punches.length - 1] : null;
            const punchesByDay = new Map<string, PunchView[]>();
            for (const p of s.punches) {
              const list = punchesByDay.get(p.dateKey);
              if (list) list.push(p);
              else punchesByDay.set(p.dateKey, [p]);
            }
            return (
              <div key={s.id} className="px-4 py-3" data-testid={"attendance-row-" + s.id}>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setExpanded({ ...expanded, [s.id]: !isOpen })}
                    aria-label={t("att.toggle-days", lang)}
                    data-testid={"attendance-toggle-" + s.id}
                    className="shrink-0 rounded-lg p-1 hover:bg-accent"
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-semibold text-primary">
                    {s.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {s.name}
                      {s.id === currentUserId ? " (" + t("att.you", lang) + ")" : ""}
                      {!s.active && (
                        <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {t("att.inactive", lang)}
                        </span>
                      )}
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">{s.role.replace(/_/g, " ")}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      <span data-testid={"attendance-summary-" + s.id}>
                        {s.presentDays > 0
                          ? tpl("att.range-summary", lang, {
                              d: String(s.presentDays),
                              h: formatMinutes(s.workedMinutes),
                            })
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
                      className={
                        "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold " +
                        (s.pendingCount > 0
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")
                      }
                      data-testid={"attendance-exceptions-" + s.id}
                    >
                      {s.pendingCount > 0
                        ? tpl("att.exceptions", lang, { n: String(s.pendingCount) })
                        : tpl("att.exceptions-resolved", lang, { n: String(s.exceptionCount) })}
                    </span>
                  )}
                </div>

                {isOpen && (
                  <div className="mt-2 space-y-1.5 pl-14" data-testid={"attendance-days-" + s.id}>
                    {s.days.length === 0 && (
                      <div className="text-[11px] text-muted-foreground">{t("att.no-records-in-range", lang)}</div>
                    )}
                    {s.days.map((d) => (
                      <div key={d.dateKey}>
                        <div className="flex flex-wrap items-center gap-x-3 text-[11px]">
                          <span className="font-medium tabular-nums">{fmtDate(d.dateKey + "T00:00:00Z")}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {d.firstInAt ? fmtTime(new Date(d.firstInAt)) : "—"} → {d.lastOutAt ? fmtTime(new Date(d.lastOutAt)) : "—"}
                          </span>
                          <span className="tabular-nums text-muted-foreground">{formatMinutes(d.workedMinutes)}</span>
                          {d.open && d.dateKey === todayKey && (
                            <span
                              className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                              data-testid={"attendance-open-" + s.id + "-" + d.dateKey}
                            >
                              {t("att.on-duty", lang)}
                            </span>
                          )}
                          {d.open && d.dateKey !== todayKey && (
                            // 历史那天没打下班卡 ≠ 还在上班。混为一谈会让老板以为人两天没回家。
                            <span
                              className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                              data-testid={"attendance-nocheckout-" + s.id + "-" + d.dateKey}
                            >
                              {t("att.no-checkout", lang)}
                            </span>
                          )}
                          {d.exceptionCount > 0 && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                              {tpl("att.exceptions", lang, { n: String(d.pendingCount > 0 ? d.pendingCount : d.exceptionCount) })}
                            </span>
                          )}
                        </div>
                        {/* 证据条：点开是详情弹窗（照片 + 时间 + 地点 + 判定） */}
                        <div className="mt-1 flex flex-wrap gap-2">
                          {(punchesByDay.get(d.dateKey) ?? []).map((p) => (
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
                              {p.review && (
                                <span
                                  className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                  data-testid={"punch-review-" + p.id}
                                  title={p.review.reviewedByName + (p.review.note ? " · " + p.review.note : "")}
                                >
                                  {t("att.review-" + p.review.decision.toLowerCase(), lang)}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {s.lastSeenAt && !singleDay && (
                      <div className="text-[10px] text-muted-foreground">
                        {tpl("att.last-seen", lang, { t: fmtDateShort(new Date(s.lastSeenAt)) })}
                      </div>
                    )}
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
