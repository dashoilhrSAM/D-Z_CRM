"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendQuotation } from "@/actions/workshop";
import { formatRM } from "@/lib/money";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";

export interface JobQuotationDto {
  status: string; revision: number; totalSen: number;
  /**
   * The promotion promised on these lines. The counter sees the same promise the rider
   * approved — without it the staff screen quotes full price for a job the customer was
   * already told is discounted.
   */
  promo?: { name: string; discountSen: number } | null;
}

/** Workshop job detail: quotation status + send / re-send button (customer confirms before start). */
export function QuotationPanel({ jobId, quotation }: { jobId: string; quotation: JobQuotationDto | null }) {
  const router = useRouter();
  const lang = useLang();
  const [pending, start] = useTransition();
  const promo = quotation?.promo ?? null;
  const payableSen = quotation ? Math.max(0, quotation.totalSen - (promo?.discountSen ?? 0)) : 0;

  const send = () =>
    start(async () => {
      await sendQuotation(jobId);
      router.refresh();
      toast.success(t("ws.job.quotation-send", lang));
    });

  return (
    <div className="dz-panel p-5">
      <h3 className="font-semibold mb-2">{t("ws.job.quotation-title", lang)}</h3>
      {!quotation ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{t("ws.job.quotation-none", lang)}</p>
          <Button size="sm" onClick={send} disabled={pending}>{t("ws.job.quotation-send", lang)}</Button>
        </div>
      ) : (
        <>
          <div className={"text-xs font-bold uppercase " + (quotation.status === "APPROVED" ? "text-emerald-600 dark:text-emerald-300" : quotation.status === "REJECTED" ? "text-rose-600 dark:text-rose-300" : "text-amber-600 dark:text-amber-300")}>
            {quotation.status === "APPROVED" ? t("ws.job.quotation-approved", lang) : quotation.status === "REJECTED" ? t("ws.job.quotation-rejected", lang) : t("ws.job.quotation-pending", lang)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{tpl("quotation.rev", lang, { n: quotation.revision })} · {formatRM(quotation.totalSen)}</div>
          {promo && (
            <>
              <div data-testid="ws-quotation-promo" className="mt-1.5 flex justify-between gap-3 text-xs text-emerald-700 dark:text-emerald-300">
                <span>{t("quotation.promo", lang)} · {promo.name}</span>
                <span className="tabular-nums">−{formatRM(promo.discountSen)}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3 text-sm font-semibold">
                <span>{t("quotation.total", lang)}</span>
                <span data-testid="ws-quotation-total" className="tabular-nums">{formatRM(payableSen)}</span>
              </div>
            </>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={send} disabled={pending}>
              {quotation.status === "REJECTED" ? t("ws.job.quotation-resend", lang) : t("ws.job.quotation-send", lang)}
            </Button>
            <Link href={"/quotation/" + jobId} target="_blank">
              <Button size="sm" variant="ghost"><FileDown className="h-3.5 w-3.5 mr-1.5" /> {t("pdf.download", lang)}</Button>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
