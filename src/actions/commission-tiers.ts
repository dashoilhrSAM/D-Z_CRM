"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth/audit";
import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/session-user";

// 阶梯组合的管理入口（P3 最后一块）。
//
// 为什么需要它：表、判定、领取、面板都做好了，但**老板没有任何界面能建一个「机油买十送二」**
// —— 只能改数据库或跑脚本，于是技师面板永远显示"还没有给你设定奖励目标"。
// 「功能做完了但没人用得上」是这类项目最容易骗过自己的地方（测试全绿、页面也上线了）。
//
// 三道门与佣金规则一致：矩阵权限（TECHNICIANS/edit）、入参校验、资金类写入留审计。

const SCOPES = ["ALL", "PRODUCT", "SERVICE", "CATEGORY"] as const;
const REWARD_KINDS = ["ONE_OFF_FIXED", "EXTRA_PER_UNIT_FIXED", "FREE_UNIT_COMMISSION"] as const;
const COUNT_UNITS = ["ITEM_QTY", "LINE_COUNT"] as const;
type Scope = (typeof SCOPES)[number];
type RewardKind = (typeof REWARD_KINDS)[number];

async function requireTierManager() {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return { error: "Not signed in" as const };
  const allowed = await can(
    { id: session.user.id, role: session.role as never, organisationId: session.orgId },
    "TECHNICIANS",
    "edit",
  );
  if (!allowed) return { error: "No permission to edit reward rules" as const };
  return { session };
}

export interface TierRow {
  id: string;
  thresholdQty: number;
  rewardValue: number;
}

export interface TierSetRow {
  id: string;
  name: string;
  scope: string;
  targetId: string | null;
  targetName: string;
  windowKind: string;
  countUnit: string;
  rewardKind: string;
  retroactive: boolean;
  active: boolean;
  effectiveFrom: string;
  tiers: TierRow[];
}

/** 阶梯组合列表 + 选择器要用的目录（商品 / 服务 / 分类）。 */
export async function listCommissionTierSets() {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return { ok: false as const, error: "Not signed in" };

  const [sets, products, serviceTypes] = await Promise.all([
    db.commissionTierSet.findMany({
      where: { organisationId: session.orgId },
      include: { tiers: { orderBy: { thresholdQty: "asc" } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    db.product.findMany({ where: { organisationId: session.orgId, active: true }, select: { id: true, name: true, category: true }, orderBy: { name: "asc" } }),
    db.serviceType.findMany({ where: { organisationId: session.orgId, active: true }, select: { id: true, name: true, category: true }, orderBy: { name: "asc" } }),
  ]);

  const nameOf = (scope: string, targetId: string | null) => {
    if (!targetId) return "";
    if (scope === "PRODUCT") return products.find((p) => p.id === targetId)?.name ?? targetId;
    if (scope === "SERVICE") return serviceTypes.find((s) => s.id === targetId)?.name ?? targetId;
    return targetId; // CATEGORY：targetId 就是分类名
  };
  const categories = [...new Set([...products.map((p) => p.category), ...serviceTypes.map((s) => s.category)].filter((c): c is string => !!c))].sort();

  const items: TierSetRow[] = sets.map((s) => ({
    id: s.id, name: s.name, scope: s.scope, targetId: s.targetId, targetName: nameOf(s.scope, s.targetId),
    windowKind: s.windowKind, countUnit: s.countUnit, rewardKind: s.rewardKind, retroactive: s.retroactive,
    active: s.active, effectiveFrom: s.effectiveFrom.toISOString(),
    tiers: s.tiers.map((t) => ({ id: t.id, thresholdQty: t.thresholdQty, rewardValue: t.rewardValue })),
  }));

  return {
    ok: true as const,
    items,
    catalogue: {
      products: products.map((p) => ({ id: p.id, name: p.name })),
      serviceTypes: serviceTypes.map((s) => ({ id: s.id, name: s.name })),
      categories,
    },
  };
}

export type UpsertTierSetInput = {
  id?: string;
  name: string;
  scope: Scope;
  targetId: string | null;
  countUnit: string;
  rewardKind: RewardKind;
  retroactive: boolean;
  effectiveFrom?: string | null;
  tiers: { thresholdQty: number; rewardValue: number }[];
};

/** 新建 / 更新一个阶梯组合（连同档位一起写）。 */
export async function upsertCommissionTierSet(input: UpsertTierSetInput) {
  const guard = await requireTierManager();
  if ("error" in guard) return { ok: false as const, error: guard.error };
  const { session } = guard;

  const name = input.name?.trim();
  if (!name) return { ok: false as const, error: "Give the reward a name." };
  if (!SCOPES.includes(input.scope)) return { ok: false as const, error: "Unknown scope" };
  if (!REWARD_KINDS.includes(input.rewardKind)) return { ok: false as const, error: "Unknown reward kind" };
  if (!COUNT_UNITS.includes(input.countUnit as (typeof COUNT_UNITS)[number])) return { ok: false as const, error: "Unknown counting unit" };

  // scope ↔ target 必须匹配（ALL 不需要 target；其余必须有）
  const targetId = input.targetId?.trim() || null;
  if (input.scope === "ALL" && targetId) return { ok: false as const, error: "A shop-wide reward cannot target one item." };
  if (input.scope !== "ALL" && !targetId) return { ok: false as const, error: "Choose what this reward applies to." };
  if (input.scope === "PRODUCT" && targetId) {
    if (!(await db.product.findFirst({ where: { id: targetId, organisationId: session.orgId }, select: { id: true } }))) {
      return { ok: false as const, error: "That product no longer exists." };
    }
  }
  if (input.scope === "SERVICE" && targetId) {
    if (!(await db.serviceType.findFirst({ where: { id: targetId, organisationId: session.orgId }, select: { id: true } }))) {
      return { ok: false as const, error: "That service no longer exists." };
    }
  }

  // 档位：至少一档、门槛递增且唯一、奖励值 > 0
  const tiers = (input.tiers ?? [])
    .map((t) => ({ thresholdQty: Math.round(t.thresholdQty), rewardValue: Math.round(t.rewardValue) }))
    .sort((a, b) => a.thresholdQty - b.thresholdQty);
  if (tiers.length === 0) return { ok: false as const, error: "Add at least one tier." };
  for (const t of tiers) {
    if (!Number.isFinite(t.thresholdQty) || t.thresholdQty <= 0) return { ok: false as const, error: "Each tier needs a unit count greater than 0." };
    if (!Number.isFinite(t.rewardValue) || t.rewardValue <= 0) return { ok: false as const, error: "Each tier needs a reward greater than 0." };
  }
  const seen = new Set<number>();
  for (const t of tiers) {
    if (seen.has(t.thresholdQty)) return { ok: false as const, error: "Two tiers cannot use the same unit count (" + t.thresholdQty + ")." };
    seen.add(t.thresholdQty);
  }

  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
  if (Number.isNaN(effectiveFrom.getTime())) return { ok: false as const, error: "Invalid start date." };

  const setData = {
    name,
    scope: input.scope,
    targetId,
    countUnit: input.countUnit,
    rewardKind: input.rewardKind,
    retroactive: input.rewardKind === "EXTRA_PER_UNIT_FIXED" ? !!input.retroactive : true,
    effectiveFrom,
  };

  const saved = await db.$transaction(async (tx) => {
    const set = input.id
      ? await tx.commissionTierSet.update({ where: { id: input.id }, data: setData })
      : await tx.commissionTierSet.create({ data: { ...setData, organisationId: session.orgId } });
    // 档位整体替换（组合的档位是一组定义，不做逐条 diff —— 少一个"删了半截"的中间态）
    await tx.commissionTier.deleteMany({ where: { tierSetId: set.id } });
    await tx.commissionTier.createMany({
      data: tiers.map((t) => ({ tierSetId: set.id, thresholdQty: t.thresholdQty, rewardValue: t.rewardValue })),
    });
    return set;
  });

  await audit({
    organisationId: session.orgId, branchId: session.branchId, userId: session.user!.id,
    action: input.id ? "COMMISSION_TIER_SET_UPDATE" : "COMMISSION_TIER_SET_CREATE",
    entity: "CommissionTierSet", entityId: saved.id,
    after: { name: saved.name, scope: saved.scope, targetId: saved.targetId, countUnit: saved.countUnit, rewardKind: saved.rewardKind, retroactive: saved.retroactive, tiers },
  });
  revalidatePath("/workshop/commission");
  revalidatePath("/mechanic-app");
  return { ok: true as const, id: saved.id };
}

/** 停用 / 启用一个组合（停用后不再计入面板，但历史领取记录保留）。 */
export async function setCommissionTierSetActive(id: string, active: boolean) {
  const guard = await requireTierManager();
  if ("error" in guard) return { ok: false as const, error: guard.error };
  const { session } = guard;
  const before = await db.commissionTierSet.findFirst({ where: { id, organisationId: session.orgId } });
  if (!before) return { ok: false as const, error: "Reward not found" };
  await db.commissionTierSet.update({ where: { id }, data: { active } });
  await audit({
    organisationId: session.orgId, branchId: session.branchId, userId: session.user!.id,
    action: "COMMISSION_TIER_SET_TOGGLE", entity: "CommissionTierSet", entityId: id,
    before: { active: before.active }, after: { active },
  });
  revalidatePath("/workshop/commission");
  revalidatePath("/mechanic-app");
  return { ok: true as const };
}
