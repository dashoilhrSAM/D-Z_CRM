"use client";

// MKT-013: marketing owns whether live promotions discount every booking or only
// bookings that arrived through a campaign link. This is money-affecting, so it is an
// explicit toggle in the marketing section rather than a code constant.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgePercent } from "lucide-react";
import { setPromoAutoApply } from "@/actions/marketing";
import { cn } from "@/lib/utils";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";

export function PromoAutoApplyToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const lang = useLang();
  const [pending, start] = useTransition();

  const flip = () =>
    start(async () => {
      const next = !enabled;
      await setPromoAutoApply(next);
      router.refresh();
      toast.success(next ? t("ws.mkt.promo-auto.on-toast", lang) : t("ws.mkt.promo-auto.off-toast", lang));
    });

  return (
    <div data-tut="promo-auto-apply" className="rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <BadgePercent className={cn("mt-0.5 h-4 w-4 shrink-0", enabled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")} />
          <div>
            <div className="text-sm font-medium">{t("ws.mkt.promo-auto.title", lang)}</div>
            <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
              {enabled ? t("ws.mkt.promo-auto.on-desc", lang) : t("ws.mkt.promo-auto.off-desc", lang)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={cn("text-[11px] font-semibold uppercase tracking-wide", enabled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
            {enabled ? t("common.on", lang) : t("common.off", lang)}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={t("ws.mkt.promo-auto.title", lang)}
            data-testid="promo-auto-apply"
            disabled={pending}
            onClick={flip}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
              enabled ? "bg-emerald-600" : "bg-muted-foreground/30",
            )}
          >
            <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform", enabled ? "translate-x-5" : "translate-x-0.5")} />
          </button>
        </div>
      </div>

      {enabled && (
        <p className="mt-2.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {t("ws.mkt.promo-auto.warning", lang)}
        </p>
      )}
    </div>
  );
}
