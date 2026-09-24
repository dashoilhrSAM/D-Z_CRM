import Link from "next/link";
import { Search } from "lucide-react";
import { customerService } from "@/modules/customers/service";
import { Money } from "@/components/shared/money";
import { fmtDate, fmtKM } from "@/lib/format";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";
import { PendingForm, ExportCsvButton } from "@/components/shared/search-form";
import { Pagination } from "@/components/shared/pagination";
import { PageTransition } from "@/components/shared/page-transition";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  const { q } = sp;
  const page = Math.max(1, Number(sp.page) || 1);
  const lang = await getLang();
  const summaries = await customerService.listSummaries();
  const filtered = q?.trim() ? summaries.filter((c) => (c.name + " " + (c.phone ?? "") + " " + c.motorcycles.map((m) => m.plate + m.model).join(" ")).toLowerCase().includes(q.toLowerCase())) : summaries;
  const PAGE_SIZE = 25;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <PageTransition>
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t("ws.customers.title", lang)}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("ws.customers.summary", lang).replace("{n}", String(summaries.length))}</p>
        </div>
        <PendingForm data-tut="customers-search" className="w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input name="q" defaultValue={q ?? ""} placeholder={t("ws.customers.search-placeholder", lang)} className="h-9 w-full rounded-lg border bg-card pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </PendingForm>
        <ExportCsvButton href="/api/export?type=customers" className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent" />
        <Link href="/workshop/setup" className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent">{t("nav.setup", lang)}</Link>
      </div>

      <div data-tut="customers-list" className="dz-panel overflow-x-auto">
        <div className="overflow-x-auto">
          <table className="dz-table">
            <thead>
              <tr>
                <th className="px-4 py-3 font-medium">{t("ws.customers.col-customer", lang)}</th>
                <th className="px-4 py-3 font-medium">{t("ws.customers.col-motorcycle", lang)}</th>
                <th className="px-4 py-3 font-medium">{t("ws.customers.col-visits", lang)}</th>
                <th className="px-4 py-3 font-medium">{t("ws.customers.col-lifetime-spend", lang)}</th>
                <th className="px-4 py-3 font-medium">{t("ws.customers.col-last-visit", lang)}</th>
                <th className="px-4 py-3 font-medium">{t("common.status", lang)}</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">
                    <Link href={"/workshop/customers/" + c.id} className="font-medium hover:text-primary">{c.name}</Link>
                    <div className="text-xs text-muted-foreground">{c.phone ?? "—"} · {t("ws.customers.since", lang)} {fmtDate(c.joinedAt)}</div>
                  </td>
                  <td className="px-4 py-3">
                    {c.motorcycles.map((m) => (
                      <div key={m.id} className="text-xs">
                        <span className="font-medium">{m.brand} {m.model}</span> · {m.plate}
                        <span className="text-muted-foreground"> · {fmtKM(m.currentMileage)}</span>
                      </div>
                    ))}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{c.visits}</td>
                  <td className="px-4 py-3 tabular-nums font-medium"><Money sen={c.lifetimeSpendSen} /></td>
                  <td className="px-4 py-3 text-muted-foreground">{c.lastVisitAt ? fmtDate(c.lastVisitAt) : "—"}</td>
                  <td className="px-4 py-3">
                    {c.dueStatus === "DUE" && <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-300 ring-1 ring-red-200">{t("ws.customers.due", lang)}</span>}
                    {c.dueStatus === "DUE_SOON" && <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 ring-1 ring-amber-200">{t("ws.customers.due-soon", lang)}</span>}
                    {c.dueStatus === "UPCOMING" && <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300 ring-1 ring-blue-200">{t("ws.customers.upcoming", lang)}</span>}
                    {c.dueStatus === "BOOKED" && <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200">{t("ws.customers.booked", lang)}</span>}
                    {c.dueStatus === "NONE" && <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination basePath="/workshop/customers" page={page} totalPages={totalPages} query={{ q }} />
    </div>
    </PageTransition>
  );
}
