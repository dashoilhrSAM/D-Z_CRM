"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, FileDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { addInvoicePayment, setInvoiceDiscount, settleInvoices } from "@/actions/invoices";
import { applyDiscount, manualDiscountLabel, type DiscountKind } from "@/modules/finance/invoice-discount";
import { formatRM } from "@/lib/money";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";

export interface InvoicePaymentDto {
  id: string;
  invoiceNumber: string;
  status: string;
  subtotalSen: number;
  /** The promotional discount, snapshotted at completion. Shown, never edited here. */
  promoDiscountSen: number;
  taxSen: number;
  totalSen: number;
  paidSen: number;
  manualDiscountSen: number;
  manualDiscountKind: string | null;
  manualDiscountValue: number | null;
  manualDiscountReason: string | null;
}

const COLLECT_METHODS = ["CASH", "CARD", "ONLINE", "EWALLET"] as const;

type DiscountChoice = "NONE" | DiscountKind;

/** Workshop invoice: totals, an optional checkout discount, and recording the payment. */
export function InvoicePaymentPanel({ invoice }: { invoice: InvoicePaymentDto }) {
  const router = useRouter();
  const lang = useLang();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("none");

  // The discount draft is held as typed, and the figures below are derived from it with the
  // same function the server action uses — so what the cashier reads is what gets stored.
  const savedKind = (invoice.manualDiscountKind as DiscountChoice | null) ?? "NONE";
  const [choice, setChoice] = useState<DiscountChoice>(savedKind);
  const [value, setValue] = useState(discountValueToInput(savedKind, invoice.manualDiscountValue));
  const [reason, setReason] = useState(invoice.manualDiscountReason ?? "");

  const isPaid = invoice.status === "PAID";
  const bill = { subtotalSen: invoice.subtotalSen, promoDiscountSen: invoice.promoDiscountSen, taxSen: invoice.taxSen };

  const draftRequest = discountRequestFrom(choice, value);
  const preview = applyDiscount(bill, draftRequest);
  const remaining = Math.max(0, invoice.totalSen - invoice.paidSen);
  const previewRemaining = Math.max(0, preview.totalSen - invoice.paidSen);
  const discountChanged = (choice === "NONE" ? null : choice) !== (savedKind === "NONE" ? null : savedKind)
    || (invoice.manualDiscountValue ?? null) !== (draftRequest?.value ?? null);

  /** Everything the checkout does, in the order the money has to move. */
  const submit = () => start(async () => {
    // 1. the discount, because the total has to be right before the payment is judged against it
    if (discountChanged) {
      const saved = await setInvoiceDiscount({ invoiceId: invoice.id, discount: draftRequest, reason });
      if (!saved.ok) { toast.error(saved.error ?? t("toast.failed", lang)); return; }
    }

    // 2. the payment. An empty amount means "pay the whole remaining", which is the common case.
    const target = previewRemaining;
    const sen = amount.trim() === "" ? target : Math.round(Number(amount) * 100);
    if (sen < 0 || !Number.isFinite(sen)) { toast.error(t("inv.valid-amount", lang)); return; }
    if (sen > target) { toast.error(tpl("inv.amount-exceeds", lang, { n: invoice.invoiceNumber })); return; }

    if (sen > 0) {
      const r = await addInvoicePayment(invoice.id, sen, method === "none" ? "CASH" : method);
      if (!r.ok) { toast.error(r.error ?? t("toast.failed", lang)); return; }
    } else if (target === 0) {
      // A discount that clears the bill leaves nothing to collect, so the invoice is settled
      // here — otherwise it would sit unsettled forever with a zero balance.
      const s = await settleInvoices([invoice.id]);
      if (!s.ok) { toast.error(s.error ?? t("toast.failed", lang)); return; }
    }

    setOpen(false); setAmount("");
    router.refresh();
    toast.success(sen > 0 ? tpl("inv.payment-recorded", lang, { n: formatRM(sen) }) : t("inv.discount-applied-toast", lang));
  });

  return (
    <div className="dz-panel p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{t("inv.title", lang)}</h3>
        <div className="flex items-center gap-2">
          <a href={"/invoice/" + invoice.id} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            <FileDown className="h-3.5 w-3.5" /> {t("pdf.download", lang)}
          </a>
          <span className={"text-[11px] font-bold uppercase " + (isPaid || remaining <= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300")}>
            {isPaid || remaining <= 0 ? t("inv.paid", lang) : t("inv.issued", lang)}
          </span>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{tpl("inv.number", lang, { n: invoice.invoiceNumber })}</p>

      <div className="mt-3 rounded-xl bg-muted/40 p-3 text-sm">
        <div className="flex justify-between text-muted-foreground"><span>{t("inv.subtotal", lang)}</span><span className="tabular-nums">{formatRM(invoice.subtotalSen)}</span></div>
        {invoice.promoDiscountSen > 0 && (
          <div className="mt-1 flex justify-between text-muted-foreground"><span>{t("inv.discount-promo", lang)}</span><span className="tabular-nums">−{formatRM(invoice.promoDiscountSen)}</span></div>
        )}
        {invoice.manualDiscountSen > 0 && (
          <div className="mt-1 flex justify-between text-muted-foreground">
            <span>{t("inv.discount-manual", lang)}{manualDiscountLabel(invoice.manualDiscountKind, invoice.manualDiscountValue) && " (" + manualDiscountLabel(invoice.manualDiscountKind, invoice.manualDiscountValue) + ")"}</span>
            <span className="tabular-nums">−{formatRM(invoice.manualDiscountSen)}</span>
          </div>
        )}
        {invoice.taxSen > 0 && <div className="mt-1 flex justify-between text-muted-foreground"><span>{t("pdf.tax", lang)}</span><span className="tabular-nums">{formatRM(invoice.taxSen)}</span></div>}
        <div className="mt-1 flex justify-between border-t border-border/60 pt-1 font-bold"><span>{t("inv.total", lang)}</span><span className="tabular-nums">{formatRM(invoice.totalSen)}</span></div>
        <div className="mt-1 flex justify-between text-muted-foreground"><span>{t("inv.paid", lang)}</span><span className="tabular-nums">{formatRM(invoice.paidSen)}</span></div>
        <div className="mt-1 flex justify-between font-semibold"><span>{t("inv.remaining", lang)}</span><span className="tabular-nums">{formatRM(remaining)}</span></div>
      </div>

      {invoice.manualDiscountReason && <p className="mt-2 text-[11px] text-muted-foreground">{t("inv.discount-reason", lang)}: {invoice.manualDiscountReason}</p>}

      {isPaid ? (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> {t("inv.paid-in-full", lang)}
        </div>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {t("inv.record-payment", lang)}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("inv.record-payment-title", lang)}</DialogTitle>
              <DialogDescription>{tpl("inv.record-payment-desc", lang, { inv: invoice.invoiceNumber, total: formatRM(preview.totalSen), remaining: formatRM(previewRemaining) })}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label>{t("inv.amount", lang)}</Label>
                <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={(previewRemaining / 100).toFixed(2)} className="mt-1.5" />
              </div>
              <div>
                <Label>{t("inv.method", lang)}</Label>
                <Select value={method} onValueChange={(v) => setMethod(v ?? "none")}>
                  <SelectTrigger className="mt-1.5 w-full"><SelectValue>{() => (method === "none" ? t("inv.method-cash", lang) : t("inv.method-" + method, lang))}</SelectValue></SelectTrigger>
                  <SelectContent className="min-w-56">
                    {COLLECT_METHODS.map((m) => (<SelectItem key={m} value={m}>{t("inv.method-" + m, lang)}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              {/* Discount: the same bill, recalculated from the draft above. */}
              <div className="rounded-xl border p-3">
                <Label>{t("inv.discount", lang)}</Label>
                <div className="mt-2 flex gap-1.5">
                  {(["NONE", "PERCENT", "AMOUNT"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      data-testid={"discount-choice-" + c}
                      onClick={() => setChoice(c)}
                      className={"rounded-lg border px-2.5 py-1 text-xs font-medium " + (choice === c ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                    >
                      {t("inv.discount-" + c.toLowerCase(), lang)}
                    </button>
                  ))}
                </div>
                {choice !== "NONE" && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <Input
                      data-testid="discount-value"
                      inputMode="decimal"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder={choice === "PERCENT" ? "10" : "5.00"}
                    />
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("inv.discount-reason-placeholder", lang)} />
                  </div>
                )}
                <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  <div className="flex justify-between"><span>{t("inv.discount", lang)}</span><span className="tabular-nums" data-testid="discount-preview">−{formatRM(preview.manualDiscountSen)}</span></div>
                  <div className="flex justify-between font-semibold text-foreground"><span>{t("inv.total", lang)}</span><span className="tabular-nums">{formatRM(preview.totalSen)}</span></div>
                  <div className="flex justify-between"><span>{t("inv.remaining", lang)}</span><span className="tabular-nums">{formatRM(previewRemaining)}</span></div>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">{t("inv.discount-hint", lang)}</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel", lang)}</Button>
              <Button data-testid="confirm-checkout" disabled={pending || (choice !== "NONE" && !draftRequest)} onClick={submit}>
                {pending ? t("common.saving", lang) : t("inv.record-payment", lang)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** Turn a stored discount into what the input should show. AMOUNT is stored in sen. */
function discountValueToInput(kind: DiscountChoice, value: number | null): string {
  if (value == null || kind === "NONE") return "";
  return kind === "AMOUNT" ? (value / 100).toFixed(2) : String(value);
}

/** Build a request from the draft, or null when there is nothing usable yet. */
function discountRequestFrom(choice: DiscountChoice, raw: string) {
  if (choice === "NONE") return null;
  const n = Number(raw);
  if (!raw.trim() || !Number.isFinite(n) || n <= 0) return null;
  return choice === "PERCENT" ? { kind: "PERCENT" as const, value: n } : { kind: "AMOUNT" as const, value: Math.round(n * 100) };
}

