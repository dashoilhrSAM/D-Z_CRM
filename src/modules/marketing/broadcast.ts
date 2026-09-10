// MKT: one broadcast pipeline for every marketing send.
//
// Campaign broadcasts and poster sends used to each implement their own audience
// query, send loop and counting, and they disagreed: one honoured the opt-out guard
// and counted real outcomes, the other did neither. Everything now goes through here.
import { db } from "@/lib/db";
import { messagingModule } from "@/modules/messaging/service";

/** Reference types that count as marketing when applying the frequency cap. */
export const MARKETING_REFERENCE_TYPES = ["CAMPAIGN", "POSTER"] as const;

/** Default: never send the same customer two marketing messages within a week. */
export const DEFAULT_FREQUENCY_CAP_DAYS = 7;

export interface BroadcastResult {
  /** Recipients the run intended to reach, after de-duplication and the run-size cap. */
  total: number;
  /** Delivered — the provider reported success. */
  sent: number;
  /** Provider reported failure, or threw. */
  failed: number;
  /** Skipped because the customer opted out of marketing (MSG-017). */
  optedOut: number;
  /** Skipped by the frequency cap — contacted too recently. */
  capped: number;
  /** Left over because the run hit its recipient limit. */
  overflow: number;
}

/** Pure: de-duplicate and cap how many recipients one run may touch. */
export function limitRecipients(customerIds: string[], max: number): { recipients: string[]; overflow: number } {
  const unique = [...new Set(customerIds.filter(Boolean))];
  if (max <= 0 || unique.length <= max) return { recipients: unique, overflow: 0 };
  return { recipients: unique.slice(0, max), overflow: unique.length - max };
}

/** Pure: drop customers we messaged too recently. */
export function applyFrequencyCap(customerIds: string[], recentlyMessaged: Set<string>): { eligible: string[]; capped: number } {
  const eligible = customerIds.filter((id) => !recentlyMessaged.has(id));
  return { eligible, capped: customerIds.length - eligible.length };
}

/** Which of these customers received a marketing message within the cap window. */
async function recentlyMessagedIds(customerIds: string[], capDays: number, now: Date): Promise<Set<string>> {
  if (customerIds.length === 0 || capDays <= 0) return new Set();
  const since = new Date(now.getTime() - capDays * 86_400_000);
  const rows = await db.message.findMany({
    where: {
      customerId: { in: customerIds },
      direction: "OUT",
      createdAt: { gte: since },
      referenceType: { in: [...MARKETING_REFERENCE_TYPES] },
    },
    select: { customerId: true },
  });
  return new Set(rows.map((r) => r.customerId));
}

/**
 * Send one message body to a set of customers.
 *
 * Guarantees, in one place:
 * - delivered through messagingModule, so MSG-017 opt-out, real delivery status and
 *   MSG-020 failure records all apply;
 * - counts reflect real outcomes — a failed send is never counted as sent;
 * - a frequency cap so a customer is not hit by every campaign in the same week.
 */
export async function broadcast(opts: {
  customerIds: string[];
  body: string;
  referenceType: string;
  referenceId?: string | null;
  branchId?: string | null;
  /** Marketing sends respect opt-out and the frequency cap. */
  isMarketing?: boolean;
  channel?: "WHATSAPP" | "SMS" | "EMAIL" | "APP";
  maxRecipients?: number;
  /** null disables the cap for this run. */
  frequencyCapDays?: number | null;
  now?: Date;
}): Promise<BroadcastResult> {
  const now = opts.now ?? new Date();
  const isMarketing = opts.isMarketing ?? false;
  const maxRecipients = opts.maxRecipients ?? 50;
  const capDays = opts.frequencyCapDays === undefined ? DEFAULT_FREQUENCY_CAP_DAYS : opts.frequencyCapDays;

  const { recipients: limited, overflow } = limitRecipients(opts.customerIds, maxRecipients);

  let recipients = limited;
  let capped = 0;
  if (isMarketing && capDays !== null && capDays > 0) {
    const recent = await recentlyMessagedIds(limited, capDays, now);
    const filtered = applyFrequencyCap(limited, recent);
    recipients = filtered.eligible;
    capped = filtered.capped;
  }

  let sent = 0, failed = 0, optedOut = 0;
  for (const customerId of recipients) {
    try {
      const { sent: ok } = await messagingModule.sendDirect({
        customerId,
        body: opts.body,
        channel: opts.channel ?? "WHATSAPP",
        isMarketing,
        referenceType: opts.referenceType,
        referenceId: opts.referenceId ?? undefined,
        branchId: opts.branchId ?? null,
      });
      if (ok) sent++; else failed++;
    } catch (e) {
      if (e instanceof Error && e.message === "CUSTOMER_OPTED_OUT") { optedOut++; continue; }
      failed++;
    }
  }

  return { total: recipients.length, sent, failed, optedOut, capped, overflow };
}
