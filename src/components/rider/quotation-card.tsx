"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { respondQuotation } from "@/actions/rider";
import { formatRM } from "@/lib/money";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";

export interface QuotationItem { description: string; qty: number; unitPriceSen: number; lineTotalSen: number; kind: string }
export interface QuotationDto {
  id: string; status: string; revision: number; totalSen: number; items: QuotationItem[];
  /** The promotion promised on these lines — the rider approves the net, which is what they pay. */
  promo?: { name: string; discountSen: number } | null;
  /** Rendered as a hook: a rider with two live jobs has two cards on the same page. */
  jobNumber?: string;
}

/** Rider quotation: confirm / reject before service starts. */
export function QuotationCard({ quotation }: { quotation: QuotationDto }) {
  const router = useRouter();
  const lang = useLang();
  const [pending, start] = useTransition();

  const promo = quotation.promo ?? null;
  const payableSen = Math.max(0, quotation.totalSen - (promo?.discountSen ?? 0));

  if (quotation.status !== "PENDING") {
    return (
      <div className="rounded-2xl border bg-card p-4 opacity-80">
        <div className={"text-[11px] font-bold uppercase tracking-wide " + (quotation.status === "APPROVED" ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300")}>
          {quotation.status === "APPROVED" ? t("quotation.approved", lang) : t("quotation.rejected", lang)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{tpl("quotation.rev", lang, { n: quotation.revision })} · {formatRM(payableSen)}</div>
      </div>
    );
  }

  const respond = (d: "APPROVED" | "REJECTED") =>
    start(async () => {
      await respondQuotation(quotation.id, d);
      router.refresh();
      toast.success(d === "APPROVED" ? t("quotation.approved", lang) : t("quotation.rejected", lang));
    });

  return (
    <div data-testid="quotation-card" data-job={quotation.jobNumber} className="rounded-2xl border-2 border-primary/30 bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-primary">{t("quotation.title", lang)}</span>
        <span className="text-[11px] text-muted-foreground">{tpl("quotation.rev", lang, { n: quotation.revision })}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t("quotation.sub", lang)}</p>
      <div className="mt-3 space-y-1.5">
        {quotation.items.map((it, i) => (
          <div key={i} className="flex justify-between text-sm">
            <span>{it.description} ×{it.qty}</span>
            <span className="tabular-nums">{formatRM(it.lineTotalSen)}</span>
          </div>
        ))}
        {promo && (
          <div data-testid="quotation-promo" className="flex justify-between text-sm text-emerald-700 dark:text-emerald-300">
            <span>{t("quotation.promo", lang)} · {promo.name}</span>
            <span className="tabular-nums">−{formatRM(promo.discountSen)}</span>
          </div>
        )}
        <div className="flex justify-between border-t pt-2 text-sm font-bold">
          <span>{t("quotation.total", lang)}</span>
          <span data-testid="quotation-total" className="tabular-nums">{formatRM(payableSen)}</span>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="outline" data-testid="quotation-reject" disabled={pending} onClick={() => respond("REJECTED")}>{t("quotation.reject", lang)}</Button>
        <Button data-testid="quotation-confirm" disabled={pending} onClick={() => respond("APPROVED")}>{t("quotation.confirm", lang)}</Button>
      </div>
    </div>
  );
}
