"use server";

import { revalidatePath } from "next/cache";
import { marketingService } from "@/modules/marketing/service";
import { messagingModule } from "@/modules/messaging/service";
import { getSessionUser } from "@/lib/session-user";
import { scopedBranchId } from "@/lib/branch-scope";
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
  status: "DRAFT" | "SCHEDULED" | "ACTIVE" | "ENDED";
  startDate: string;
  endDate?: string;
  discountPercent?: number;
}) {
  const branchId = await mainBranchId();
  await marketingService.createCampaign({
    branchId,
    name: input.name,
    type: input.type,
    audience: input.audience,
    status: input.status,
    startDate: new Date(input.startDate),
    endDate: input.endDate ? new Date(input.endDate) : null,
    discountPercent: input.discountPercent ?? null,
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
  audience?: string;
}) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.status !== undefined) data.status = input.status;
  if (input.startDate !== undefined) data.startDate = new Date(input.startDate);
  if (input.endDate !== undefined) data.endDate = input.endDate ? new Date(input.endDate) : null;
  if (input.discountPercent !== undefined) data.discountPercent = input.discountPercent;
  if (input.audience !== undefined) data.audience = input.audience;
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

/** Resolve the customers a campaign audience maps to. */
async function audienceCustomers(audience: string | null): Promise<{ id: string; name: string; phone: string | null }[]> {
  const all = await db.customer.findMany({ where: { phone: { not: null } }, select: { id: true, name: true, phone: true, joinedAt: true } });
  if (!audience || audience === "ALL") return all;
  if (audience === "NEW") {
    return all.filter((c) => new Date(c.joinedAt) > new Date(Date.now() - 30 * 86400000));
  }
  // reminder-based audiences: OVERDUE / 30_DAYS / 60_DAYS
  const statuses = audience === "OVERDUE" ? ["DUE", "OVERDUE"] : ["UPCOMING", "DUE_SOON", "DUE", "OVERDUE"];
  const reminded = await db.serviceReminder.findMany({ where: { status: { in: statuses as never } }, select: { customerId: true } });
  const ids = new Set(reminded.map((r) => r.customerId));
  return all.filter((c) => ids.has(c.id));
}

/** One-click WhatsApp broadcast to a campaign's audience. Persists messages linked to the campaign. */
export async function broadcastCampaign(input: { campaignId: string; message?: string }) {
  const campaign = await db.campaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign) throw new Error("Campaign not found");
  const branch = await defaultBranch();

  const customers = await audienceCustomers(campaign.audience);
  const body = input.message?.trim() || "Hi, " + campaign.name + " is on now at D&Z Smart Workshop" + (campaign.discountPercent ? " — save " + campaign.discountPercent + "%!" : " — book your service today!");
  // 群发是营销消息：必须走 messagingModule，以便遵守 MSG-017 opt-out、真实送达状态与
  // MSG-020 失败记录；计数按真实结果，不能把失败也算成已发。
  let sent = 0, failed = 0, skipped = 0;
  for (const c of customers) {
    try {
      const { sent: ok } = await messagingModule.sendDirect({
        customerId: c.id,
        body,
        channel: "WHATSAPP",
        isMarketing: true,
        referenceType: "CAMPAIGN",
        referenceId: campaign.id,
        branchId: branch?.id ?? null,
      });
      if (ok) sent++; else failed++;
    } catch (e) {
      if (e instanceof Error && e.message === "CUSTOMER_OPTED_OUT") { skipped++; continue; }
      failed++;
    }
  }
  revalidatePath("/", "layout");
  return { ok: true, sent, failed, skipped, audience: customers.length };
}
