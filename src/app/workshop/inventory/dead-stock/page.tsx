import { PageHeader } from "@/components/shared/page-header";
import { Money } from "@/components/shared/money";
import { inventoryService } from "@/modules/inventory/service";
import { db } from "@/lib/db";
import { getLang } from "@/lib/get-lang";
import { getSessionUser } from "@/lib/session-user";
import { scopedBranchId } from "@/lib/branch-scope";
import { t } from "@/lib/i18n";
import { invRecommendation } from "@/lib/inv-labels";

export const dynamic = "force-dynamic";

export default async function DeadStockPage() {
  const session = await getSessionUser();
  const scopedBranch = scopedBranchId(session);
  const branch = scopedBranch ? await db.branch.findUnique({ where: { id: scopedBranch } }) : await db.branch.findFirst({ where: { isMain: true } });
  const rows = await inventoryService.deadStock(branch!.id);
  const total = rows.reduce((s, r) => s + r.valueSen, 0);
  const lang = await getLang();
  return (
    <div>
      <PageHeader title={t("ws.dead.title", lang)} subtitle={t("ws.dead.subtitle", lang).replace("{n}", (total / 100).toFixed(0))} />
      <div className="rounded-2xl border bg-card overflow-x-auto">
        <div className="overflow-x-auto">
          <table className="dz-table">
            <thead><tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t("ws.dead.col.product", lang)}</th><th className="px-4 py-3 font-medium">{t("common.qty", lang)}</th>
              <th className="px-4 py-3 font-medium">{t("ws.dead.col.stock-value", lang)}</th><th className="px-4 py-3 font-medium">{t("ws.dead.col.last-sale", lang)}</th>
              <th className="px-4 py-3 font-medium">{t("ws.dead.col.days", lang)}</th><th className="px-4 py-3 font-medium">{t("ws.dead.col.stage", lang)}</th>
              <th className="px-4 py-3 font-medium">{t("ws.dead.col.recommendation", lang)}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-medium">{r.name}<div className="text-xs text-muted-foreground font-mono">{r.sku}</div></td>
                  <td className="px-4 py-2.5 tabular-nums">{r.quantity}</td>
                  <td className="px-4 py-2.5 tabular-nums"><Money sen={r.valueSen} /></td>
                  <td className="px-4 py-2.5 tabular-nums">{r.daysSinceLastSale} {t("ws.dead.days-ago", lang)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{r.daysSinceLastSale}</td>
                  <td className="px-4 py-2.5"><span className={"rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 " + (r.stage === "CRITICAL_DEAD_STOCK" ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900" : r.stage === "DEAD_STOCK_WARNING" ? "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:ring-orange-900" : "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-blue-900")}>{t("ws.dead.stage." + r.stage, lang)}</span></td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{invRecommendation(r.recommendation, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}