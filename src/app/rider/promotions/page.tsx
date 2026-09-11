import Link from "next/link";
import { Tag, CalendarPlus, Megaphone, Clapperboard, BookOpen, ChevronRight, ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { getLang } from "@/lib/get-lang";
import { t, tpl } from "@/lib/i18n";
import { isPromoActive } from "@/modules/marketing/promo";
import { MaterialGrid } from "@/components/rider/material-grid";

export const dynamic = "force-dynamic";

const TYPE_META: Record<string, { labelKey: string; icon: typeof Tag; grad: string }> = {
  POSTER: { labelKey: "promo.posters", icon: Megaphone, grad: "from-sky-500 to-indigo-600" },
  REEL: { labelKey: "promo.reels", icon: Clapperboard, grad: "from-fuchsia-500 to-purple-600" },
  STORY: { labelKey: "promo.stories", icon: BookOpen, grad: "from-emerald-500 to-teal-600" },
};

export default async function RiderPromotionsPage() {
  const lang = await getLang();
  const [campaigns, assets] = await Promise.all([
    db.campaign.findMany({ where: { status: "ACTIVE" }, orderBy: { startDate: "desc" } }),
    // The workshop controls each poster with an on/off-News toggle, so this has to honour it.
    // It did not: this page listed every asset while the News feed filtered, which is how
    // switched-off posters kept reaching riders through the "view all" link.
    db.marketingAsset.findMany({ where: { published: true }, orderBy: { month: "desc" } }),
  ]);
  const livePromos = campaigns.filter((c) => isPromoActive(c as never));
  const groups = (["POSTER", "REEL", "STORY"] as const)
    .map((tpe) => ({ type: tpe, labelKey: TYPE_META[tpe].labelKey, grad: TYPE_META[tpe].grad, items: assets.filter((a) => a.type === tpe) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <Link href="/rider/home" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ChevronLeft className="h-4 w-4" /> {t("promo.home", lang)}</Link>

      <div>
        <h1 className="text-2xl font-bold">{t("promo.title", lang)}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("promo.sub", lang)}</p>
      </div>

      {livePromos.length > 0 && (
        <section>
          <div className="flex items-center gap-1.5 mb-2">
            <Tag className="h-4 w-4 text-purple-600 dark:text-purple-300" />
            <h2 className="font-semibold">{t("promo.active", lang)}</h2>
          </div>
          <div className="space-y-2">
            {livePromos.map((p) => (
              <Link
                key={p.id}
                href={"/rider/book?campaign=" + p.id + "&promo=" + encodeURIComponent(p.name)}
                className="flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-purple-600 to-fuchsia-600 text-white p-4 hover:opacity-95 transition-opacity"
              >
                <div>
                  <div className="font-semibold">{p.name}</div>
                  {p.discountPercent && <div className="mt-0.5 text-xs opacity-90">{tpl("promo.save", lang, { n: p.discountPercent })}</div>}
                </div>
                {p.discountPercent && (
                  <span className="shrink-0 rounded-full bg-white/20 px-3 py-1 text-sm font-bold">−{p.discountPercent}%</span>
                )}
              </Link>
            ))}
          </div>
          {livePromos[0] && (
            <Link href={"/rider/book?campaign=" + livePromos[0].id + "&promo=" + encodeURIComponent(livePromos[0].name)} className="mt-2 flex items-center justify-center gap-2 rounded-2xl border py-3 text-sm font-semibold text-primary">
              <CalendarPlus className="h-4 w-4" /> {t("promo.book", lang)}
            </Link>
          )}
        </section>
      )}

      <MaterialGrid groups={groups.map((g) => ({ ...g, label: t(g.labelKey, lang) }))} />

      {groups.length === 0 && livePromos.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">{t("promo.empty", lang)}</p>
      )}

      <div className="flex items-center justify-center gap-1 pt-2 text-[11px] text-muted-foreground">
        <ChevronRight className="h-3 w-3" /> {t("promo.footer", lang)}
      </div>
    </div>
  );
}
