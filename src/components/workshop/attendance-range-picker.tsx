"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { t, type Lang } from "@/lib/i18n";
import type { RangePreset } from "@/modules/attendance/range";

const PRESETS: RangePreset[] = ["today", "week", "month"];

/**
 * 期间切换 + 导出。
 *
 * 走 URL（?preset=&from=&to=）而不是组件内状态：报表是**可以被分享和收藏的**，
 * 「把这个月给我看看」应该能直接发一条链接；刷新也不该跳回今天。
 */
export function AttendanceRangePicker({
  preset,
  fromKey,
  toKey,
  clamped,
  canExport,
  lang,
}: {
  preset: RangePreset;
  fromKey: string;
  toKey: string;
  clamped: boolean;
  canExport: boolean;
  lang: Lang;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [from, setFrom] = useState(fromKey);
  const [to, setTo] = useState(toKey);

  function go(nextPreset: RangePreset, nextFrom?: string, nextTo?: string) {
    const q = new URLSearchParams({ preset: nextPreset });
    if (nextPreset === "custom") {
      q.set("from", nextFrom ?? from);
      q.set("to", nextTo ?? to);
    }
    startTransition(() => router.push(pathname + "?" + q.toString()));
  }

  const tabCls = (on: boolean) =>
    "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors " +
    (on ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground");
  const inputCls =
    "rounded-lg border bg-background px-2 py-1.5 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-ring";

  const exportHref = "/api/attendance/export?from=" + fromKey + "&to=" + toKey;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3" data-testid="attendance-range-picker">
      <div className="flex items-center gap-1 rounded-xl bg-muted/40 p-1">
        {PRESETS.map((p) => (
          <button key={p} type="button" onClick={() => go(p)} className={tabCls(preset === p)} data-testid={"attendance-preset-" + p}>
            {t("att.preset-" + p, lang)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => go("custom", from, to)}
          className={tabCls(preset === "custom")}
          data-testid="attendance-preset-custom"
        >
          {t("att.preset-custom", lang)}
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
          aria-label={t("att.range-from", lang)}
          className={inputCls}
          data-testid="attendance-from"
        />
        <span className="text-xs text-muted-foreground">→</span>
        <input
          type="date"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
          aria-label={t("att.range-to", lang)}
          className={inputCls}
          data-testid="attendance-to"
        />
        <button
          type="button"
          onClick={() => go("custom", from, to)}
          className="rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
          data-testid="attendance-range-apply"
        >
          {t("att.range-apply", lang)}
        </button>
      </div>

      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {clamped && (
        <span className="text-[11px] text-amber-700 dark:text-amber-300" data-testid="attendance-range-clamped">
          {t("att.range-clamped", lang)}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {canExport && (
          <a
            href={exportHref}
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
            data-testid="attendance-export"
          >
            <Download className="h-3.5 w-3.5" />
            {t("att.export-csv", lang)}
          </a>
        )}
      </div>
    </div>
  );
}
