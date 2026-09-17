"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MapPin, ShieldQuestion } from "lucide-react";
import { reviewAttendancePunch } from "@/actions/attendance-review";
import { locationSummary, type PunchDetail } from "@/components/workshop/punch-detail-dialog";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { t, tpl, type Lang } from "@/lib/i18n";
// type-only 导入：report.ts 是 server-only，运行时会被完全擦除（next build 会验证这一点）
import type { ReviewQueueEntry } from "@/modules/attendance/report";

const verdictKey = (v: string) => v.toLowerCase().replace(/_/g, "-");
const codeKey = (c: string) => c.toLowerCase().replace(/_/g, "-");

/** 异常队列。没有它，考勤看板上的「N 项待确认」就只是一个没人能清掉的数字。 */
export function AttendanceReviewQueue({
  items,
  total,
  truncated,
  canReview,
  lang,
  onOpenPunch,
}: {
  items: ReviewQueueEntry[];
  /** 真实总数（items 可能只列了最近的 N 条） */
  total: number;
  truncated: boolean;
  canReview: boolean;
  lang: Lang;
  onOpenPunch: (punch: PunchDetail, staffName: string) => void;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function decide(item: ReviewQueueEntry, decision: "CONFIRMED" | "DISMISSED") {
    setBusyId(item.id);
    setError(null);
    const res = await reviewAttendancePunch({ punchId: item.id, decision, note: notes[item.id] ?? "" });
    setBusyId(null);
    if (!res.ok) {
      // 服务端只说结论（找不到/跨店/不是异常），人话在界面这边 —— 不吞原因也不透传英文
      setError(t("att.review-err-" + codeKey(res.code ?? "UNKNOWN"), lang));
      return;
    }
    // 处置会写库并改汇总，让 RSC 重新取一次（revalidatePath 之外再兜一层）
    startTransition(() => router.refresh());
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card" data-testid="attendance-review-queue">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldQuestion className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <div>
            <div className="font-semibold">{t("att.queue-title", lang)}</div>
            <div className="text-xs text-muted-foreground">{t("att.queue-subtitle", lang)}</div>
          </div>
        </div>
        <span
          className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
          data-testid="attendance-queue-count"
        >
          {total}
        </span>
      </div>

      {truncated && (
        <div className="border-b bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground" data-testid="attendance-queue-truncated">
          {tpl("att.queue-truncated", lang, { n: String(items.length) })}
        </div>
      )}

      {error && (
        <div className="border-b bg-red-50 px-4 py-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200" data-testid="attendance-review-error">
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground" data-testid="attendance-queue-empty">
          {t("att.queue-empty", lang)}
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={"review-item-" + item.id}>
              <button
                type="button"
                onClick={() => onOpenPunch(item, item.staffName)}
                className="min-w-0 flex-1 text-left"
                data-testid={"review-open-" + item.id}
              >
                <div className="truncate text-sm font-medium">
                  {item.staffName}
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {item.kind === "IN" ? t("att.in", lang) : t("att.out", lang)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                  <span className="tabular-nums">{fmtDateTime(new Date(item.at))}</span>
                  {item.outsidePeriod && (
                    // 队列是全时段的：不标出来，老板会以为这是"这段时间"的异常
                    <span
                      className="rounded-full bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      data-testid={"review-outside-" + item.id}
                    >
                      {tpl("att.outside-period", lang, { d: fmtDate(item.dateKey + "T00:00:00Z") })}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {locationSummary(item, lang)}
                  </span>
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                    {t("att.verdict-" + verdictKey(item.verdict), lang)}
                  </span>
                </div>
              </button>

              {canReview ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={notes[item.id] ?? ""}
                    onChange={(e) => setNotes({ ...notes, [item.id]: e.target.value })}
                    placeholder={t("att.review-note-placeholder", lang)}
                    maxLength={500}
                    className="h-7 w-40 rounded-lg border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    data-testid={"review-note-" + item.id}
                  />
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => decide(item, "CONFIRMED")}
                    className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
                    data-testid={"review-confirm-" + item.id}
                  >
                    {busyId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    {t("att.review-confirm", lang)}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => decide(item, "DISMISSED")}
                    className="rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
                    data-testid={"review-dismiss-" + item.id}
                  >
                    {t("att.review-dismiss", lang)}
                  </button>
                </div>
              ) : (
                <span className="text-[11px] text-muted-foreground">{t("att.review-no-permission", lang)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
