import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { jobService } from "@/modules/service-jobs/service";
import { getSessionUser } from "@/lib/session-user";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";
import { formatRM } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { QuotationPrintActions } from "@/components/workshop/quotation-print-actions";
import type { QuoteLine } from "@/modules/quotations/service";
import { promisedPromoFor } from "@/modules/marketing/promo-resolve";

export const dynamic = "force-dynamic";

const STATUS_KEY: Record<string, string> = { PENDING: "pdf.pending", APPROVED: "pdf.approved", REJECTED: "pdf.rejected" };
const KIND_LABEL: Record<string, string> = { PART: "ws.kind.part", LABOUR: "ws.kind.labour", SERVICE: "ws.kind.service", ADDON: "ws.kind.addon", FEE: "ws.kind.fee" };

export default async function QuotationPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang = await getLang();
  const session = await getSessionUser();
  if (session.kind !== "staff") redirect("/workshop/dashboard");

  const detail = await jobService.getDetail(id);
  if (!detail) notFound();
  const org = await db.organisation.findFirst();
  const q = detail.quotation;
  const lines: QuoteLine[] = q?.itemsJson ? (() => { try { return JSON.parse(q.itemsJson) as QuoteLine[]; } catch { return []; } })() : [];
  const partsSen = lines.filter((l) => l.kind === "PART").reduce((s, l) => s + l.lineTotalSen, 0);
  const labourSen = lines.filter((l) => l.kind !== "PART").reduce((s, l) => s + l.lineTotalSen, 0);
  const total = q?.totalSen ?? lines.reduce((s, l) => s + l.lineTotalSen, 0);
  // The paper the customer signs has to carry the promotion they were promised — the same
  // promise the rider card shows and the invoice will honour.
  const promo = promisedPromoFor(detail.booking?.promoSnapshot, total);
  const payableSen = Math.max(0, total - (promo?.discountSen ?? 0));
  const isRepair = detail.type === "REPAIR";
  const docNo = q ? "QUO-" + detail.jobNumber + "-" + q.revision : "QUO-" + detail.jobNumber;
  const statusLabel = q ? t(STATUS_KEY[q.status] ?? "pdf.pending", lang) : t("pdf.pending", lang);

  return (
    <div className="min-h-screen bg-muted/40">
      <QuotationPrintActions />
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
            {detail.branch && <div className="mt-2 text-xs text-neutral-600">{detail.branch.name} · {detail.branch.city}{detail.branch.address ? " · " + detail.branch.address : ""}</div>}
          </div>
          {org?.logo ? <img src={org.logo} alt={org.name ?? "logo"} className="h-16 w-16 object-contain" /> : <div className="h-16 w-16 rounded-xl bg-neutral-100" />}
        </div>

        {/* Document meta */}
        <div className="mt-6 flex items-start justify-between">
          <div>
            <div className="text-2xl font-bold">{isRepair ? t("pdf.repair-quote", lang) : t("pdf.quote", lang)}</div>
            <div className="mt-1 text-sm text-neutral-600">{t("pdf.doc-number", lang)} <span className="font-mono font-semibold text-neutral-900">{docNo}</span></div>
          </div>
          <div className="text-right text-xs text-neutral-600">
            <div>{t("pdf.date", lang)} <span className="font-medium text-neutral-900">{q ? fmtDate(q.sentAt) : fmtDate(new Date())}</span></div>
            <div className="mt-1">{t("pdf.rev", lang)} <span className="font-medium text-neutral-900">#{q?.revision ?? 1}</span></div>
            <div className="mt-1">{t("pdf.status", lang)} <span className={"font-semibold " + (q?.status === "APPROVED" ? "text-emerald-700" : q?.status === "REJECTED" ? "text-rose-700" : "text-amber-700")}>{statusLabel}</span></div>
          </div>
        </div>

        {/* Parties */}
        <div className="mt-6 grid grid-cols-2 gap-6 rounded-xl bg-neutral-50 p-4 text-sm">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">{t("pdf.customer", lang)}</div>
            <div className="mt-1 font-semibold">{detail.customer.name}</div>
            <div className="text-xs text-neutral-600">{detail.customer.phone ?? "—"}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">{t("pdf.motorcycle", lang)}</div>
            <div className="mt-1 font-semibold">{detail.motorcycle.brand} {detail.motorcycle.model}</div>
            <div className="text-xs text-neutral-600">{detail.motorcycle.plate} · {detail.motorcycle.year} · {detail.motorcycle.type}</div>
          </div>
        </div>

        {/* Job info */}
        <div className="mt-5 flex flex-wrap gap-x-8 gap-y-1.5 text-xs text-neutral-600">
          <div>{t("pdf.job", lang)} <span className="font-mono font-semibold text-neutral-900">{detail.jobNumber}</span></div>
          <div>{t("pdf.mileage", lang)} <span className="font-medium text-neutral-900">{detail.mileage.toLocaleString()} km</span></div>
          {detail.packageName && <div>{t("pdf.package", lang)} <span className="font-medium text-neutral-900">{detail.packageName}</span></div>}
          {detail.customerRequest && <div className="w-full">{t("pdf.request", lang)} <span className="font-medium text-neutral-900">“{detail.customerRequest}”</span></div>}
        </div>

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
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-neutral-100">
                <td className="py-2 pr-2">{l.description}</td>
                <td className="py-2 pr-2 text-xs text-neutral-500">{KIND_LABEL[l.kind] ? t(KIND_LABEL[l.kind], lang) : l.kind}</td>
                <td className="py-2 pr-2 text-center tabular-nums">{l.qty}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatRM(l.unitPriceSen)}</td>
                <td className="py-2 text-right font-semibold tabular-nums">{formatRM(l.lineTotalSen)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <div className="w-56 space-y-1.5 text-sm">
            {partsSen > 0 && <div className="flex justify-between text-neutral-600"><span>{t("pdf.parts-sub", lang)}</span><span className="tabular-nums">{formatRM(partsSen)}</span></div>}
            {labourSen > 0 && <div className="flex justify-between text-neutral-600"><span>{t("pdf.labour-sub", lang)}</span><span className="tabular-nums">{formatRM(labourSen)}</span></div>}
            {promo && (
              <div data-testid="print-quotation-promo" className="flex justify-between text-emerald-700">
                <span>{t("quotation.promo", lang)} · {promo.name}</span>
                <span className="tabular-nums">−{formatRM(promo.discountSen)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-neutral-200 pt-2 text-base font-bold"><span>{t("pdf.total", lang)}</span><span data-testid="print-quotation-total" className="tabular-nums">{formatRM(payableSen)}</span></div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12">
          <div className="text-xs text-neutral-500">{t("pdf.validity", lang)}</div>
          <div className="mt-10 w-56 border-t border-neutral-300 text-center text-xs text-neutral-600">{t("pdf.signature", lang)}</div>
        </div>
      </div>
    </div>
  );
}
