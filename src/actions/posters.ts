"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { messagingModule } from "@/modules/messaging/service";

/** Send a poster (title + link) to a list of customers via WhatsApp. */
export async function sendPosterToCustomers(posterId: string, customerIds: string[]): Promise<{ ok: boolean; sent: number; skipped: number }> {
  const poster = await db.marketingAsset.findUnique({ where: { id: posterId } });
  if (!poster) return { ok: false, sent: 0, skipped: 0 };
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3002";
  let sent = 0;
  let skipped = 0;
  for (const cid of customerIds.slice(0, 50)) {
    try {
      const body = "Check out our latest: " + poster.title + " 🏍️ — " + base + poster.url;
      // sendDirect applies the MSG-017 marketing opt-out guard internally (throws CUSTOMER_OPTED_OUT)
      await messagingModule.sendDirect({ customerId: cid, body, referenceType: "POSTER", isMarketing: true });
      sent++;
    } catch { skipped++; }
  }
  revalidatePath("/", "layout");
  return { ok: true, sent, skipped };
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
