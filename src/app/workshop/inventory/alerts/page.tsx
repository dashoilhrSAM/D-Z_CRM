import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Money } from "@/components/shared/money";
import { inventoryService } from "@/modules/inventory/service";
import { db } from "@/lib/db";
import { ReorderActions } from "@/components/workshop/reorder-actions";
import { getLang } from "@/lib/get-lang";
import { getSessionUser } from "@/lib/session-user";
import { scopedBranchId } from "@/lib/branch-scope";
import { t } from "@/lib/i18n";
import { invReason } from "@/lib/inv-labels";

export const dynamic = "force-dynamic";

export default async function StockAlertsPage() {
  const session = await getSessionUser();
  const scopedBranch = scopedBranchId(session);
  const branch = scopedBranch ? await db.branch.findUnique({ where: { id: scopedBranch } }) : await db.branch.findFirst({ where: { isMain: true } });
  const rows = await inventoryService.stockStatus(branch!.id);
  const alerts = rows.filter((r) => r.level === "CRITICAL" || r.level === "OUT_OF_STOCK" || r.level === "LOW");
  const lang = await getLang();
  return (
    <div>
      <PageHeader title={t("ws.alerts.title", lang)} subtitle={t("ws.alerts.subtitle", lang)} />
      <div data-tut="alerts-list" className="space-y-2">
        {alerts.map((r) => (
          <div key={r.productId} className="flex flex-wrap items-center gap-3 dz-panel p-4">
            <div className="flex-1 min-w-44">
              <div className="flex items-center gap-2 font-medium text-sm">{r.name}
                <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 " + (r.level === "CRITICAL" ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900" : r.level === "OUT_OF_STOCK" ? "bg-slate-100 text-slate-700 dark:bg-slate-950/60 dark:text-slate-300 ring-slate-300" : r.level === "LOW" ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900" : "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900")}>{t("ws.stock.level." + r.level, lang)}</span>
              </div>
              <div className="text-xs text-muted-foreground">{r.sku} · {r.reason ? invReason(r.reason, lang) : t("ws.stock.level." + r.level, lang)}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold tabular-nums">{r.quantity} <span className="text-xs font-normal text-muted-foreground">{t("ws.alerts.min", lang)} {r.minStock}</span></div>
            </div>
            <div className="text-sm font-semibold tabular-nums"><Money sen={r.valueSen} /></div>
            <ReorderActions productId={r.productId} productName={r.name} quantity={r.quantity} recommended={r.recommendedReorderQty || r.minStock * 2} />
          </div>
        ))}
        {alerts.length === 0 && <p className="text-sm text-muted-foreground text-center py-10">{t("ws.alerts.empty", lang)}</p>}
      </div>
    </div>
  );
}