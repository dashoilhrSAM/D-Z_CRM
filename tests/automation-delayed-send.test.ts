import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";

describe("延迟发送（自动化动作 delayDays）", () => {
  it("sendAtFor：N 天后；0 就是现在；负数按 0 处理", async () => {
    const { sendAtFor } = await import("@/modules/automation/scan");
    const now = new Date("2026-09-24T10:00:00Z");
    expect(sendAtFor(now, 3).toISOString()).toBe("2026-09-27T10:00:00.000Z");
    expect(sendAtFor(now, 0).toISOString()).toBe(now.toISOString());
    expect(sendAtFor(now, -5).toISOString(), "负数不能跑到过去").toBe(now.toISOString());
  });

  it("isScheduledDue：到点才算", async () => {
    const { isScheduledDue } = await import("@/modules/automation/scan");
    const now = new Date("2026-09-24T10:00:00Z");
    expect(isScheduledDue(new Date("2026-09-24T09:59:00Z"), now)).toBe(true);
    expect(isScheduledDue(now, now), "正好到点也算").toBe(true);
    expect(isScheduledDue(new Date("2026-09-24T10:01:00Z"), now)).toBe(false);
  });

  it("**带 delayDays 的动作只排队，不立刻发**（这是这个功能的核心）", async () => {
    const { automationModule } = await import("@/modules/automation/service");
    const org = await db.organisation.create({ data: { name: "SCHED-" + Date.now() } });
    const customer = await db.customer.create({ data: { organisationId: org.id, name: "Sched Customer", phone: "+60123456789" } });
    const template = await db.messageTemplate.create({
      data: { organisationId: org.id, name: "Sched Tpl " + Date.now(), channel: "WHATSAPP", body: "Hi {name}" },
    });
    try {
      await automationModule.executeAction(
        { type: "SEND_MESSAGE", templateId: template.id, delayDays: 3 } as never,
        { customerId: customer.id, dedupeKey: "x", ruleId: "rule-1" },
      );
      const queued = await db.scheduledMessage.findMany({ where: { customerId: customer.id } });
      expect(queued.length, "应当排进队列").toBe(1);
      expect(queued[0].status).toBe("PENDING");
      expect(queued[0].sourceRuleId).toBe("rule-1");
      expect(queued[0].templateId).toBe(template.id);
      const days = (queued[0].sendAt.getTime() - Date.now()) / 86400000;
      expect(days).toBeGreaterThan(2.9);
      expect(days).toBeLessThan(3.1);
      // 没到点就发不出去
      const { sendDueScheduledMessages } = await import("@/modules/automation/scan");
      const out = await sendDueScheduledMessages();
      const after = await db.scheduledMessage.findUnique({ where: { id: queued[0].id } });
      expect(after!.status, "还没到点，不能被发掉").toBe("PENDING");
      expect(out.sent).toBe(0);
    } finally {
      await db.scheduledMessage.deleteMany({ where: { customerId: customer.id } });
      await db.messageTemplate.delete({ where: { id: template.id } });
      await db.customer.delete({ where: { id: customer.id } });
      await db.organisation.delete({ where: { id: org.id } });
    }
  });
});
