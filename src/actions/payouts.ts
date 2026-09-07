"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";

export interface PayoutDraft {
  userId: string;
  period: string;
  periodStart: Date;
  baseSen: number;
  commissionSen: number;
  addonBonusSen: number;
  bonusSen?: number;
  totalSen: number;
}

/** 发起发薪（workshop tick）：创建/更新 StaffPayout → PENDING（待 workshop 出粮；出粮后转 AWAITING_CONFIRM 待 mechanic 确认才完成）。 */
export async function settlePayouts(items: PayoutDraft[]) {
  const list = items.filter((i) => i.totalSen > 0);
  if (list.length === 0) return { ok: false as const, error: "Nothing to settle" };
  for (const it of list) {
    const existing = await db.staffPayout.findUnique({
      where: { userId_period_periodStart: { userId: it.userId, period: it.period, periodStart: it.periodStart } },
      include: { payments: { select: { amountSen: true } } },
    });
    const paidSen = existing?.payments.reduce((s, p) => s + p.amountSen, 0) ?? 0;
    if (existing?.status === "PAID") continue; // 已确认完成
    await db.staffPayout.upsert({
      where: { userId_period_periodStart: { userId: it.userId, period: it.period, periodStart: it.periodStart } },
      create: {
        userId: it.userId, period: it.period, periodStart: it.periodStart,
        baseSen: it.baseSen, commissionSen: it.commissionSen, addonBonusSen: it.addonBonusSen, bonusSen: it.bonusSen ?? 0, totalSen: it.totalSen,
        status: "PENDING", // 已发起，待出粮
      },
      update: { baseSen: it.baseSen, commissionSen: it.commissionSen, addonBonusSen: it.addonBonusSen, bonusSen: it.bonusSen ?? 0, totalSen: it.totalSen },
    });
  }
  revalidatePath("/workshop/settlements");
  return { ok: true as const, settled: list.length };
}

/** Workshop 出粮（记录付款）：PENDING/PARTIAL → AWAITING_CONFIRM（已付款，待 mechanic 确认收款才算完成）。 */
export async function agreePayout(payoutId: string, method: string) {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user || session.role === "MECHANIC") return { ok: false as const, error: "Owner/manager access required" };
  const payout = await db.staffPayout.findUnique({ where: { id: payoutId }, select: { id: true, totalSen: true, status: true } });
  if (!payout) return { ok: false as const, error: "Payout not found" };
  if (payout.status === "PAID") return { ok: false as const, error: "Already confirmed & paid" };
  if (payout.status === "AWAITING_CONFIRM") return { ok: false as const, error: "Already paid — awaiting mechanic confirmation" };

  await db.staffPayoutPayment.create({ data: { payoutId: payout.id, amountSen: payout.totalSen, method, paidAt: new Date() } });
  await db.staffPayout.update({ where: { id: payout.id }, data: { status: "AWAITING_CONFIRM" } });
  revalidatePath("/workshop/settlements");
  revalidatePath("/mechanic-app/profile");
  revalidatePath("/mechanic-app/earnings");
  return { ok: true as const };
}

/** Mechanic 确认收款（双向确认第 2 步）：AWAITING_CONFIRM → PAID（才算完成）。 */
export async function mechanicConfirmPayout(payoutId: string) {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user || session.role !== "MECHANIC") return { ok: false as const, error: "Mechanic access required" };
  const payout = await db.staffPayout.findUnique({ where: { id: payoutId }, select: { id: true, userId: true, status: true } });
  if (!payout || payout.userId !== session.user.id) return { ok: false as const, error: "Not your payout" };
  if (payout.status !== "AWAITING_CONFIRM") return { ok: false as const, error: "Not awaiting your confirmation" };

  await db.staffPayout.update({ where: { id: payout.id }, data: { status: "PAID", paidAt: new Date() } });
  revalidatePath("/mechanic-app/profile");
  revalidatePath("/mechanic-app/earnings");
  revalidatePath("/workshop/settlements");
  return { ok: true as const };
}

/** Split 分期发薪：为某 foreman 的周期薪资加一笔支付；累计满额 → AWAITING_CONFIRM（待 mechanic 确认）。 */
export async function addPayoutPayment(input: { userId: string; period: string; periodStart: Date; baseSen: number; commissionSen: number; addonBonusSen: number; totalSen: number; amountSen: number; method: string }) {
  if (input.amountSen <= 0) return { ok: false as const, error: "Invalid amount" };
  const payout = await db.staffPayout.upsert({
    where: { userId_period_periodStart: { userId: input.userId, period: input.period, periodStart: input.periodStart } },
    create: {
      userId: input.userId, period: input.period, periodStart: input.periodStart,
      baseSen: input.baseSen, commissionSen: input.commissionSen, addonBonusSen: input.addonBonusSen, totalSen: input.totalSen,
      status: "PARTIAL",
    },
    update: { baseSen: input.baseSen, commissionSen: input.commissionSen, addonBonusSen: input.addonBonusSen, totalSen: input.totalSen },
  });
  if (payout.status !== "PAID" && payout.status !== "AWAITING_CONFIRM") {
    await db.staffPayoutPayment.create({ data: { payoutId: payout.id, amountSen: input.amountSen, method: input.method, paidAt: new Date() } });
  }
  const paid = await db.staffPayoutPayment.aggregate({ where: { payoutId: payout.id }, _sum: { amountSen: true } });
  const status = (paid._sum.amountSen ?? 0) >= input.totalSen ? "AWAITING_CONFIRM" : "PARTIAL";
  await db.staffPayout.update({ where: { id: payout.id }, data: { status, paidAt: null } });
  revalidatePath("/workshop/settlements");
  return { ok: true as const };
}
