"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { JobCard, type OrderCard } from "@/components/mechanic/job-card";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";
import { jitteredDelayMs } from "@/lib/refresh-policy";

type Tab = "current" | "completed";

/** Mechanic orders home: Current/Completed filter + auto-refresh + manual refresh (prevent missed orders). */
export function MechanicOrdersView({ current, completed, name }: { current: OrderCard[]; completed: OrderCard[]; name: string }) {
  const router = useRouter();
  const lang = useLang();
  const [tab, setTab] = useState<Tab>("current");
  const [auto, setAuto] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Auto-refresh while visible (toggleable). 间隔带 ±20% 抖动 —— 见
  // src/lib/refresh-policy.ts：平均仍约 30 秒，但不再和所有终端同时打点。
  useEffect(() => {
    if (!auto) return;
    let id: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const schedule = () => {
      id = setTimeout(() => {
        if (cancelled) return;
        if (!document.hidden) router.refresh();
        schedule();
      }, jitteredDelayMs());
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [auto, router]);

  const doRefresh = () => {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 900);
  };

  const pending = current.filter((o) => o.status === "WAITING");
  const list = tab === "current" ? current : completed;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t("mech.orders", lang)}</h1>
          <p className="text-xs text-muted-foreground">{tpl("mech.order-count", lang, { n: current.length, name })}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
            <button onClick={() => setAuto((a) => !a)} aria-label={t("mech.auto-refresh", lang)} className={cn("relative h-5 w-9 rounded-full transition-colors", auto ? "bg-primary" : "bg-muted")}>
              <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", auto ? "left-[18px]" : "left-0.5")} />
            </button>
            {auto ? t("mech.auto-refresh", lang) : t("mech.off", lang)}
          </label>
          <button onClick={doRefresh} disabled={refreshing} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} /> {t("mech.refresh", lang)}
          </button>
        </div>
      </div>

      {/* tab filter */}
      <div className="grid grid-cols-2 gap-1 rounded-2xl border bg-muted/40 p-1">
        <button onClick={() => setTab("current")} className={cn("flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold transition-colors", tab === "current" ? "bg-background shadow-sm" : "text-muted-foreground")}>
          {t("mech.tab.current", lang)} <span className="text-xs font-normal text-muted-foreground">{current.length}</span>
          {pending.length > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">{pending.length}</span>}
        </button>
        <button onClick={() => setTab("completed")} className={cn("flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold transition-colors", tab === "completed" ? "bg-background shadow-sm" : "text-muted-foreground")}>
          {t("mech.tab.completed", lang)} <span className="text-xs font-normal text-muted-foreground">{completed.length}</span>
        </button>
      </div>

      {list.length === 0 ? (
        <div className="rounded-2xl border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">{tab === "current" ? t("mech.no-orders", lang) : t("mech.no-completed", lang)}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((o) => (
            <JobCard key={o.id} order={o} completed={tab === "completed"} />
          ))}
        </div>
      )}
    </div>
  );
}
