"use server";

import { revalidatePath } from "next/cache";
import { marketingService } from "@/modules/marketing/service";
import { broadcast } from "@/modules/marketing/broadcast";
import { getSessionUser } from "@/lib/session-user";
import { scopedBranchId } from "@/lib/branch-scope";
import { buildAudienceWhere, rulesForCampaign, type AudienceRules } from "@/modules/marketing/audience";
import { db } from "@/lib/db";

/** 分行归属：branch 级用户的操作落在自己分行，org 级回退主店。 */
async function defaultBranch() {
  const org = await db.organisation.findFirst();
  const session = await getSessionUser();
  const branchScope = scopedBranchId(session);
  return branchScope
    ? await db.branch.findFirst({ where: { id: branchScope, organisationId: org!.id } })
    : await db.branch.findFirst({ where: { organisationId: org!.id, isMain: true } });
}

async function mainBranchId() {
  const branch = await defaultBranch();
  return branch!.id;
}

export async function createCampaign(input: {
  name: string;
  type: "RETURN" | "REMINDER" | "PROMO" | "NEWS";
  audience?: string;
  /** MKT-005..012: declarative segment rules; takes precedence over the legacy code. */
  audienceRules?: AudienceRules | null;
  status: "DRAFT" | "SCHEDULED" | "ACTIVE" | "ENDED";
  startDate: string;
  endDate?: string;
  discountPercent?: number;
  /** MKT-014: bonus loyalty points for bookings this campaign drove. */
  pointsBonus?: number | null;
}) {
  const branchId = await mainBranchId();
  await marketingService.createCampaign({
    branchId,
    name: input.name,
    type: input.type,
    audience: input.audience,
    audienceRules: input.audienceRules,
    status: input.status,
    startDate: new Date(input.startDate),
    endDate: input.endDate ? new Date(input.endDate) : null,
    discountPercent: input.discountPercent ?? null,
    pointsBonus: input.pointsBonus ?? null,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateCampaign(input: {
  id: string;
  name?: string;
  type?: "RETURN" | "REMINDER" | "PROMO" | "NEWS";
  status?: "DRAFT" | "SCHEDULED" | "ACTIVE" | "ENDED";
  startDate?: string;
  endDate?: string | null;
  discountPercent?: number | null;
  pointsBonus?: number | null;
  audience?: string;
  audienceRules?: AudienceRules | null;
}) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.status !== undefined) data.status = input.status;
  if (input.startDate !== undefined) data.startDate = new Date(input.startDate);
  if (input.endDate !== undefined) data.endDate = input.endDate ? new Date(input.endDate) : null;
  if (input.discountPercent !== undefined) data.discountPercent = input.discountPercent;
  if (input.pointsBonus !== undefined) data.pointsBonus = input.pointsBonus;
  if (input.audience !== undefined) data.audience = input.audience;
  // null clears the rules and falls the campaign back to its legacy audience code
  if (input.audienceRules !== undefined) data.audienceRules = input.audienceRules;
  await db.campaign.update({ where: { id: input.id }, data });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function createPoster(input: {
  title: string;
  type?: string;
  month?: string;
  description?: string;
  url?: string;
}) {
  const branchId = await mainBranchId();
  await marketingService.createAsset({
    branchId,
    title: input.title,
    type: input.type ?? "POSTER",
    month: input.month ?? null,
    description: input.description ?? null,
    url: input.url ?? null,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function createScript(input: {
  title: string;
  platform?: string;
  hook?: string;
  body: string;
  tone?: string;
}) {
  const branchId = await mainBranchId();
  await marketingService.createScript({
    branchId,
    title: input.title,
    platform: input.platform ?? "TIKTOK",
    hook: input.hook ?? null,
    body: input.body,
    tone: input.tone ?? null,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function publishReview(reviewId: string) {
  await db.review.update({ where: { id: reviewId }, data: { status: "PUBLISHED" } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function replyToReview(reviewId: string, reply: string) {
  await db.review.update({ where: { id: reviewId }, data: { reply, repliedAt: new Date(), status: "PUBLISHED" } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Resolve the customers a campaign targets (MKT-005..012).
 * Delegates to the shared audience engine so filtering happens in the database instead
 * of loading every customer and filtering in memory.
 *
 * Only reachable customers (with a phone) are returned — a customer we cannot message
 * is not part of a broadcast audience.
 *
 * Note: the campaign's own branch is deliberately NOT an implicit filter. Cross-branch
 * segments are expressed explicitly via `audienceRules.branches`, so existing campaigns
 * keep their current reach.
 */
async function audienceCustomers(campaign: { audience: string | null; audienceRules: unknown }) {
  const org = await db.organisation.findFirst();
  if (!org) return [];
  return db.customer.findMany({
    where: { AND: [{ phone: { not: null } }, buildAudienceWhere(org.id, rulesForCampaign(campaign))] },
    select: { id: true, name: true, phone: true },
  });
}

/**
 * MKT-013: marketing decides whether live promos auto-apply to every booking or only
 * to bookings that arrived through a campaign link. Money-affecting, so it is an
 * explicit opt-in toggle rather than a code constant.
 */
export async function setPromoAutoApply(enabled: boolean) {
  const org = await db.organisation.findFirst();
  if (!org) return { ok: false };
  await db.organisation.update({ where: { id: org.id }, data: { promoAutoApply: enabled } });
  revalidatePath("/", "layout");
  return { ok: true, enabled };
}

/** MKT-005: how many customers a rule set currently matches (for the campaign editor). */
export async function previewAudienceCount(rules: AudienceRules): Promise<number> {
  const org = await db.organisation.findFirst();
  if (!org) return 0;
  return db.customer.count({
    where: { AND: [{ phone: { not: null } }, buildAudienceWhere(org.id, rules)] },
  });
}

/** One-click WhatsApp broadcast to a campaign's audience. Persists messages linked to the campaign. */
export async function broadcastCampaign(input: { campaignId: string; message?: string }) {
  const campaign = await db.campaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign) throw new Error("Campaign not found");

  const customers = await audienceCustomers({ audience: campaign.audience, audienceRules: campaign.audienceRules });
  const body = input.message?.trim() || "Hi, " + campaign.name + " is on now at D&Z Smart Workshop" + (campaign.discountPercent ? " — save " + campaign.discountPercent + "%!" : " — book your service today!");
  // Single shared pipeline: MSG-017 opt-out, real delivery status, MSG-020 failure
  // records, real-outcome counting and the frequency cap all live in marketing/broadcast.
  const result = await broadcast({
    customerIds: customers.map((c) => c.id),
    body,
    referenceType: "CAMPAIGN",
    referenceId: campaign.id,
    // attribute to the campaign's own branch, not the operator's session branch
    branchId: campaign.branchId,
    isMarketing: true,
  });
  revalidatePath("/", "layout");
  // `skipped` kept as an alias of optedOut for the existing broadcast button
  return { ok: true, ...result, skipped: result.optedOut, audience: customers.length };
}
