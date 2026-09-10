"use server";

import { db } from "@/lib/db";
import { leadsModule } from "@/modules/leads/service";

async function resolveSource(orgId: string, name: string) {
  const src = await db.leadSource.findFirst({ where: { organisationId: orgId, name } });
  if (src) return src.id;
  return (await db.leadSource.create({ data: { organisationId: orgId, name } })).id;
}

/** Website enquiry form (WEB-010/014/015, LEAD-001): creates a CRM lead automatically. */
export async function submitWebsiteEnquiry(input: {
  name: string; phone: string; email?: string; model?: string; notes?: string; branchId?: string;
  /** MKT-015: campaign attribution carried from a campaign landing link (?campaign=). */
  campaignId?: string;
}): Promise<{ ok: boolean; leadNumber?: string; error?: string }> {
  const org = await db.organisation.findFirst();
  if (!org) return { ok: false, error: "No organisation configured" };
  const branch = input.branchId
    ? await db.branch.findFirst({ where: { id: input.branchId, organisationId: org.id } })
    : await db.branch.findFirst({ where: { organisationId: org.id, isMain: true } });
  const sourceId = await resolveSource(org.id, "Website");
  const lead = await leadsModule.create({
    organisationId: org.id,
    branchId: branch?.id ?? null,
    customerName: input.name,
    phone: input.phone,
    email: input.email || null,
    sourceId,
    motorcycleInterest: input.model || null,
    notes: input.notes || null,
    campaignId: input.campaignId ?? null,
  });
  return { ok: true, leadNumber: lead.leadNumber };
}

/** Public test ride request (WEB-012, TEST-002): lead + pending test ride. */
export async function submitTestRideRequest(input: {
  name: string; phone: string; email?: string; model: string; branchId?: string; rideDate?: string; timeSlot?: string; notes?: string;
}): Promise<{ ok: boolean; leadNumber?: string; error?: string }> {
  const org = await db.organisation.findFirst();
  if (!org) return { ok: false, error: "No organisation configured" };
  const branch = input.branchId
    ? await db.branch.findFirst({ where: { id: input.branchId, organisationId: org.id } })
    : await db.branch.findFirst({ where: { organisationId: org.id, isMain: true } });
  const sourceId = await resolveSource(org.id, "Website");
  const lead = await leadsModule.create({
    organisationId: org.id,
    branchId: branch?.id ?? null,
    customerName: input.name,
    phone: input.phone,
    email: input.email || null,
    sourceId,
    motorcycleInterest: input.model,
    notes: (input.notes ? input.notes + " " : "") + "Test ride request",
  });
  const fallbackBranch = await db.branch.findFirst({ where: { organisationId: org.id } });
  await db.testRide.create({
    data: {
      organisationId: org.id,
      branchId: branch?.id ?? fallbackBranch!.id,
      motorcycleModel: input.model,
      rideDate: input.rideDate ? new Date(input.rideDate + "T00:00:00") : new Date(),
      timeSlot: input.timeSlot || null,
      status: "PENDING",
      leadId: lead.id,
    },
  });
  await db.leadActivity.create({ data: { leadId: lead.id, type: "TEST_RIDE", note: "Test ride requested via website", userId: null } });
  return { ok: true, leadNumber: lead.leadNumber };
}
