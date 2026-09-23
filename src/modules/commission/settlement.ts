import { db } from "@/lib/db";
import { periodWindow } from "@/lib/period";
import { windowKeyOf } from "@/lib/commission/apportion";

// P4：结算整合 —— **发薪时的佣金数字由台账推导，不再由客户端传**。
//
// 为什么必须这样：settlePayouts 原本收的是调用方算好的 commissionSen。页面算得对就没事，
// 但「钱」这件事不该建立在"调用方算得对"之上 —— 台账才是唯一真相（设计稿 §4.5 不变量 1：
// Σ ledger(窗口, 人) == StaffPayout.commissionSen）。
//
// 三条硬规矩：
//  ① **期间锁**：StaffPayout.status = PAID 之后，绝不再改它的金额（否则历史工资单与银行流水对不上）；
//     锁定后新产生的台账落到**当前**窗口，并标成跨期调整。
//  ② **没有台账就保留旧口径，绝不静默清零**：P2 之前的历史工单根本没有台账行，
//     如果这里把没有台账当成 0，老账会被一键清零 —— 这正是本项目最忌讳的那类静默失败。
//  ③ **差异要留痕**：台账算出来的数与调用方传的不一致时，把差额记进返回值与审计，
//     让"某个月数字变了"有据可查，而不是悄悄改掉。

export type LedgerKindSum = {
  baseSen: number;
  tierBonusSen: number;
  adjustmentSen: number;
  reversalSen: number;
  totalSen: number;
  rowCount: number;
};

export interface WindowCommission extends LedgerKindSum {
  /** 该周期归属的窗口键（如 "2026-09"） */
  windowKey: string;
  windowStart: Date;
  windowEnd: Date;
  /** 迟到的计提：**时间**落在本周期内、但归属窗口是更早的月份 */
  lateSen: number;
  lateRowCount: number;
  lateWindowKeys: string[];
}

function emptySum(): LedgerKindSum {
  return { baseSen: 0, tierBonusSen: 0, adjustmentSen: 0, reversalSen: 0, totalSen: 0, rowCount: 0 };
}

/**
 * 某个员工在某个发薪周期内的佣金（来自台账）。
 * 取数按 **earnedAt**（计提时刻）落在周期内为准 —— 这就是"迟到的计提落到当前窗口"的实现，
 * 而不是按窗口键去匹配（那样上月的工单今天完工就会永远发不出去）。
 */
export async function commissionFromLedger(args: {
  organisationId: string;
  userId: string;
  period: "day" | "week" | "month" | string;
  periodStart: Date;
}): Promise<WindowCommission> {
  const period = (args.period === "day" || args.period === "week" ? args.period : "month") as "day" | "week" | "month";
  const { start, end } = periodWindow(period, args.periodStart);
  const windowKey = windowKeyOf(start);

  const rows = await db.commissionLedger.findMany({
    where: { organisationId: args.organisationId, userId: args.userId, earnedAt: { gte: start, lt: end } },
    select: { kind: true, amountSen: true, windowKey: true },
  });

  const sum = emptySum();
  let lateSen = 0;
  let lateRowCount = 0;
  const lateWindowKeys = new Set<string>();
  for (const r of rows) {
    sum.rowCount += 1;
    if (r.kind === "BASE") sum.baseSen += r.amountSen;
    else if (r.kind === "TIER_BONUS") sum.tierBonusSen += r.amountSen;
    else if (r.kind === "ADJUSTMENT") sum.adjustmentSen += r.amountSen;
    else if (r.kind === "REVERSAL") sum.reversalSen += r.amountSen;
    // PENDING / LEGACY 是 0 元痕迹，参与不了金额（但计入 rowCount，用于判断"有没有台账"）
    if (r.windowKey !== windowKey && (r.kind === "BASE" || r.kind === "TIER_BONUS" || r.kind === "ADJUSTMENT" || r.kind === "REVERSAL")) {
      lateSen += r.kind === "REVERSAL" ? -r.amountSen : r.amountSen;
      lateRowCount += 1;
      lateWindowKeys.add(r.windowKey);
    }
  }
  sum.totalSen = sum.baseSen + sum.tierBonusSen + sum.adjustmentSen - sum.reversalSen;

  return {
    ...sum,
    windowKey,
    windowStart: start,
    windowEnd: end,
    lateSen,
    lateRowCount,
    lateWindowKeys: [...lateWindowKeys].sort(),
  };
}

export type CommissionSource = "LEDGER" | "LEGACY" | "LOCKED";

export interface PayoutCommissionDecision {
  commissionSen: number;
  source: CommissionSource;
  /** 台账数与请求数之差（有台账才算；用于留痕） */
  driftSen: number;
  note: string | null;
}

/**
 * 决定这次发薪用哪个佣金数字（纯函数，可单测）。
 *  · PAID → LOCKED：已付款的期间绝不改写，调用方应当跳过；
 *  · 有台账 → LEDGER：以台账为准（这就是"唯一真相"）；
 *  · 无台账 → LEGACY：保留调用方给的数，**绝不当成 0**（P2 之前的历史工单没有台账行）。
 */
export function resolvePayoutCommission(args: {
  ledger: LedgerKindSum;
  requestedSen: number;
  alreadyPaid: boolean;
}): PayoutCommissionDecision {
  if (args.alreadyPaid) {
    return { commissionSen: args.requestedSen, source: "LOCKED", driftSen: 0, note: "period is paid; the amount is frozen" };
  }
  if (args.ledger.rowCount === 0) {
    return {
      commissionSen: args.requestedSen,
      source: "LEGACY",
      driftSen: 0,
      note: "no ledger rows in this period — legacy per-staff figure kept (not zeroed)",
    };
  }
  const drift = args.ledger.totalSen - args.requestedSen;
  return {
    commissionSen: args.ledger.totalSen,
    source: "LEDGER",
    driftSen: drift,
    note: drift === 0 ? null : "ledger figure differs from the submitted one by " + drift + " sen",
  };
}
