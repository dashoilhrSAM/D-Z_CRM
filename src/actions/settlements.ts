"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { parseSalaryRules, type SalaryRules } from "@/modules/staff/service";
import { getSessionUser } from "@/lib/session-user";

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

/** 覆盖某个 job 的提成（老板/管理）；null=恢复按个人算法自动算。 */
export async function updateJobCommission(jobId: string, commissionSen: number | null) {
  const session = await getSessionUser();
  if (session.kind !== "staff" || session.role === "MECHANIC") return { ok: false as const, error: "Owner/manager access required" };
  await db.serviceJob.update({ where: { id: jobId }, data: { commissionSen: commissionSen != null ? Math.max(0, Math.round(commissionSen)) : null } });
  revalidatePath("/workshop/settlements");
  revalidatePath("/", "layout");
  return { ok: true as const };
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
