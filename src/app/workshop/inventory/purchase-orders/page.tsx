import { PageHeader } from "@/components/shared/page-header";
import { Money } from "@/components/shared/money";
import { inventoryService } from "@/modules/inventory/service";
import { fmtDate } from "@/lib/format";
import { POReceive } from "@/components/workshop/po-receive";
import { getLang } from "@/lib/get-lang";
import { getSessionUser } from "@/lib/session-user";
import { scopedBranchId } from "@/lib/branch-scope";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage() {
  const session = await getSessionUser();
  const rows = await inventoryService.purchaseOrders(scopedBranchId(session));
  const lang = await getLang();
  return (
    <div>
      <PageHeader title={t("ws.po.title", lang)} subtitle={t("ws.po.subtitle", lang)} />
      <div className="space-y-2">
        {rows.map((po) => (
          <div key={po.id} className="dz-panel p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1">
                <div className="font-medium text-sm">{po.supplier.name}</div>
                <div className="text-xs text-muted-foreground">{t("ws.po.created", lang)} {fmtDate(po.createdAt)} · {po.items.length} {t("ws.po.lines", lang)}</div>
              </div>
              <span className={"rounded-full px-2.5 py-0.5 text-[11px] font-bold " + (po.status === "RECEIVED" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" : po.status === "DRAFT" ? "bg-slate-100 text-slate-600" : "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300")}>{t("ws.po.status." + po.status, lang)}</span>
              <div className="font-bold tabular-nums"><Money sen={po.totalSen} /></div>
              <POReceive poId={po.id} status={po.status} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {po.items.map((i) => (
                <span key={i.id} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{i.product} ×{i.quantity}</span>
              ))}
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted-foreground text-center py-10">{t("ws.po.empty", lang)}</p>}
      </div>
    </div>
  );
}