import Link from "next/link";
import { Tag, Megaphone, Package, ChevronRight, Wrench, Flame } from "lucide-react";
import { getRiderCustomer } from "@/lib/rider-customer";
import { db } from "@/lib/db";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";
import { formatRM } from "@/lib/money";
import { assetUrl } from "@/lib/asset-url";
import { isPromoActive } from "@/modules/marketing/promo";
import { PosterCarousel } from "@/components/rider/poster-carousel";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const lang = await getLang();
  await getRiderCustomer();
  const [offers, posters, products] = await Promise.all([
    // Same shared rule as everywhere else on the rider side. A hand-written "endDate >= now"
    // both offered campaigns whose window had not opened and hid the open-ended ones.
    db.campaign.findMany({ where: { type: "PROMO", status: "ACTIVE" }, orderBy: { startDate: "desc" }, take: 24 })
      .then((rows) => rows.filter((c) => isPromoActive(c as never)).slice(0, 5)),
    db.marketingAsset.findMany({ where: { published: true }, orderBy: { createdAt: "desc" }, take: 4 }).then((as) => as.map((a) => ({ ...a, url: assetUrl(a.url) }))),
    db.product.findMany({ where: { imageUrl: { not: null } }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, name: true, brand: true, category: true, sellPriceSen: true, imageUrl: true } }).then((ps) => ps.map((p) => ({ ...p, imageUrl: assetUrl(p.imageUrl) }))),
  ]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t("news.title", lang)}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("news.desc", lang)}</p>
      </div>

      {/* special offers */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">{t("news.offers", lang)}</h2>
          <Link href="/rider/promotions" className="text-xs font-medium text-primary hover:underline">{t("news.view-all", lang)} →</Link>
        </div>
        {offers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("news.no-offers", lang)}</p>
        ) : (
          <div className="space-y-2.5">
            {offers.map((c) => (
              <div key={c.id} className="dz-panel p-4 flex items-center gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Tag className="h-5 w-5" /></span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{(c.startDate.getMonth() + 1) + "/" + c.startDate.getFullYear()}{c.endDate ? " – " + (c.endDate.getMonth() + 1) + "/" + c.endDate.getFullYear() : ""}</div>
                </div>
                {c.discountPercent && <span className="shrink-0 rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-bold text-rose-600 dark:text-rose-300">−{c.discountPercent}%</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* latest posters */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">{t("news.posters", lang)}</h2>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Megaphone className="h-3.5 w-3.5" /></span>
        </div>
        {posters.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("news.no-posters", lang)}</p>
        ) : (
          <PosterCarousel posters={posters} />
        )}
      </section>

      {/* hot picks — featured products that have photos */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">{t("news.products", lang)}</h2>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Flame className="h-3.5 w-3.5" /></span>
        </div>
        <p className="text-xs text-muted-foreground mb-2">{t("news.hot-picks-desc", lang)}</p>
        {products.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("news.no-products", lang)}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {products.map((p) => (
              <div key={p.id} className="dz-panel p-3">
                <div className="aspect-[4/3] overflow-hidden rounded-lg bg-muted/60">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground/60"><Wrench className="h-8 w-8" /></div>
                  )}
                </div>
                <div className="mt-2 text-sm font-medium leading-tight line-clamp-2">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.brand ?? p.category ?? ""}</div>
                <div className="mt-1 text-sm font-bold tabular-nums text-primary">{formatRM(p.sellPriceSen)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* pointer back to bike passports for service records */}
      <Link href="/rider/motorcycles" className="dz-card-link flex items-center justify-between rounded-2xl border bg-card p-4">
        <div>
          <div className="text-sm font-semibold">{t("svc.history-title", lang)}</div>
          <div className="text-xs text-muted-foreground">{t("news.passport-desc", lang)}</div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>
    </div>
  );
}