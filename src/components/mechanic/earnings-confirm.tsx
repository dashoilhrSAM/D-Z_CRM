"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck } from "lucide-react";
import { mechanicConfirmPayout } from "@/actions/payouts";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";
import { formatRM } from "@/lib/money";
import { fmtDate } from "@/lib/format";

export interface PendingPayout {
  id: string;
  period: string;
  periodStart: string;
  totalSen: number;
}

/** Mechanic 确认收款（双向确认第 2 步）：workshop 已出粮(AWAITING_CONFIRM) → Mechanic 确认 → PAID。 */
export function EarningsConfirm({ payouts }: { payouts: PendingPayout[] }) {
  const router = useRouter();
  const lang = useLang();
  const [pending, start] = useTransition();

  const confirm = (id: string) =>
    start(async () => {
      const r = await mechanicConfirmPayout(id);
      if (r.ok) { toast.success(t("mech.confirmed", lang)); router.refresh(); }
      else toast.error(r.error);
    });

  return (
    <>
      {payouts.map((p) => (
        <div key={p.id} className="rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">{p.period} · {fmtDate(new Date(p.periodStart))}</div>
              <div className="text-xs text-muted-foreground">{t("payout.total", lang)} {formatRM(p.totalSen)}</div>
            </div>
            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">{t("mech.awaiting-confirm", lang)}</span>
          </div>
          <button
            type="button"
            onClick={() => confirm(p.id)}
            disabled={pending}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <BadgeCheck className="h-4 w-4" /> {tpl("mech.confirm-receipt", lang, { n: formatRM(p.totalSen) })}
          </button>
        </div>
      ))}
    </>
  );
}
