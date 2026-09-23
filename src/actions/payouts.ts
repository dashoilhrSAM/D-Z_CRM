"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { scopedBranchId } from "@/lib/branch-scope";
import { audit } from "@/lib/auth/audit";
import { commissionFromLedger, resolvePayoutCommission } from "@/modules/commission/settlement";

/**
 * 发薪写入门禁：沿用**同文件 agreePayout 已经定过的规则**（员工、且不是机修 = 老板/经理），
 * 再加分行归属与审计。
 *
 * 为什么之前是个洞：settlePayouts 与 addPayoutPayment **一行校验都没有** —— 任何已登录员工
 * （含机修自己）都能写任意金额的薪资记录。而同一个文件里 agreePayout/mechanicConfirmPayout
 * 是校验的，mechanicConfirmPayout 甚至检查了"这是不是你的 payout"。又是"同一文件一半有一半没有"。
 */
async function requirePayoutWrite() {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user || session.role === "MECHANIC") {
    return { error: "Owner/manager access required" as const };
  }
  return { session, scope: scopedBranchId(session) };
}

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
  const authz = await requirePayoutWrite();
  if ("error" in authz) return { ok: false as const, error: authz.error };

  // 目标是员工账号：先一次性取出他们的分行，分行级用户只能给本店的人发薪。
  const targets = await db.user.findMany({
    where: { id: { in: list.map((i) => i.userId) } },
    select: { id: true, branchId: true },
  });
  const branchOf = new Map(targets.map((t) => [t.id, t.branchId]));
  if (list.some((i) => !branchOf.has(i.userId))) {
    return { ok: false as const, error: "Unknown staff in the payout list." };
  }
  if (authz.scope && list.some((i) => branchOf.get(i.userId) !== authz.scope)) {
    return { ok: false as const, error: "Some payouts belong to another branch." };
  }

  let settled = 0;
  let locked = 0;
  let ledgerUsed = 0;
  let legacyUsed = 0;
  let driftSen = 0;
  for (const it of list) {
    const existing = await db.staffPayout.findUnique({
      where: { userId_period_periodStart: { userId: it.userId, period: it.period, periodStart: it.periodStart } },
    });
    if (existing?.status === "PAID") {
      // **期间锁**：已付款的工资单绝不改写（否则历史工资单与银行流水对不上）。
      // 锁定之后新产生的台账会落到当前窗口（见 commissionFromLedger 按 earnedAt 取数）。
      locked++;
      continue;
    }

    // P4：佣金以**台账**为准，而不是调用方传来的数字。
    const ledger = await commissionFromLedger({
      organisationId: authz.session.orgId, userId: it.userId, period: it.period, periodStart: it.periodStart,
    });
    const decision = resolvePayoutCommission({ ledger, requestedSen: it.commissionSen, alreadyPaid: false });
    if (decision.source === "LEDGER") ledgerUsed++;
    else legacyUsed++;
    driftSen += Math.abs(decision.driftSen);

    const commissionSen = decision.commissionSen;
    const bonusSen = it.bonusSen ?? 0;
    const totalSen = it.baseSen + commissionSen + it.addonBonusSen + bonusSen;
    await db.staffPayout.upsert({
      where: { userId_period_periodStart: { userId: it.userId, period: it.period, periodStart: it.periodStart } },
      create: {
        userId: it.userId, period: it.period, periodStart: it.periodStart,
        baseSen: it.baseSen, commissionSen, addonBonusSen: it.addonBonusSen, bonusSen, totalSen,
        status: "PENDING", // 已发起，待出粮
      },
      update: { baseSen: it.baseSen, commissionSen, addonBonusSen: it.addonBonusSen, bonusSen, totalSen },
    });
    settled++;
    await audit({
      organisationId: authz.session.orgId, branchId: branchOf.get(it.userId) ?? null, userId: authz.session.user!.id,
      action: "PAYOUT_SETTLED", entity: "StaffPayout", entityId: [it.userId, it.period, it.periodStart.toISOString()].join("|"),
      after: {
        totalSen, period: it.period,
        // 留痕：这次佣金是从哪来的、与提交数差多少、有没有跨期调整（"为什么这个月数字变了"的答案）
        commissionSource: decision.source,
        commissionSen,
        driftSen: decision.driftSen,
        ledgerWindowKey: ledger.windowKey,
        ledgerRows: ledger.rowCount,
        lateSen: ledger.lateSen,
        lateWindowKeys: ledger.lateWindowKeys,
        note: decision.note,
      },
    });
  }
  revalidatePath("/workshop/settlements");
  return { ok: true as const, settled, locked, ledgerUsed, legacyUsed, driftSen };
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
  const authz = await requirePayoutWrite();
  if ("error" in authz) return { ok: false as const, error: authz.error };
  const payee = await db.user.findUnique({ where: { id: input.userId }, select: { branchId: true } });
  if (!payee) return { ok: false as const, error: "Unknown staff." };
  if (authz.scope && payee.branchId !== authz.scope) {
    return { ok: false as const, error: "This payout belongs to another branch." };
  }
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
  await audit({
    organisationId: authz.session.orgId, branchId: payee.branchId, userId: authz.session.user!.id,
    action: "PAYOUT_PAYMENT_RECORDED", entity: "StaffPayout", entityId: payout.id,
    after: { amountSen: input.amountSen, method: input.method, status },
  });
  revalidatePath("/workshop/settlements");
  return { ok: true as const };
}
