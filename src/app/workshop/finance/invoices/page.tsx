import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { applyBranchScope } from "@/lib/branch-scope";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";
import { formatRM } from "@/lib/money";
import { fmtDate } from "@/lib/format";
import { PageTransition } from "@/components/shared/page-transition";
import { InvoicePaymentPanel } from "@/components/workshop/invoice-payment-panel";
import { orderInvoiceLines } from "@/lib/invoice-lines";

export const dynamic = "force-dynamic";

const STATUS_FILTERS: { key: string; labelKey: string }[] = [
  { key: "", labelKey: "ws.jobs.all" },
  { key: "ISSUED", labelKey: "inv.issued" },
  { key: "PAID", labelKey: "inv.paid" },
];

export default async function WorkshopInvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; date?: string; q?: string }> }) {
  const sp = await searchParams;
  const lang = await getLang();
  const session = await getSessionUser();
  // 仅员工可查看
  if (session.kind !== "staff") {
    return <p className="text-sm text-muted-foreground p-8">{t("common.denied", lang)}</p>;
  }
  const q = sp.q?.trim() ?? "";
  // 日期(issuedAt 当日)+ 搜索(发票号/工单号/客户名/车牌) —— 计数也按此范围(不含 status)统计
  const searchWhere: Record<string, unknown> = {};
  if (sp.date) {
    const d = new Date(sp.date + "T00:00:00Z");
    const next = new Date(d.getTime() + 86400000);
    searchWhere.issuedAt = { gte: d, lt: next };
  }
  if (q) {
    searchWhere.OR = [
      { invoiceNumber: { contains: q } },
      { job: { jobNumber: { contains: q } } },
      { job: { customer: { name: { contains: q } } } },
      { job: { motorcycle: { plate: { contains: q } } } },
    ];
  }
  applyBranchScope(searchWhere, session, null); // 严格隔离：branch 级只看本分行发票
  const countWhere = { ...searchWhere };
  const where = { ...searchWhere, ...(sp.status ? { status: sp.status } : {}) };
  const [invoices, statusGroups] = await Promise.all([
    db.invoice.findMany({
      where: where as Prisma.InvoiceWhereInput,
      include: {
        job: { include: { customer: { select: { id: true, name: true } }, motorcycle: { select: { brand: true, model: true, plate: true } } } },
        payments: true,
        // The invoice's own lines, so the counter can read what was billed without
        // opening the job. See src/lib/invoice-lines.ts for why these and not the job's.
        items: true,
      },
      orderBy: { issuedAt: "desc" },
    }),
    db.invoice.groupBy({ by: ["status"], where: countWhere as Prisma.InvoiceWhereInput, _count: { _all: true } }),
  ]);
  const statusCounts: Record<string, number> = {};
  for (const g of statusGroups) statusCounts[g.status] = g._count._all;
  const allCount = statusGroups.reduce((s, g) => s + g._count._all, 0);

  return (
    <PageTransition>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("inv.page-title", lang)}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t("inv.page-sub", lang)} · {allCount} {t("inv.invoices", lang)}</p>

        {/* date + search filters */}
        <form method="get" className="flex flex-wrap items-center gap-2 mt-4 mb-3 text-sm">
          <input name="date" type="date" defaultValue={sp.date} className="rounded-md border bg-background px-3 py-2" />
          <input name="q" type="search" defaultValue={sp.q} placeholder={t("inv.search-hint", lang)} className="rounded-md border bg-background px-3 py-2 min-w-64" />
          <button className="rounded-md border px-3 py-2 font-medium hover:bg-accent">{t("common.apply", lang)}</button>
          {(sp.status || sp.date || sp.q) && <Link href="/workshop/finance/invoices" className="rounded-md border border-dashed px-3 py-2 font-medium text-muted-foreground hover:text-foreground hover:bg-accent">{t("book.reset-filters", lang)}</Link>}
        </form>

        {/* status filter pills with counts */}
        <div className="flex flex-wrap items-center gap-1.5 mt-4 mb-4">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.key || "all"}
              href={"/workshop/finance/invoices" + (f.key ? "?status=" + f.key : "")}
              className={"rounded-full border px-3 py-1 text-xs font-medium transition-colors " + ((sp.status ?? "") === f.key ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}
            >
              {t(f.labelKey, lang)} <span className="ml-1 tabular-nums text-muted-foreground/70">{f.key ? (statusCounts[f.key] ?? 0) : allCount}</span>
            </Link>
          ))}
        </div>

        <div className="space-y-3">
          {invoices.length === 0 && <p className="text-sm text-muted-foreground text-center py-10">{t("inv.empty", lang)}</p>}
          {invoices.map((inv) => {
            const paidSen = inv.payments.filter((p) => p.status === "PAID" && p.method !== "PAY_LATER").reduce((s, p) => s + p.amountSen, 0);
            const lines = orderInvoiceLines(inv.items);
            return (
              <div key={inv.id} className="rounded-2xl border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-mono text-sm font-semibold">{inv.invoiceNumber}</div>
                    <div className="text-xs text-muted-foreground">
                      {inv.job ? <>
                        <Link href={"/workshop/jobs/" + inv.job.id} className="text-primary hover:underline">{inv.job.jobNumber}</Link> · {inv.job.customer.name} · {inv.job.motorcycle.brand} {inv.job.motorcycle.model} · {inv.job.motorcycle.plate}
                      </> : t("inv.no-job", lang)}
                    </div>
                    <div className="text-[11px] text-muted-foreground/70 mt-0.5">{fmtDate(inv.issuedAt)}</div>
                  </div>
                  <div className="text-right">
                    <span className={"rounded-full px-2.5 py-1 text-[11px] font-bold " + (inv.status === "PAID" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300")}>
                      {inv.status === "PAID" ? t("inv.paid", lang) : t("inv.issued", lang)}
                    </span>
                    <div className="mt-1 text-xs text-muted-foreground">{t("inv.total", lang)} <span className="font-bold text-foreground tabular-nums">{formatRM(inv.totalSen)}</span></div>
                  </div>
                </div>
                {/* Expandable lines, so a counter can check what was billed without
                    leaving for the job page. Native <details> rather than a client
                    component: a disclosure needs no JavaScript, and this page is a
                    Server Component. */}
                <details className="group mt-3" data-testid="invoice-details">
                  <summary
                    data-testid="invoice-details-toggle"
                    className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted [&::-webkit-details-marker]:hidden"
                  >
                    <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                    <span className="group-open:hidden">{t("inv.view-details", lang)}</span>
                    <span className="hidden group-open:inline">{t("inv.hide-details", lang)}</span>
                    {lines.length > 0 && <span className="text-muted-foreground">· {lines.length}</span>}
                  </summary>

                  <div className="mt-2 rounded-xl border bg-muted/20">
                    {lines.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-muted-foreground">{t("inv.no-lines", lang)}</p>
                    ) : (
                      <div className="divide-y divide-border">
                        {lines.map((l) => (
                          <div key={l.id} className="flex items-baseline gap-3 px-3 py-2 text-sm">
                            <span className="min-w-0 flex-1">{l.description}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{l.quantity} × {formatRM(l.unitPriceSen)}</span>
                            <span className="shrink-0 font-medium tabular-nums">{formatRM(l.lineTotalSen)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="space-y-1 border-t px-3 py-2 text-xs">
                      <div className="flex justify-between text-muted-foreground"><span>{t("pdf.subtotal", lang)}</span><span className="tabular-nums">{formatRM(inv.subtotalSen)}</span></div>
                      {inv.discountSen > 0 && <div className="flex justify-between text-muted-foreground"><span>{t("pdf.discount", lang)}</span><span className="tabular-nums">−{formatRM(inv.discountSen)}</span></div>}
                      {inv.taxSen > 0 && <div className="flex justify-between text-muted-foreground"><span>{t("pdf.tax", lang)}</span><span className="tabular-nums">{formatRM(inv.taxSen)}</span></div>}
                      <div className="flex justify-between font-semibold"><span>{t("common.total", lang)}</span><span className="tabular-nums">{formatRM(inv.totalSen)}</span></div>
                    </div>
                  </div>
                </details>

                <div className="mt-3">
                  <InvoicePaymentPanel
                    invoice={{
                      id: inv.id,
                      invoiceNumber: inv.invoiceNumber,
                      status: inv.status,
                      subtotalSen: inv.subtotalSen,
                      promoDiscountSen: inv.discountSen,
                      taxSen: inv.taxSen,
                      totalSen: inv.totalSen,
                      paidSen,
                      manualDiscountSen: inv.manualDiscountSen,
                      manualDiscountKind: inv.manualDiscountKind,
                      manualDiscountValue: inv.manualDiscountValue,
                      manualDiscountReason: inv.manualDiscountReason,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </PageTransition>
  );
}