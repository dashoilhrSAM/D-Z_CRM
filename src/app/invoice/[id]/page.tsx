import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";
import { formatRM } from "@/lib/money";
import { fmtDate } from "@/lib/format";
import { manualDiscountLabel } from "@/modules/finance/invoice-discount";
import { QuotationPrintActions } from "@/components/workshop/quotation-print-actions";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = { SERVICE: "ws.kind.service", PART: "ws.kind.part", FEE: "ws.kind.fee", APPROVAL: "ws.kind.approval" };

export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang = await getLang();
  const session = await getSessionUser();
  if (session.kind !== "staff") redirect("/workshop/dashboard");

  const invoice = await db.invoice.findUnique({
    where: { id },
    include: {
      customer: true,
      branch: true,
      items: true,
      payments: true,
      job: { include: { motorcycle: true } },
    },
  });
  if (!invoice) notFound();
  const org = await db.organisation.findFirst();
  const paidSen = invoice.payments.filter((p) => p.status === "PAID" && p.method !== "PAY_LATER").reduce((s, p) => s + p.amountSen, 0);
  const remaining = Math.max(0, invoice.totalSen - paidSen);
  const isPaid = invoice.status === "PAID" || remaining <= 0;

  return (
    <div className="min-h-screen bg-muted/40">
      <QuotationPrintActions title={t("pdf.invoice-title", lang)} />
      <div className="mx-auto my-8 w-full max-w-[794px] bg-white p-10 text-neutral-900 shadow-sm">
        {/* Header */}
        <div className="flex items-start justify-between gap-6 border-b border-neutral-200 pb-6">
          <div>
            <div className="text-2xl font-bold tracking-tight">{org?.name ?? "D&Z Smart Workshop"}</div>
            {org?.address && <div className="mt-1 whitespace-pre-line text-xs text-neutral-600">{org.address}</div>}
            <div className="mt-1 text-xs text-neutral-600">
              {org?.contactPhone && <span className="mr-3">{t("pdf.phone", lang)} {org.contactPhone}</span>}
              {org?.contactEmail && <span className="mr-3">{org.contactEmail}</span>}
              {org?.taxId && <span>{t("pdf.tax-id", lang)} {org.taxId}</span>}
            </div>
            {invoice.branch && <div className="mt-2 text-xs text-neutral-600">{t("pdf.branch", lang)} {invoice.branch.name} · {invoice.branch.city}</div>}
          </div>
          {org?.logo ? <img src={org.logo} alt={org.name ?? "logo"} className="h-16 w-16 object-contain" /> : <div className="h-16 w-16 rounded-xl bg-neutral-100" />}
        </div>

        {/* Document meta */}
        <div className="mt-6 flex items-start justify-between">
          <div>
            <div className="text-2xl font-bold">{t("pdf.invoice", lang)}</div>
            <div className="mt-1 text-sm text-neutral-600">{t("pdf.invoice-no", lang)} <span className="font-mono font-semibold text-neutral-900">{invoice.invoiceNumber}</span></div>
          </div>
          <div className="text-right text-xs text-neutral-600">
            <div>{t("pdf.date", lang)} <span className="font-medium text-neutral-900">{fmtDate(invoice.issuedAt)}</span></div>
            <div className="mt-1">{t("pdf.status", lang)} <span className={"font-semibold " + (isPaid ? "text-emerald-700" : "text-amber-700")}>{isPaid ? t("inv.paid", lang) : t("inv.issued", lang)}</span></div>
          </div>
        </div>

        {/* Parties */}
        <div className="mt-6 grid grid-cols-2 gap-6 rounded-xl bg-neutral-50 p-4 text-sm">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">{t("pdf.customer", lang)}</div>
            <div className="mt-1 font-semibold">{invoice.customer.name}</div>
            <div className="text-xs text-neutral-600">{invoice.customer.phone ?? "—"}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">{t("pdf.motorcycle", lang)}</div>
            {invoice.job?.motorcycle ? (
              <div>
                <div className="mt-1 font-semibold">{invoice.job.motorcycle.brand} {invoice.job.motorcycle.model}</div>
                <div className="text-xs text-neutral-600">{invoice.job.motorcycle.plate} · {invoice.job.motorcycle.year}</div>
              </div>
            ) : (<div className="mt-1 text-xs text-neutral-600">{t("pdf.no-bike", lang)}</div>)}
          </div>
        </div>

        {/* Job info */}
        {invoice.job && (
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-1.5 text-xs text-neutral-600">
            <div>{t("pdf.job", lang)} <span className="font-mono font-semibold text-neutral-900">{invoice.job.jobNumber}</span></div>
            <div>{t("pdf.mileage", lang)} <span className="font-medium text-neutral-900">{invoice.job.mileage.toLocaleString()} km</span></div>
          </div>
        )}

        {/* Lines */}
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-[10px] font-bold uppercase tracking-wide text-neutral-500">
              <th className="py-2 pr-2">{t("pdf.line", lang)}</th>
              <th className="py-2 pr-2 w-20">{t("pdf.kind", lang)}</th>
              <th className="py-2 pr-2 w-12 text-center">{t("pdf.qty", lang)}</th>
              <th className="py-2 pr-2 w-24 text-right">{t("pdf.unit", lang)}</th>
              <th className="py-2 w-28 text-right">{t("pdf.amount", lang)}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((it) => (
              <tr key={it.id} className="border-b border-neutral-100">
                <td className="py-2 pr-2">{it.description}</td>
                <td className="py-2 pr-2 text-xs text-neutral-500">{SOURCE_LABEL[it.source] ? t(SOURCE_LABEL[it.source], lang) : it.source}</td>
                <td className="py-2 pr-2 text-center tabular-nums">{it.quantity}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatRM(it.unitPriceSen)}</td>
                <td className="py-2 text-right font-semibold tabular-nums">{formatRM(it.lineTotalSen)}</td>
              </tr>
            ))}
            {invoice.items.length === 0 && <tr><td className="py-2 text-sm text-neutral-500">{t("pdf.no-items", lang)}</td></tr>}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <div className="w-56 space-y-1.5 text-sm">
            <div className="flex justify-between text-neutral-600"><span>{t("pdf.subtotal", lang)}</span><span className="tabular-nums">{formatRM(invoice.subtotalSen)}</span></div>
            {invoice.discountSen > 0 && <div className="flex justify-between text-neutral-600"><span>{t("pdf.discount", lang)}</span><span className="tabular-nums">−{formatRM(invoice.discountSen)}</span></div>}
            {/* The checkout discount is a different thing from the promotion, so the customer
                sees both rather than one merged number they cannot account for. */}
            {invoice.manualDiscountSen > 0 && (
              <div className="flex justify-between text-neutral-600">
                <span>{t("inv.discount-manual", lang)}{manualDiscountLabel(invoice.manualDiscountKind, invoice.manualDiscountValue) ? " (" + manualDiscountLabel(invoice.manualDiscountKind, invoice.manualDiscountValue) + ")" : ""}</span>
                <span className="tabular-nums">−{formatRM(invoice.manualDiscountSen)}</span>
              </div>
            )}
            {invoice.taxSen > 0 && <div className="flex justify-between text-neutral-600"><span>{t("pdf.tax", lang)}</span><span className="tabular-nums">{formatRM(invoice.taxSen)}</span></div>}
            <div className="flex justify-between border-t border-neutral-200 pt-2 text-base font-bold"><span>{t("pdf.total", lang)}</span><span className="tabular-nums">{formatRM(invoice.totalSen)}</span></div>
            {!isPaid && <div className="flex justify-between text-sm text-neutral-600"><span>{t("inv.remaining", lang)}</span><span className="tabular-nums">{formatRM(remaining)}</span></div>}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12">
          <div className="text-xs text-neutral-500">{t("pdf.thanks", lang)}</div>
          <div className="mt-10 w-56 border-t border-neutral-300 text-center text-xs text-neutral-600">{t("pdf.signature", lang)}</div>
        </div>
      </div>
    </div>
  );
}
