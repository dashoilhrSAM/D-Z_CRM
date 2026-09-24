"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { messagingModule } from "@/modules/messaging/service";
import { hasActiveServiceDueRule } from "@/modules/automation/scan";

/** Send a service reminder via the Service Reminder template (REM-008..020). */
export async function sendReminder(reminderId: string) {
  const reminder = await db.serviceReminder.findUnique({
    where: { id: reminderId },
    include: { customer: true, motorcycle: true, job: true },
  });
  if (!reminder) return { ok: false, error: "Reminder not found" };
  const template = await db.messageTemplate.findFirst({ where: { name: { contains: "Service Reminder" } } });
  if (!template) return { ok: false, error: "Service Reminder template not found — create one in Message Templates" };
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3002";
  const sent = await messagingModule.sendFromTemplate({
    customerId: reminder.customerId,
    templateId: template.id,
    vars: {
      bike: reminder.motorcycle.brand + " " + reminder.motorcycle.model + " (" + reminder.motorcycle.plate + ")",
      date: reminder.estimatedDate ? reminder.estimatedDate.toISOString().slice(0, 10) : "soon",
      next: reminder.nextServiceMileage.toLocaleString(),
      link: base + "/rider/book", // real booking link (REM-015)
    },
    referenceType: "SERVICE_REMINDER",
  });
  // mark as DUE (reminded) — keep in the list but no longer silent
  await db.serviceReminder.update({
    where: { id: reminderId },
    data: { status: reminder.status === "UPCOMING" ? "DUE_SOON" : reminder.status },
  });
  revalidatePath("/", "layout");
  return { ok: true, sent: sent.sent };
}

/** Batch-send all due / overdue service reminders (manual trigger of the scheduled job). */
export async function sendDueReminders(): Promise<{ ok: boolean; sent: number; failed: number }> {
  // **规则优先**：如果老板建了启用中的 SERVICE_DUE 自动化规则，
  // 就不要再走这条内置提醒 —— 否则同一个客户会收到两条（规则一条 + 内置一条）✗。
  const org = await db.organisation.findFirst();
  if (org && (await hasActiveServiceDueRule(org.id))) {
    return { ok: true, sent: 0, failed: 0 };
  }
  const due = await db.serviceReminder.findMany({
    where: { closedAt: null, OR: [{ status: "DUE" }, { status: "OVERDUE" }, { estimatedDate: { lte: new Date() } }] },
    take: 50,
  });
  let sent = 0;
  let failed = 0;
  for (const r of due) {
    try {
      const res = await sendReminder(r.id);
      if (res.ok && res.sent) sent++;
      else failed++;
    } catch {
      failed++;
    }
  }
  revalidatePath("/", "layout");
  return { ok: true, sent, failed };
}
