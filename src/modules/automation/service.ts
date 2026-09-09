// Automation engine — event-triggered rules with logged executions (AUTO-001..024).
import { db } from "@/lib/db";
import { messagingModule, type TemplateVars } from "@/modules/messaging/service";

/** Extract scalar (string/number/boolean) values from a context so template tokens resolve safely. */
function scalarVars(ctx: Record<string, unknown>): TemplateVars {
  const out: TemplateVars = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (typeof v === "string" || typeof v === "number") out[k] = v;
    else if (typeof v === "boolean") out[k] = String(v);
    else if (v === null) out[k] = null;
  }
  return out;
}

export interface AutomationAction {
  type: "CREATE_TASK" | "ASSIGN_LEAD" | "SEND_MESSAGE" | "SCHEDULE_REMINDER" | "UPDATE_TAGS";
  [k: string]: unknown;
}

const SUPPORTED_TRIGGERS = [
  "LEAD_CREATED", "LEAD_STAGE_CHANGED", "BOOKING_CREATED", "BOOKING_APPROACHING", "SERVICE_COMPLETED",
  "SERVICE_DUE", "JOB_READY", "CUSTOMER_INACTIVE", "LOYALTY_EVENT", "LOW_STOCK",
] as const;
export type AutoTrigger = (typeof SUPPORTED_TRIGGERS)[number];

export const automationModule = {
  /** Run all active rules matching the trigger; log every execution (AUTO-021/022). */
  async run(organisationId: string, trigger: AutoTrigger, context: Record<string, unknown> = {}) {
    const rules = await db.automationRule.findMany({ where: { organisationId, active: true, trigger } });
    for (const rule of rules) {
      const dedupeKey = trigger + ":" + String(context.dedupeKey ?? context.entityId ?? context.leadId ?? context.jobId ?? "x");
      const existing = await db.automationExecution.findFirst({
        where: { ruleId: rule.id, trigger, error: dedupeKey },
        select: { id: true },
      }).catch(() => null);
      if (existing) continue; // AUTO-024: prevent duplicate / circular execution
      try {
        const actions = JSON.parse(rule.actions) as AutomationAction[];
        for (const a of actions) await this.executeAction(a, context);
        await db.automationExecution.create({ data: { ruleId: rule.id, trigger, status: "SUCCESS", error: dedupeKey } });
      } catch (e) {
        await db.automationExecution.create({ data: { ruleId: rule.id, trigger, status: "FAILED", error: String((e as Error).message).slice(0, 500) } });
      }
    }
  },

  async executeAction(a: AutomationAction, ctx: Record<string, unknown>) {
    const org = await db.organisation.findFirst();
    if (!org) return;
    switch (a.type) {
      case "CREATE_TASK": {
        await db.task.create({
          data: {
            organisationId: org.id,
            title: String(a.title ?? "Follow up"),
            description: String(a.description ?? "") + (ctx.leadId ? " (lead " + ctx.leadId + ")" : ""),
            ownerId: ctx.assignedUserId ? String(ctx.assignedUserId) : null,
            relatedType: ctx.relatedType ? String(ctx.relatedType) : null,
            relatedId: ctx.relatedId ? String(ctx.relatedId) : null,
            dueAt: a.dueInDays ? new Date(Date.now() + Number(a.dueInDays) * 86400000) : null,
            priority: String(a.priority ?? "NORMAL"),
          },
        });
        break;
      }
      case "ASSIGN_LEAD": {
        if (ctx.leadId) {
          await db.lead.update({ where: { id: String(ctx.leadId) }, data: { assignedUserId: ctx.assignedUserId ? String(ctx.assignedUserId) : null } });
        }
        break;
      }
      case "SEND_MESSAGE": {
        // AUTO: deliver via the real MessagingProvider (mock in dev / Meta in prod),
        // honoring marketing opt-out and persisting the real status + externalId.
        const customerId = ctx.customerId ? String(ctx.customerId) : null;
        const templateId = a.templateId ? String(a.templateId) : null;
        if (customerId && templateId) {
          const vars: TemplateVars = {
            ...scalarVars(ctx),
            ...((a.vars as TemplateVars | undefined) ?? {}),
          };
          const out = await messagingModule.sendFromTemplate({
            customerId,
            templateId,
            vars,
            isMarketing: Boolean(a.isMarketing),
            jobId: ctx.jobId ? String(ctx.jobId) : undefined,
            branchId: ctx.branchId ? String(ctx.branchId) : undefined,
            referenceType: "AUTOMATION",
          });
          if (!out.sent) {
            // provider delivery failed — record the execution as FAILED for visibility
            throw new Error("Automation message delivery failed");
          }
        }
        break;
      }
      case "SCHEDULE_REMINDER": {
        if (ctx.customerId && ctx.motorcycleId) {
          await db.serviceReminder.create({
            data: {
              customerId: String(ctx.customerId), motorcycleId: String(ctx.motorcycleId),
              lastServiceMileage: Number(ctx.mileage ?? 0), nextServiceMileage: Number(ctx.nextMileage ?? 3000),
              status: "UPCOMING",
            },
          });
        }
        break;
      }
      case "UPDATE_TAGS": {
        if (ctx.leadId && a.tags) {
          const lead = await db.lead.findUnique({ where: { id: String(ctx.leadId) } });
          if (lead) {
            const newTags = (a.tags as string[]).join(",");
            await db.lead.update({ where: { id: lead.id }, data: { tags: lead.tags ? lead.tags + "," + newTags : newTags } });
          }
        }
        break;
      }
    }
  },
};
