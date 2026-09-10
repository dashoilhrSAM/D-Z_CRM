import type { IMarketingRepository } from "./repository";
import { PrismaMarketingRepository } from "@/repositories/prisma/marketing.repository";
import type { AudienceRules } from "./audience";

export interface CreateCampaignInput {
  branchId: string;
  name: string;
  type: "RETURN" | "REMINDER" | "PROMO" | "NEWS";
  /** Legacy audience code (kept for back-compat and for campaigns without rules). */
  audience?: string;
  /** MKT-005..012: declarative segment rules; takes precedence over `audience`. */
  audienceRules?: AudienceRules | null;
  status: "DRAFT" | "SCHEDULED" | "ACTIVE" | "ENDED";
  startDate: Date;
  endDate?: Date | null;
  discountPercent?: number | null;
  /** MKT-014: bonus loyalty points awarded for bookings this campaign drove. */
  pointsBonus?: number | null;
}

export interface CreateAssetInput {
  branchId: string;
  title: string;
  type?: string;
  month?: string | null;
  description?: string | null;
  url?: string | null;
}

export interface CreateScriptInput {
  branchId: string;
  title: string;
  platform?: string;
  hook?: string | null;
  body: string;
  tone?: string | null;
}

export class MarketingService {
  constructor(private repo: IMarketingRepository = new PrismaMarketingRepository()) {}

  async overview() {
    const [campaigns, assets, scripts] = await Promise.all([
      this.repo.listCampaigns(),
      this.repo.listAssets(),
      this.repo.listScripts(),
    ]);
    return {
      campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, type: c.type, status: c.status, audience: c.audience, audienceRules: c.audienceRules, discountPercent: c.discountPercent, pointsBonus: c.pointsBonus, startDate: c.startDate, endDate: c.endDate, branch: c.branch.city })),
      assets: assets.map((a) => ({ id: a.id, title: a.title, type: a.type, month: a.month, description: a.description, url: a.url, published: a.published })),
      scripts: scripts.map((s) => ({ id: s.id, title: s.title, platform: s.platform, hook: s.hook, body: s.body, tone: s.tone })),
    };
  }

  async createCampaign(input: CreateCampaignInput) {
    return this.repo.createCampaign({
      branchId: input.branchId,
      name: input.name,
      type: input.type,
      audience: input.audience ?? null,
      audienceRules: (input.audienceRules ?? null) as never,
      status: input.status,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      discountPercent: input.discountPercent ?? null,
      pointsBonus: input.pointsBonus ?? null,
    });
  }

  async createAsset(input: CreateAssetInput) {
    return this.repo.createAsset({
      branchId: input.branchId,
      title: input.title,
      type: input.type ?? "POSTER",
      month: input.month ?? null,
      description: input.description ?? null,
      url: input.url ?? null,
    });
  }

  async createScript(input: CreateScriptInput) {
    return this.repo.createScript({
      branchId: input.branchId,
      title: input.title,
      platform: input.platform ?? "TIKTOK",
      hook: input.hook ?? null,
      body: input.body,
      tone: input.tone ?? null,
    });
  }
}

export const marketingService = new MarketingService();
