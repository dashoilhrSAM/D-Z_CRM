"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { messagingModule } from "@/modules/messaging/service";
import {
  SCAN_ORG_BATCH,
  SCAN_TIME_BUDGET_MS,
  hasActiveServiceDueRule,
  rotateForDay,
  utcDayIndex,
} from "@/modules/automation/scan";

/** Send a service reminder via the Service Reminder template (REM-008..020). */
export async function sendReminder(reminderId: string) {
  const reminder = await db.serviceReminder.findUnique({
    where: { id: reminderId },
    include: { customer: true, motorcycle: true, job: true },
  });
  if (!reminder) return { ok: false, error: "Reminder not found" };
  // 模板也必须按**这家客户所属门店**取：多租户下 findFirst 会随机命中别家门店的模板
  // （每个门店各自维护自己的模板文案与语言）。
  const template = await db.messageTemplate.findFirst({
    where: { organisationId: reminder.customer.organisationId, name: { contains: "Service Reminder" } },
  });
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

/** 每家门店每轮最多发多少条内置提醒（配额属于门店，不再全平台共享）。 */
const PER_ORG_REMINDER_BATCH = 50;

export interface DueRemindersResult {
  ok: boolean;
  sent: number;
  failed: number;
  orgsTotal: number;
  orgsScanned: number;
  orgsRemaining: number;
  /** true = 本次没发完，剩下的按日轮转排在下次的队首 */
  truncated: boolean;
}

/**
 * Batch-send all due / overdue service reminders (manual trigger of the scheduled job).
 *
 * 2026-09-29 多租户修正（P0）：原实现只看**第一家门店**的规则、且用全平台共享的
 * take: 50 —— 500 家门店时每天只发 50 条，后面的门店永远轮不到，而且
 * 「有没有 SERVICE_DUE 规则」只按第一家门店判断。现在逐家门店处理：
 * 每家有自己的规则判断与配额，按天轮转起点，跑不完如实报出来。
 */
export async function sendDueReminders(
  now: Date = new Date(),
  budgetMs: number = SCAN_TIME_BUDGET_MS,
): Promise<DueRemindersResult> {
  const startedAt = Date.now();
  const orgs = await db.organisation.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  const ordered = rotateForDay(orgs, utcDayIndex(now));
  let sent = 0;
  let failed = 0;
  let scanned = 0;
  let truncated = false;

  for (const org of ordered) {
    if (scanned >= SCAN_ORG_BATCH || (scanned > 0 && Date.now() - startedAt > budgetMs)) {
      truncated = true;
      break;
    }
    scanned++;
    // **规则优先**：如果这家门店建了启用中的 SERVICE_DUE 自动化规则，
    // 就不要再走这条内置提醒 —— 否则同一个客户会收到两条（规则一条 + 内置一条）✗。
    if (await hasActiveServiceDueRule(org.id)) continue;

    const due = await db.serviceReminder.findMany({
      where: {
        closedAt: null,
        // ServiceReminder 没有 organisationId 列，按客户所属门店收窄
        customer: { organisationId: org.id },
        OR: [{ status: "DUE" }, { status: "OVERDUE" }, { estimatedDate: { lte: now } }],
      },
      take: PER_ORG_REMINDER_BATCH,
    });
    for (const r of due) {
      try {
        const res = await sendReminder(r.id);
        if (res.ok && res.sent) sent++;
        else failed++;
      } catch {
        failed++;
      }
    }
  }

  revalidatePath("/", "layout");
  return {
    ok: true,
    sent,
    failed,
    orgsTotal: orgs.length,
    orgsScanned: scanned,
    orgsRemaining: orgs.length - scanned,
    truncated,
  };
}
