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

export default async function ReorderPage() {
  const session = await getSessionUser();
  const scopedBranch = scopedBranchId(session);
  const branch = scopedBranch ? await db.branch.findUnique({ where: { id: scopedBranch } }) : await db.branch.findFirst({ where: { isMain: true } });
  const recs = await inventoryService.reorderRecommendations(branch!.id);
  const suppliers = await inventoryService.suppliers();
  const lang = await getLang();
  return (
    <div>
      <PageHeader title={t("ws.reorder.title", lang)} subtitle={t("ws.reorder.subtitle", lang)} />
      <div className="space-y-2">
        {recs.map((r) => {
          const sup = suppliers.find((s) => s.id === r.supplierId);
          return (
            <div key={r.productId} className="flex flex-wrap items-center gap-3 dz-panel p-4">
              <div className="flex-1 min-w-44">
                <div className="font-medium text-sm">{r.name}</div>
                <div className="text-xs text-muted-foreground">{t("ws.reorder.current-stock", lang)} {r.quantity} · {t("ws.reorder.est-days-left", lang)} {r.daysRemaining ?? "—"} · {invReason(r.reason ?? "", lang)}</div>
              </div>
              <div className="text-right text-sm">
                <div className="font-semibold">{t("ws.reorder.recommended", lang)} {r.recommendedReorderQty || r.minStock * 2}×</div>
                <div className="text-xs text-muted-foreground">{sup?.name ?? "—"} · {t("ws.reorder.lead", lang)} {r.leadTimeDays ?? "—"} {t("ws.reorder.days", lang)}</div>
              </div>
              <div className="text-sm font-semibold tabular-nums"><Money sen={r.valueSen} /></div>
              <ReorderActions productId={r.productId} productName={r.name} quantity={r.quantity} recommended={r.recommendedReorderQty || r.minStock * 2} />
            </div>
          );
        })}
        {recs.length === 0 && <p className="text-sm text-muted-foreground text-center py-10">{t("ws.reorder.empty", lang)}</p>}
      </div>
    </div>
  );
}