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
 *
 * ── 2026-09-29 多租户修正（P0）────────────────────────────────────────────
 * 原实现是**单租户**的，且不只是「少扫几家」那么简单：
 *   · db.organisation.findFirst() → 只看第一家门店的规则；
 *   · 三个 findMany **完全没有租户过滤** → 把别家门店的提醒/预约/客户
 *     喂进**第一家门店**的自动化规则里（跨租户串消息，且客户会收到不该收到的提醒）；
 *   · take: 200 / 500 / 2000 是全平台共享窗口 → 门店一多，后面的门店永远轮不到。
 * 现在：按 org 逐个扫描、每个查询都按租户收窄、按天轮转起点 + 时间预算，
 * 并且**把「今天没扫完」如实报出来**（orgsRemaining / truncated），
 * 而不是让一个静默截断看起来像「今天没事发生」。
 *
 * 注意 ServiceReminder 与 Booking 这两张表**没有 organisationId 列**，
 * 必须经关系收窄（customer.organisationId / branch.organisationId）——
 * 写这一层过滤时不要凭字段名猜。
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

/** 单次 cron 运行的时间预算：Vercel Pro 函数默认 300s，留足余量给最后一条消息与响应。 */
export const SCAN_TIME_BUDGET_MS = 200_000;

/** 单次运行最多扫多少家门店（时间预算之外的第二道保险，防一家卡住拖垮全部）。 */
export const SCAN_ORG_BATCH = 50;

/** 每家门店每类一次最多处理多少条（每家都有独立配额，不再全平台共享）。 */
export const PER_ORG_LIMITS = { serviceDue: 200, approaching: 500, inactive: 2000 };

/**
 * 按天轮转数组起点（纯函数）。
 *
 * 为什么需要：一次 cron 跑不完所有门店时，如果每天都从队首开始，
 * **尾部的门店会被永远饿死**（"有界窗口"最典型的失败形态）。
 * 用「第几天」当偏移量，让每天的起点不同 —— 今天没扫到的，明天排在最前面。
 */
export function rotateForDay<T>(items: T[], dayIndex: number): T[] {
  if (items.length === 0) return items;
  const offset = ((Math.trunc(dayIndex) % items.length) + items.length) % items.length;
  if (offset === 0) return items.slice();
  return items.slice(offset).concat(items.slice(0, offset));
}

/** UTC 第几天（用作每日轮转的偏移量）。 */
export function utcDayIndex(now: Date): number {
  return Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
}

/**
 * 把到期的延迟消息发出去。
 *
 * 与自动化规则里的 SEND_MESSAGE 走**同一个发送入口**（messagingModule.sendFromTemplate ✓），
 * 所以 opt-out、真实 status/externalId、失败记录都自动一致 —— 不另开一条发送路径。
 *
 * 2026-09-29：原来单次只取 50 条且不分租户 —— 500 家门店时全平台每天只发出 50 条，
 * 且先到先得。现在改成「一批 50 条、循环取到没有为止」，受时间预算约束，
 * 并把没发完的条数如实报出来。
 */
export async function sendDueScheduledMessages(
  now: Date = new Date(),
  budgetMs: number = SCAN_TIME_BUDGET_MS,
): Promise<{ sent: number; failed: number; remaining: number; truncated: boolean }> {
  const startedAt = Date.now();
  const BATCH = 50;
  let sent = 0;
  let failed = 0;
  let truncated = false;

  for (;;) {
    const due = await db.scheduledMessage.findMany({
      where: { status: "PENDING", sendAt: { lte: now } },
      take: BATCH,
      orderBy: { sendAt: "asc" },
    });
    if (due.length === 0) break;

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

    if (Date.now() - startedAt > budgetMs) {
      // 时间用尽：把还没发的**数出来**再停，让调用方看得见截断
      const left = await db.scheduledMessage.count({ where: { status: "PENDING", sendAt: { lte: now } } });
      if (left > 0) truncated = true;
      return { sent, failed, remaining: left, truncated };
    }
  }

  return { sent, failed, remaining: 0, truncated };
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

export interface OrgScanCounts {
  serviceDue: number;
  approaching: number;
  inactive: number;
  /** 因为没有 SERVICE_DUE 规则而交给内置提醒的数量（0 就是规则接管了） */
  builtInRemindersInstead: number;
}

export interface MultiOrgScanResult extends OrgScanCounts {
  orgsTotal: number;
  orgsScanned: number;
  orgsRemaining: number;
  /** true = 本次没扫完，剩下的按日轮转会排在下次的队首 */
  truncated: boolean;
}

/**
 * 扫**一家**门店的三类时间触发器。所有查询都按该门店收窄 —— 这是多租户不变量，
 * 不要在没有过滤条件的 findMany 上加分支（历史上就是那么串的门店）。
 */
export async function scanOrganisation(organisationId: string, now: Date): Promise<OrgScanCounts> {
  const out: OrgScanCounts = { serviceDue: 0, approaching: 0, inactive: 0, builtInRemindersInstead: 0 };

  const ruleCount = await db.automationRule.groupBy({
    by: ["trigger"],
    where: { organisationId, active: true, trigger: { in: ["SERVICE_DUE", "BOOKING_APPROACHING", "CUSTOMER_INACTIVE"] } },
    _count: true,
  });
  const has = (t: string) => ruleCount.some((r) => r.trigger === t && r._count > 0);

  // ① 服务到期：复用 serviceReminder 的判定（与 sendDueReminders 完全一致）。
  //    ServiceReminder 没有 organisationId，经 customer 收窄。
  const due = await db.serviceReminder.findMany({
    where: {
      closedAt: null,
      customer: { organisationId },
      OR: [{ status: "DUE" }, { status: "OVERDUE" }, { estimatedDate: { lte: now } }],
    },
    select: { id: true, customerId: true, motorcycleId: true },
    take: PER_ORG_LIMITS.serviceDue,
  });
  if (has("SERVICE_DUE")) {
    for (const r of due) {
      await automationModule.run(organisationId, "SERVICE_DUE", {
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

  // ② 明天要来：按 booking id 去重（一个预约只提醒一次）。
  //    Booking 也没有 organisationId，经 branch 收窄。
  if (has("BOOKING_APPROACHING")) {
    const soon = await db.booking.findMany({
      where: { branch: { organisationId }, status: { notIn: ["CANCELLED", "COMPLETED", "NO_SHOW"] } },
      select: { id: true, date: true, customerId: true, motorcycleId: true, branchId: true },
      take: PER_ORG_LIMITS.approaching,
    });
    for (const b of soon.filter((b) => isBookingApproaching(b.date, now))) {
      await automationModule.run(organisationId, "BOOKING_APPROACHING", {
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
      where: { organisationId },
      select: { id: true, name: true, phone: true, branchId: true, bookings: { select: { date: true }, orderBy: { date: "desc" }, take: 1 } },
      take: PER_ORG_LIMITS.inactive,
    });
    for (const c of customers) {
      const last = c.bookings[0]?.date ?? null;
      if (!isInactive(last, now)) continue;
      await automationModule.run(organisationId, "CUSTOMER_INACTIVE", {
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

/** 每天跑一次：把三类「时间到了」喂给**每一家**门店的自动化引擎 */
export async function runTimeBasedAutomations(
  now: Date = new Date(),
  budgetMs: number = SCAN_TIME_BUDGET_MS,
): Promise<MultiOrgScanResult> {
  const startedAt = Date.now();
  const orgs = await db.organisation.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  // 按天轮转起点：扫不完时，今天被落下的门店明天排在前面（见 rotateForDay 注释）
  const ordered = rotateForDay(orgs, utcDayIndex(now));

  const out: MultiOrgScanResult = {
    serviceDue: 0,
    approaching: 0,
    inactive: 0,
    builtInRemindersInstead: 0,
    orgsTotal: orgs.length,
    orgsScanned: 0,
    orgsRemaining: orgs.length,
    truncated: false,
  };

  for (const org of ordered) {
    if (out.orgsScanned >= SCAN_ORG_BATCH || (out.orgsScanned > 0 && Date.now() - startedAt > budgetMs)) {
      out.truncated = true;
      break;
    }
    const counts = await scanOrganisation(org.id, now);
    out.serviceDue += counts.serviceDue;
    out.approaching += counts.approaching;
    out.inactive += counts.inactive;
    out.builtInRemindersInstead += counts.builtInRemindersInstead;
    out.orgsScanned++;
  }

  out.orgsRemaining = out.orgsTotal - out.orgsScanned;
  return out;
}
