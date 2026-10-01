"use server";

import { revalidatePath } from "next/cache";
import { marketingService } from "@/modules/marketing/service";
import { broadcast } from "@/modules/marketing/broadcast";
import { getSessionUser, type SessionUser } from "@/lib/session-user";
import { can } from "@/lib/auth/permissions";
import { buildAudienceWhere, rulesForCampaign, type AudienceRules } from "@/modules/marketing/audience";
import { db } from "@/lib/db";

/**
 * 营销模块的门禁。
 *
 * 这里的旧写法有两类问题：`db.organisation.findFirst()` 取组织（多租户下＝第一个组织），
 * 以及 campaign/review 直接按裸 id 更新（可跨租户改，broadcastCampaign 更会**真的花钱群发**）。
 * 现在统一走会话：组织取 session.orgId，权限用 CAMPAIGNS，跨租户的 id 一律 "Not found"。
 */
async function requireCampaignEditor(level: "view" | "edit"): Promise<SessionUser | null> {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return null;
  const allowed = await can({ id: session.user.id, role: session.role as never, organisationId: session.orgId }, "CAMPAIGNS", level);
  return allowed ? session : null;
}

/** Campaign/Review 都没有 organisationId —— 经 branch.organisationId 判定归属。 */
async function campaignInOrg(id: string, organisationId: string) {
  return db.campaign.findFirst({ where: { id, branch: { organisationId } }, select: { id: true } });
}

async function reviewInOrg(id: string, organisationId: string) {
  return db.review.findFirst({ where: { id, branch: { organisationId } }, select: { id: true } });
}

/** 门店归属（P5：这是记账不是权限）—— 新行落在本 org 的主门店。 */
async function defaultBranch(session: SessionUser) {
  return db.branch.findFirst({ where: { organisationId: session.orgId, isMain: true } });
}

async function mainBranchId(session: SessionUser) {
  const branch = await defaultBranch(session);
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
  const session = await requireCampaignEditor("view");
  if (!session) return { ok: false, error: "Not signed in or no permission" };
  const branchId = await mainBranchId(session);
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
  const session = await requireCampaignEditor("view");
  if (!session) return { ok: false, error: "Not signed in or no permission" };
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
  // 先查后改：Campaign 只有 branchId，归属经 branch.organisationId 判定（裸 id 更新可跨租户）
  if (!(await campaignInOrg(input.id, session.orgId))) return { ok: false, error: "Not found" };
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
  const session = await requireCampaignEditor("view");
  if (!session) return { ok: false, error: "Not signed in or no permission" };
  const branchId = await mainBranchId(session);
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
  const session = await requireCampaignEditor("view");
  if (!session) return { ok: false, error: "Not signed in or no permission" };
  const branchId = await mainBranchId(session);
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
  const session = await requireCampaignEditor("view");
  if (!session) return { ok: false, error: "Not signed in or no permission" };
  // Review 只有 branchId：归属经 branch.organisationId 判定，跨租户的 id 一律 "Not found"
  if (!(await reviewInOrg(reviewId, session.orgId))) return { ok: false, error: "Not found" };
  await db.review.update({ where: { id: reviewId }, data: { status: "PUBLISHED" } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function replyToReview(reviewId: string, reply: string) {
  const session = await requireCampaignEditor("view");
  if (!session) return { ok: false, error: "Not signed in or no permission" };
  if (!(await reviewInOrg(reviewId, session.orgId))) return { ok: false, error: "Not found" };
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
async function audienceCustomers(organisationId: string, campaign: { audience: string | null; audienceRules: unknown }) {
  return db.customer.findMany({
    where: { AND: [{ phone: { not: null } }, buildAudienceWhere(organisationId, rulesForCampaign(campaign))] },
    select: { id: true, name: true, phone: true },
  });
}

/**
 * MKT-013: marketing decides whether live promos auto-apply to every booking or only
 * to bookings that arrived through a campaign link. Money-affecting, so it is an
 * explicit opt-in toggle rather than a code constant.
 */
export async function setPromoAutoApply(enabled: boolean) {
  const session = await requireCampaignEditor("view");
  if (!session) return { ok: false };
  // 组织来自会话：旧版 `organisation.findFirst()` 改的是"第一个组织"的开关
  await db.organisation.update({ where: { id: session.orgId }, data: { promoAutoApply: enabled } });
  revalidatePath("/", "layout");
  return { ok: true, enabled };
}

/** MKT-005: how many customers a rule set currently matches (for the campaign editor). */
export async function previewAudienceCount(rules: AudienceRules): Promise<number> {
  const session = await requireCampaignEditor("view");
  if (!session) return 0;
  return db.customer.count({
    where: { AND: [{ phone: { not: null } }, buildAudienceWhere(session.orgId, rules)] },
  });
}

/** One-click WhatsApp broadcast to a campaign's audience. Persists messages linked to the campaign. */
export async function broadcastCampaign(input: { campaignId: string; message?: string }) {
  // 这个函数**会真的花钱群发**：旧版没有任何会话检查、也没有组织过滤，
  // 谁拿到一个 campaignId 就能替别的租户群发 WhatsApp。先证明该 campaign 属于本组织。
  // 被拒时返回与成功同形的全零结果（调用端要读 result.sent，不能返回一个缺字段的对象）。
  const denied = { total: 0, sent: 0, failed: 0, optedOut: 0, capped: 0, overflow: 0, skipped: 0, audience: 0 };
  const session = await requireCampaignEditor("view");
  if (!session) return { ok: false as const, error: "Not signed in or no permission", ...denied };
  const campaign = await db.campaign.findFirst({
    where: { id: input.campaignId, branch: { organisationId: session.orgId } },
  });
  if (!campaign) return { ok: false as const, error: "Campaign not found", ...denied };

  const customers = await audienceCustomers(session.orgId, { audience: campaign.audience, audienceRules: campaign.audienceRules });
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
