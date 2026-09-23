"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { parseSalaryRules, type SalaryRules } from "@/modules/staff/service";
import { getSessionUser } from "@/lib/session-user";
import { windowKeyOf } from "@/lib/commission/apportion";

/** 保存薪资规则（仅 OWNER 可改）。 */
export async function updateSalaryRules(input: { baseSen: number; commissionType: SalaryRules["commissionType"]; commissionValue: number; addonBonusSen?: number }) {
  const session = await getSessionUser();
  if (session.kind !== "staff" || session.role !== "OWNER") return { ok: false as const, error: "Owner access required" };

  const org = await db.organisation.findFirst();
  if (!org) return { ok: false as const, error: "No organisation" };

  const next: SalaryRules = {
    baseSen: Math.max(0, Math.round(input.baseSen)),
    commissionType: input.commissionType,
    commissionValue: Math.max(0, Math.round(input.commissionValue)),
    addonBonusSen: Math.max(0, Math.round(input.addonBonusSen ?? 0)),
  };
  // 校验通过 parseSalaryRules 归一
  await db.organisation.update({ where: { id: org.id }, data: { salaryRules: parseSalaryRules(next) as never } });
  revalidatePath("/workshop/settlements");
  return { ok: true as const };
}

/** 每个技师独立的 commission 算法（仅 OWNER）。 */
export async function updateMechanicCommissionRules(userId: string, input: { commissionType: SalaryRules["commissionType"]; commissionValue: number; addonBonusSen?: number }) {
  const session = await getSessionUser();
  if (session.kind !== "staff" || session.role !== "OWNER") return { ok: false as const, error: "Owner access required" };
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { ok: false as const, error: "Mechanic not found" };
  await db.user.update({
    where: { id: userId },
    data: { commissionRules: JSON.stringify({ commissionType: input.commissionType, commissionValue: Math.max(0, Math.round(input.commissionValue)), addonBonusSen: Math.max(0, Math.round(input.addonBonusSen ?? 0)) }) },
  });
  revalidatePath("/workshop/settlements");
  return { ok: true as const };
}

/**
 * 覆盖某个 job 的佣金（老板/管理）。
 *
 * **P2 之后这里不再直接改数字**：台账是唯一真相且只追加，所以"人工改佣金"＝追加一条 ADJUSTMENT
 * 行（带原因与操作人），再把这个 job 的**显示用汇总字段**回填成台账合计。
 * 直接改字段会把金额变成一个没有来源的数字 —— 对账时说不清是谁、什么时候、为什么改的。
 *
 * commissionSen = null → 目标回到"规则自动算出来的金额"（即台账里的 BASE 合计）。
 */
export async function updateJobCommission(jobId: string, commissionSen: number | null) {
  const session = await getSessionUser();
  if (session.kind !== "staff" || session.role === "MECHANIC") return { ok: false as const, error: "Owner/manager access required" };
  const job = await db.serviceJob.findUnique({
    where: { id: jobId },
    select: { id: true, branchId: true, mechanicId: true, branch: { select: { organisationId: true } } },
  });
  if (!job) return { ok: false as const, error: "Job not found" };

  const rows = await db.commissionLedger.findMany({
    where: { jobId, kind: { in: ["BASE", "ADJUSTMENT", "REVERSAL"] } },
    select: { kind: true, amountSen: true },
  });
  const baseSum = rows.filter((r) => r.kind === "BASE").reduce((s, r) => s + r.amountSen, 0);
  const current = rows.reduce((s, r) => s + r.amountSen, 0);
  const target = commissionSen == null ? baseSum : Math.max(0, Math.round(commissionSen));
  const delta = target - current;

  if (delta !== 0) {
    await db.commissionLedger.create({
      data: {
        organisationId: job.branch.organisationId,
        branchId: job.branchId,
        userId: job.mechanicId ?? "UNASSIGNED",
        jobId,
        kind: "ADJUSTMENT",
        amountSen: delta,
        basis: "MANUAL",
        baseSen: 0,
        qty: 1,
        reason: commissionSen == null ? "reset to the amount computed by the rules" : "manual override by a manager",
        actorUserId: session.user?.id ?? null,
        earnedAt: new Date(),
        windowKey: windowKeyOf(new Date()),
      },
    });
  }

  // 汇总字段只用来显示与旧页面兼容；它不是真相，台账才是（本项目一贯：一个真相）。
  await db.serviceJob.update({ where: { id: jobId }, data: { commissionSen: current + delta } });
  revalidatePath("/workshop/settlements");
  revalidatePath("/", "layout");
  return { ok: true as const, adjustedSen: delta, totalSen: current + delta };
}

/** 结算时手填 bonus（写入 StaffPayout.bonusSen，total = commission + addon + bonus）。 */
export async function updateJobBonus(jobId: string, bonusSen: number | null) {
  const session = await getSessionUser();
  if (session.kind !== "staff" || session.role === "MECHANIC") return { ok: false as const, error: "Owner/manager access required" };
  await db.serviceJob.update({ where: { id: jobId }, data: { bonusSen: bonusSen != null ? Math.max(0, Math.round(bonusSen)) : null } });
  revalidatePath("/workshop/settlements");
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** 结算时手填 bonus（写入 StaffPayout.bonusSen，total = commission + addon + bonus）。 */
export async function setPayoutBonus(userId: string, period: string, periodStart: Date, bonusSen: number, commissionSen: number, addonBonusSen: number) {
  const session = await getSessionUser();
  if (session.kind !== "staff" || session.role === "MECHANIC") return { ok: false as const, error: "Owner/manager access required" };
  const bonus = Math.max(0, Math.round(bonusSen));
  const totalSen = commissionSen + addonBonusSen + bonus;
  await db.staffPayout.upsert({
    where: { userId_period_periodStart: { userId, period, periodStart } },
    create: { userId, period, periodStart, commissionSen, addonBonusSen, bonusSen: bonus, totalSen, status: "UNPAID" },
    update: { commissionSen, addonBonusSen, bonusSen: bonus, totalSen },
  });
  revalidatePath("/workshop/settlements");
  return { ok: true as const };
}
