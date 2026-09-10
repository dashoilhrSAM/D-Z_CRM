import { PageHeader } from "@/components/shared/page-header";
import { ContentStudio } from "@/components/workshop/content-studio";
import { db } from "@/lib/db";
import { rankOccasions } from "@/modules/marketing/occasions";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ContentStudioPage() {
  const lang = await getLang();

  const [brands, occasionRows] = await Promise.all([
    db.brandProfile.findMany({ where: { active: true }, orderBy: { key: "asc" }, select: { key: true } }),
    db.occasion.findMany({ where: { active: true, type: { not: "PAYDAY" } }, orderBy: { startDate: "asc" }, select: { key: true, name: true, startDate: true, leadDays: true, relevance: true, endDate: true } }),
  ]);

  // Offer the occasions whose content window is open or approaching, ranked — an
  // operator should not have to scroll a two-year calendar to find what matters now.
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const upcoming = rankOccasions(occasionRows, today)
    .filter((r) => r.windowOpen || r.daysUntil > 0)
    .slice(0, 12)
    .map((r) => ({ key: r.occasion.key, name: r.occasion.name + (r.windowOpen ? " · open now" : " · D-" + r.daysUntil) }));

  return (
    <div>
      <PageHeader
        title={t("ws.mkt.studio.title", lang)}
        subtitle={t("ws.mkt.studio.subtitle", lang)}
      />
      <ContentStudio brands={brands.map((b) => b.key)} occasions={upcoming} />
    </div>
  );
}
