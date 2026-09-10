"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { scopedBranchId } from "@/lib/branch-scope";
import { leadsModule } from "@/modules/leads/service";

/**
 * 分行归属：lead 属分行级运营数据。branch 级用户建的单必须落在自己分行，
 * 否则会被 leads 列表（按 session.branchId 过滤）立即过滤掉——建完即消失。
 * org 级角色回退主店。
 */
async function defaultOrgBranch() {
  const org = await db.organisation.findFirst();
  const session = await getSessionUser();
  const branchScope = scopedBranchId(session);
  const branch = branchScope
    ? await db.branch.findFirst({ where: { id: branchScope, organisationId: org!.id } })
    : await db.branch.findFirst({ where: { organisationId: org!.id, isMain: true } });
  return { org: org!, branch: branch! };
}

export async function createLead(input: {
  customerName: string;
  phone?: string;
  email?: string;
  sourceId?: string;
  stageId?: string;
  motorcycleInterest?: string;
  modelInterest?: string;
  notes?: string;
  estimatedValueSen?: number;
  assignedUserId?: string;
  nextFollowUpAt?: string;
  tags?: string;
  /** MKT-015: campaign attribution from a campaign landing link. */
  campaignId?: string;
}) {
  const { org, branch } = await defaultOrgBranch();
  const dupes = await leadsModule.findDuplicates(org.id, input.phone, input.email);
  // sourceId may be a real LeadSource id or a display name (walk-in, phone, social…) — resolve by name
  let sourceId = input.sourceId;
  if (sourceId && !sourceId.startsWith("c")) {
    const src = await db.leadSource.findFirst({ where: { organisationId: org.id, name: sourceId } });
    if (!src) {
      sourceId = (await db.leadSource.create({ data: { organisationId: org.id, name: sourceId } })).id;
    } else sourceId = src.id;
  }
  const lead = await leadsModule.create({
    organisationId: org.id,
    branchId: branch.id,
    customerName: input.customerName,
    phone: input.phone,
    email: input.email,
    sourceId,
    stageId: input.stageId,
    motorcycleInterest: input.motorcycleInterest,
    modelInterest: input.modelInterest,
    notes: input.notes,
    estimatedValueSen: input.estimatedValueSen,
    assignedUserId: input.assignedUserId,
    nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null,
    tags: input.tags,
    campaignId: input.campaignId ?? null,
  });
  revalidatePath("/", "layout");
  return { ok: true, id: lead.id, leadNumber: lead.leadNumber, duplicates: dupes.length };
}

export async function updateLead(id: string, input: {
  customerName?: string;
  phone?: string;
  email?: string;
  sourceId?: string;
  stageId?: string;
  motorcycleInterest?: string;
  modelInterest?: string;
  notes?: string;
  estimatedValueSen?: number | null;
  assignedUserId?: string;
  nextFollowUpAt?: string | null;
  tags?: string;
}) {
  const updated = await leadsModule.update(id, {
    customerName: input.customerName,
    phone: input.phone,
    email: input.email,
    sourceId: input.sourceId,
    stageId: input.stageId,
    motorcycleInterest: input.motorcycleInterest,
    modelInterest: input.modelInterest,
    notes: input.notes,
    estimatedValueSen: input.estimatedValueSen ?? null,
    assignedUserId: input.assignedUserId,
    nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null,
    tags: input.tags,
  });
  revalidatePath("/", "layout");
  return { ok: true, id: updated.id };
}

export async function addLeadNote(id: string, note: string) {
  await leadsModule.addActivity(id, "NOTE", note);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function convertLead(id: string) {
  const { org, branch: defaultBranch } = await defaultOrgBranch();
  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead) return { ok: false, error: "Lead not found" };
  // 客户归属沿用 lead 自己的分行，缺失时才回退 session/主店归属
  const branch = lead.branchId
    ? ((await db.branch.findFirst({ where: { id: lead.branchId, organisationId: org.id } })) ?? defaultBranch)
    : defaultBranch;
  // re-check duplicates on the phone/email before converting
  const dupes = await leadsModule.findDuplicates(org.id, lead.phone, lead.email, lead.id);
  let customerId: string;
  if (dupes.length > 0) {
    // attach to the most recent existing customer with the same phone/email
    const existing = await db.customer.findFirst({
      where: { organisationId: org.id, OR: [{ phone: lead.phone ?? undefined }, { email: lead.email ?? undefined }] },
      orderBy: { createdAt: "desc" },
    });
    customerId = existing!.id;
  } else {
    customerId = await leadsModule.convertToCustomer(lead.id, { branchId: branch.id });
  }
  revalidatePath("/", "layout");
  return { ok: true, customerId };
}

export async function closeLeadLost(id: string, reason: string) {
  await leadsModule.markLost(id, reason);
  revalidatePath("/", "layout");
  return { ok: true };
}