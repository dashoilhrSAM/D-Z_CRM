"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { broadcast } from "@/modules/marketing/broadcast";

/**
 * Send a poster (title + link) to a list of customers via WhatsApp.
 *
 * Uses the shared broadcast pipeline. The previous inline loop counted *every* thrown
 * error as "skipped" — provider failures were indistinguishable from opt-outs and
 * vanished from the failure count.
 */
export async function sendPosterToCustomers(posterId: string, customerIds: string[]): Promise<{ ok: boolean; sent: number; failed: number; skipped: number }> {
  const poster = await db.marketingAsset.findUnique({ where: { id: posterId } });
  if (!poster) return { ok: false, sent: 0, failed: 0, skipped: 0 };
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3002";
  const body = "Check out our latest: " + poster.title + " 🏍️ — " + base + poster.url;
  const result = await broadcast({
    customerIds,
    body,
    referenceType: "POSTER",
    referenceId: poster.id,
    branchId: poster.branchId,
    isMarketing: true,
  });
  revalidatePath("/", "layout");
  return { ok: true, ...result, skipped: result.optedOut + result.capped };
}

/** Publish / unpublish a poster to the Rider News feed (workshop-side control). */
export async function togglePosterPublished(id: string, published: boolean): Promise<{ ok: boolean }> {
  await db.marketingAsset.update({ where: { id }, data: { published } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Customers available for targeting (tag / branch filters). */
export async function listPosterTargets(filter?: { tag?: string; branchId?: string }) {
  const org = await db.organisation.findFirst();
  return db.customer.findMany({
    where: {
      organisationId: org!.id,
      ...(filter?.tag ? { tags: { contains: filter.tag } } : {}),
      ...(filter?.branchId ? { branchId: filter.branchId } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, phone: true, tags: true, branchId: true },
    take: 100,
  });
}
