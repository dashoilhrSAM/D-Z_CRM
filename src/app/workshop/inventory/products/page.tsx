import { PageHeader } from "@/components/shared/page-header";
import { ProductManager } from "@/components/workshop/product-manager";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { isOrgLevelRole } from "@/lib/branch-scope";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const lang = await getLang();
  const session = await getSessionUser();
  const isOrgLevel = session.kind === "staff" && isOrgLevelRole(session.role);
  const rows = await db.product.findMany({ orderBy: { name: "asc" } });
  return (
    <div>
      <PageHeader title={t("ws.products.title", lang)} subtitle={t("ws.products.subtitle", lang).replace("{n}", String(rows.length))} />
      <ProductManager
        isOrgLevel={isOrgLevel}
        products={rows.map((p) => ({
          id: p.id, name: p.name, sku: p.sku, manufacturerPartNo: p.manufacturerPartNo ?? null,
          category: p.category ?? null, brand: p.brand ?? null, sellPriceSen: p.sellPriceSen,
          costPriceSen: p.costPriceSen, minStock: p.minStock, active: p.active,
        }))}
      />
    </div>
  );
}
