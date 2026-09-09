// Messaging module — template rendering, opt-out guard, real send via MessagingProvider.
// Every OUT message is actually delivered through the provider (mock in dev / Meta in prod)
// and persisted with the real delivery status + externalId (MSG-012..020).
import { db } from "@/lib/db";
import { messagingProvider } from "@/providers";

export type TemplateVars = Record<string, string | number | null | undefined>;
export type MessageChannel = "WHATSAPP" | "SMS" | "EMAIL" | "APP";

/** Replace {placeholder} tokens (MSG-005..011). */
export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{(\w+)\}/g, (m, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? m : String(v);
  });
}

/** The subset of a Customer record the delivery helper needs (keeps types stable). */
interface Customerish {
  id: string;
  phone: string | null;
  name: string;
  organisationId: string;
  branchId: string | null;
}

interface DeliverMeta {
  jobId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  branchId?: string | null;
}

/**
 * Send a message body to a customer via the configured MessagingProvider and persist
 * the real outcome (status + externalId). Provider failures are stored as FAILED
 * (MSG-020) rather than thrown, so the caller can record the attempt and continue.
 */
async function deliver(
  customer: Customerish,
  body: string,
  channel: MessageChannel,
  meta: DeliverMeta,
): Promise<{ message: unknown; sent: boolean }> {
  let result;
  try {
    result = await messagingProvider.send(customer.phone ?? customer.name, body);
  } catch (e) {
    // MSG-020: API failures logged as FAILED message
    result = { ok: false, externalId: null, status: "FAILED" as const };
  }
  const message = await db.message.create({
    data: {
      organisationId: customer.organisationId,
      branchId: meta.branchId ?? customer.branchId,
      customerId: customer.id,
      jobId: meta.jobId ?? null,
      direction: "OUT",
      channel,
      body,
      status: result.status,
      externalId: result.externalId ?? null,
      referenceType: meta.referenceType ?? null,
      referenceId: meta.referenceId ?? null,
    },
  });
  return { message, sent: result.ok };
}

export const messagingModule = {
  /** Marketing opt-out guard (MSG-017): marketing sends blocked for opted-out customers. */
  async canSendMarketing(customerId: string): Promise<boolean> {
    const consent = await db.customerConsent.findUnique({ where: { customerId } });
    if (!consent) return true; // no consent record → allow (transactional default)
    return consent.marketingOptIn;
  },

  /** Render a template and send to a customer, persisting to Message history (MSG-012..016). */
  async sendFromTemplate(input: {
    customerId: string; templateId: string; vars: TemplateVars;
    channel?: MessageChannel; isMarketing?: boolean; jobId?: string; referenceType?: string; branchId?: string | null;
  }) {
    const [customer, template] = await Promise.all([
      db.customer.findUnique({ where: { id: input.customerId } }),
      db.messageTemplate.findUnique({ where: { id: input.templateId } }),
    ]);
    if (!customer || !template) throw new Error("Customer or template not found");
    if (input.isMarketing && !(await this.canSendMarketing(customer.id))) {
      throw new Error("CUSTOMER_OPTED_OUT");
    }
    const body = renderTemplate(template.body, { name: customer.name, ...input.vars });
    const channel = (input.channel ?? (template.channel as MessageChannel) ?? "WHATSAPP") as MessageChannel;
    const { message, sent } = await deliver(customer, body, channel, {
      jobId: input.jobId,
      referenceType: input.referenceType ?? template.name,
      branchId: input.branchId,
    });
    return { message, sent, body };
  },

  /** Send a raw body to a customer (no template), persisting the real delivery outcome. */
  async sendDirect(input: {
    customerId: string; body: string; channel?: MessageChannel;
    jobId?: string; referenceType?: string; referenceId?: string; isMarketing?: boolean; branchId?: string | null;
  }) {
    const customer = await db.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw new Error("Customer not found");
    if (input.isMarketing && !(await this.canSendMarketing(customer.id))) {
      throw new Error("CUSTOMER_OPTED_OUT");
    }
    const channel = (input.channel ?? "WHATSAPP") as MessageChannel;
    const { message, sent } = await deliver(customer, input.body, channel, {
      jobId: input.jobId,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      branchId: input.branchId,
    });
    return { message, sent, body: input.body };
  },
};
