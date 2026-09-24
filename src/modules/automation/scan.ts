/**
 * 时间类触发器的每日扫描。
 *
 * 背景（老板问「消息自动化还差什么」时查出来的）：界面上可以选 10 个触发器，
 * 但代码里只有 4 个有事件点 —— SERVICE_DUE / BOOKING_APPROACHING / CUSTOMER_INACTIVE
 * 建了规则也**永远不会触发** ✗，因为它们不是「某件事发生」型，而是「每天都该看一眼」型。
 * 这个模块就是那个「每天看一眼」，由 /api/cron/automation-scan 调用。
 *
 * 三条设计原则：
 *   1. **判定用现成的定义**：服务到期复用 serviceReminder 的判定（sendDueReminders 用的同一套），
 *      不另写一份（同一规则两份实现是本项目的高发坑）。
 *   2. **去重键决定「发几次」**：引擎按 dedupeKey 只跑一次（AUTO-024），所以
 *      - 服务到期：按 reminder id 去重 → 一条提醒**只发一次**（不会天天骚扰）✓
 *      - 预约临近：按 booking id 去重 → 一个预约只提醒一次 ✓
 *      - 客户流失：按 客户+月份 去重 → 一个月最多一次 ✓
 *   3. 纯函数（日期比较）单独抽出来，可以测 —— 日期比较写错是最难发现的那类 bug。
 */

import { db } from "@/lib/db";
import { automationModule } from "./service";
import { messagingModule, type TemplateVars } from "@/modules/messaging/service";

/** 延迟发送的时间点：N 天后（UTC）——纯函数，可测 */
export function sendAtFor(now: Date, delayDays: number): Date {
  const days = Math.max(0, Math.floor(delayDays));
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** 该发了吗（纯函数） */
export function isScheduledDue(sendAt: Date, now: Date): boolean {
  return sendAt.getTime() <= now.getTime();
}

/**
 * 把到期的延迟消息发出去。
 *
 * 与自动化规则里的 SEND_MESSAGE 走**同一个发送入口**（messagingModule.sendFromTemplate ✓），
 * 所以 opt-out、真实 status/externalId、失败记录都自动一致 —— 不另开一条发送路径。
 */
export async function sendDueScheduledMessages(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
  const due = await db.scheduledMessage.findMany({
    where: { status: "PENDING", sendAt: { lte: now } },
    take: 50,
    orderBy: { sendAt: "asc" },
  });
  let sent = 0;
  let failed = 0;
  for (const m of due) {
    try {
      const out = await messagingModule.sendFromTemplate({
        customerId: m.customerId,
        templateId: m.templateId,
        vars: (m.vars ?? {}) as TemplateVars,
        isMarketing: m.isMarketing,
        jobId: m.jobId ?? undefined,
        branchId: m.branchId ?? undefined,
        referenceType: "SCHEDULED",
      });
      if (!out.sent) throw new Error("provider did not send");
      await db.scheduledMessage.update({
        where: { id: m.id },
        data: { status: "SENT", sentAt: new Date(), attempts: m.attempts + 1, lastError: null },
      });
      sent++;
    } catch (e) {
      await db.scheduledMessage.update({
        where: { id: m.id },
        data: { status: "FAILED", attempts: m.attempts + 1, lastError: String((e as Error).message).slice(0, 300) },
      });
      failed++;
    }
  }
  return { sent, failed };
}

/** 多久没来算「流失」 */
export const INACTIVE_DAYS = 90;

/** UTC 天（项目约定：业务日期一律按天比较，见 docs） */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 预约日期是不是「明天」（按天比较，不看时刻） */
export function isBookingApproaching(bookingDate: Date, now: Date): boolean {
  const t = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return dayKey(bookingDate) === dayKey(t);
}

/** 是否超过 N 天没来（lastActivity 为 null = 从来没来过，也算流失） */
export function isInactive(lastActivity: Date | null, now: Date, days: number = INACTIVE_DAYS): boolean {
  if (!lastActivity) return true;
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return lastActivity.getTime() < cutoff;
}

/**
 * 有**启用中的** SERVICE_DUE 规则时，内置的服务提醒就别再发了 ——
 * 否则客户会收到两条（规则一条 + 内置一条）✗。规则优先。
 */
export async function hasActiveServiceDueRule(organisationId: string): Promise<boolean> {
  const n = await db.automationRule.count({
    where: { organisationId, trigger: "SERVICE_DUE", active: true },
  });
  return n > 0;
}

export interface ScanResult {
  serviceDue: number;
  approaching: number;
  inactive: number;
  /** 因为没有 SERVICE_DUE 规则而交给内置提醒的数量（0 就是规则接管了） */
  builtInRemindersInstead: number;
}

/** 每天跑一次：把三类「时间到了」喂给自动化引擎 */
export async function runTimeBasedAutomations(now: Date = new Date()): Promise<ScanResult> {
  const org = await db.organisation.findFirst();
  const out: ScanResult = { serviceDue: 0, approaching: 0, inactive: 0, builtInRemindersInstead: 0 };
  if (!org) return out;

  const ruleCount = await db.automationRule.groupBy({
    by: ["trigger"],
    where: { organisationId: org.id, active: true, trigger: { in: ["SERVICE_DUE", "BOOKING_APPROACHING", "CUSTOMER_INACTIVE"] } },
    _count: true,
  });
  const has = (t: string) => ruleCount.some((r) => r.trigger === t && r._count > 0);

  // ① 服务到期：复用 serviceReminder 的判定（与 sendDueReminders 完全一致）
  const due = await db.serviceReminder.findMany({
    where: { closedAt: null, OR: [{ status: "DUE" }, { status: "OVERDUE" }, { estimatedDate: { lte: now } }] },
    select: { id: true, customerId: true, motorcycleId: true },
    take: 200,
  });
  if (has("SERVICE_DUE")) {
    for (const r of due) {
      await automationModule.run(org.id, "SERVICE_DUE", {
        customerId: r.customerId,
        motorcycleId: r.motorcycleId ?? undefined,
        dedupeKey: r.id, // 一条提醒只发一次
        relatedType: "SERVICE_REMINDER",
        relatedId: r.id,
      });
      out.serviceDue++;
    }
  } else {
    out.builtInRemindersInstead = due.length;
  }

  // ② 明天要来：按 booking id 去重（一个预约只提醒一次）
  if (has("BOOKING_APPROACHING")) {
    const soon = await db.booking.findMany({
      where: { status: { notIn: ["CANCELLED", "COMPLETED", "NO_SHOW"] } },
      select: { id: true, date: true, customerId: true, motorcycleId: true, branchId: true },
      take: 500,
    });
    for (const b of soon.filter((b) => isBookingApproaching(b.date, now))) {
      await automationModule.run(org.id, "BOOKING_APPROACHING", {
        customerId: b.customerId,
        motorcycleId: b.motorcycleId ?? undefined,
        bookingId: b.id,
        branchId: b.branchId ?? undefined,
        dedupeKey: b.id,
        relatedType: "BOOKING",
        relatedId: b.id,
      });
      out.approaching++;
    }
  }

  // ③ 流失客户：按「客户 + 月份」去重，一个月最多提醒一次
  if (has("CUSTOMER_INACTIVE")) {
    const monthKey = dayKey(now).slice(0, 7);
    const customers = await db.customer.findMany({
      select: { id: true, name: true, phone: true, branchId: true, bookings: { select: { date: true }, orderBy: { date: "desc" }, take: 1 } },
      take: 2000,
    });
    for (const c of customers) {
      const last = c.bookings[0]?.date ?? null;
      if (!isInactive(last, now)) continue;
      await automationModule.run(org.id, "CUSTOMER_INACTIVE", {
        customerId: c.id,
        branchId: c.branchId ?? undefined,
        dedupeKey: c.id + ":" + monthKey,
        relatedType: "CUSTOMER",
        relatedId: c.id,
      });
      out.inactive++;
    }
  }

  return out;
}
