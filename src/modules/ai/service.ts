import { crmService } from "@/modules/crm/service";
import { inventoryService } from "@/modules/inventory/service";
import { staffService } from "@/modules/staff/service";
import { db } from "@/lib/db";
import { DEFAULT_SERVICE_INTERVAL_KM } from "@/lib/constants";
import { formatRM } from "@/lib/money";
import { t, tpl, type Lang } from "@/lib/i18n";

/**
 * AI Command Centre (§39) — rule-based in the prototype; OpenAI later.
 * AI is never the source of truth for money, stock, mileage or KPIs (§88).
 */
export class AiService {
  async recommendations(branchId?: string, lang: Lang = "en") {
    const out: {
      icon: string; title: string; detail: string; action: string; href: string; tone: "danger" | "warn" | "info" | "success";
    }[] = [];

    const reminders = await crmService.reminders();
    const overdue = reminders.filter((r) => r.status === "OVERDUE" || r.status === "DUE");
    if (overdue.length > 0) {
      const potential = overdue.length * 12000;
      out.push({
        icon: "users", title: tpl("ai.overdue.title", lang, { n: overdue.length }),
        detail: tpl("ai.overdue.detail", lang, { rm: formatRM(potential) }),
        action: t("ai.overdue.action", lang), href: "/workshop/crm/reminders", tone: "danger",
      });
    }

    if (branchId) {
      const recs = await inventoryService.reorderRecommendations(branchId);
      const urgent = recs.filter((r) => r.daysRemaining !== null && r.daysRemaining <= 7);
      if (urgent.length > 0) {
        out.push({
          icon: "box", title: tpl("ai.stock.title", lang, { n: urgent.length }),
          detail: tpl("ai.stock.detail", lang, { products: urgent.slice(0, 3).map((u) => u.name).join(", ") }),
          action: t("ai.stock.action", lang), href: "/workshop/inventory/stock", tone: "warn",
        });
      }

      const dead = await inventoryService.deadStock(branchId);
      const deadValue = dead.reduce((s, r) => s + r.valueSen, 0);
      if (deadValue > 0) {
        out.push({
          icon: "tag", title: tpl("ai.dead.title", lang, { rm: formatRM(deadValue), n: dead.length }),
          detail: t("ai.dead.detail", lang),
          action: t("ai.dead.action", lang), href: "/workshop/inventory/dead-stock", tone: "warn",
        });
      }
    }

    const kpi = await staffService.kpiBoard(branchId, 30);
    if (kpi.staff.length > 0) {
      const withPkg = kpi.staff.filter((s) => s.packageConversion > 0);
      const avgConv = withPkg.length ? withPkg.reduce((s, x) => s + x.packageConversion, 0) / withPkg.length : 0;
      if (avgConv < 70) {
        out.push({
          icon: "trending", title: tpl("ai.kpi.title", lang, { n: Math.round(avgConv) }),
          detail: t("ai.kpi.detail", lang),
          action: t("ai.kpi.action", lang), href: "/workshop/staff/kpi", tone: "info",
        });
      }
    }
    return out;
  }

  /** Sales recommendations for a job (§23): oil filter / oil / brake check with reasons + script. */
  async salesRecommendations(jobId: string) {
    const job = await db.serviceJob.findUnique({
      where: { id: jobId },
      include: { motorcycle: true, parts: { include: { product: true } }, items: true },
    });
    if (!job) return [];
    return this.buildRecs(job.motorcycle, job.mileage, job.parts, job.items);
  }

  /** Recommendations for a motorcycle (used by the create-job form before the job exists). */
  async salesRecommendationsForMotorcycle(motorcycleId: string, mileage: number) {
    const m = await db.motorcycle.findUnique({ where: { id: motorcycleId } });
    if (!m) return [];
    return this.buildRecs(m, mileage, [], []);
  }

  private async buildRecs(
    m: { lastOilFilterMileage: number | null; lastOilChangeMileage: number | null; lastServiceMileage: number | null },
    mileage: number,
    parts: { product: { name: string } }[],
    items: { description: string }[]
  ) {
    const recs: { kind: "item" | "part"; description: string; reason: string; script: string; priceSen: number; productId?: string; unitCostSen?: number }[] = [];
    const distanceSinceFilter = mileage - (m.lastOilFilterMileage ?? 0);
    const distanceSinceOil = mileage - (m.lastOilChangeMileage ?? 0);
    const alreadyHasFilter = parts.some((p) => /filter/i.test(p.product.name)) || items.some((i) => /filter/i.test(i.description));

    if (distanceSinceFilter >= 5000 && !alreadyHasFilter) {
      const filter = await db.product.findFirst({ where: { name: { contains: "Oil Filter" } } });
      if (filter) {
        recs.push({
          kind: "part", description: filter.name, productId: filter.id, unitCostSen: filter.costPriceSen, priceSen: filter.sellPriceSen,
          reason: "Last replacement recorded " + distanceSinceFilter.toLocaleString() + " km ago.",
          script: "Abang, oil filter ni dah lama tak tukar. Kalau tukar sekali dengan minyak hitam, oil circulation akan lebih bersih.",
        });
      }
    }
    if (distanceSinceOil >= 3000 && !items.some((i) => /oil/i.test(i.description))) {
      recs.push({
        kind: "item", description: "Engine Oil (Semi-Synthetic 10W-40)", priceSen: 3500,
        reason: "Last oil change " + distanceSinceOil.toLocaleString() + " km ago.",
        script: "Minyak hitam dah lebih " + Math.floor(distanceSinceOil / 1000) + " ribu km. Tukar sekarang supaya enjin sentiasa licin dan jimat minyak.",
      });
    }
    if (mileage - (m.lastServiceMileage ?? 0) >= DEFAULT_SERVICE_INTERVAL_KM) {
      recs.push({
        kind: "item", description: "Brake Inspection + Service", priceSen: 1500,
        reason: "Recommended with every standard service for rider safety.",
        script: "Kami check brake sekali dengan servis — keselamatan abang nombor satu.",
      });
    }
    return recs;
  }
}

export const aiService = new AiService();