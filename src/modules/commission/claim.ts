import { db } from "@/lib/db";
import { describeRule, resolveCommissionRule, type CommissionRuleLike } from "@/lib/commission/resolve";
import { claimableTiers, evaluateTierSet, windowKeyFor, type LedgerUnitLike, type TierLike, type TierSetLike } from "@/lib/commission/tiers";

// 阶梯奖励的**领取核心**（模块层，无 session / 无 revalidate，因此可单测）。
// action 只是薄薄一层：鉴权 + 调用这里 + 刷新页面。
//
// 两条铁律（设计稿 §3.4）：
//  ① **可领取状态是推导出来的，不是存出来的** —— 件数达标且 claims 里没有对应行 = 可领取。
//     于是不存在"状态字段忘了改"这种可能；
//  ② **领取是 TIER_BONUS 台账的唯一入口** —— 自动发放与手动领取不会同时发生（那是最容易打架的地方）。

export interface ClaimableItemView {
  tierSetId: string;
  tierSetName: string;
  scope: string;
  targetId: string | null;
  targetName: string;
  rewardKind: string;
  rewardLabel: string;
  units: number;
  progressPct: number;
  remaining: number;
  nextTier: { tierId: string; thresholdQty: number; rewardValue: number } | null;
  tiers: { tierId: string; thresholdQty: number; rewardValue: number; amountSen: number; claimed: boolean; claimable: boolean; triggerRowId: string | null }[];
  /** 与该组合配套的基础规则（设计稿要求展示：让技师看到"这单本来拿多少 + 阶梯再加多少"） */
  baseRuleLabel: string | null;
}

export interface TierPanel {
  windowKey: string;
  sets: ClaimableItemView[];
  history: { id: string; tierSetName: string; windowKey: string; claimedQty: number; amountSen: number; claimedAt: Date; auto: boolean }[];
  /** 可领取金额合计（面板上直接显示"有 X 可领"） */
  claimableTotalSen: number;
}

const REWARD_LABEL: Record<string, string> = {
  ONE_OFF_FIXED: "one-off bonus",
  EXTRA_PER_UNIT_FIXED: "extra per unit",
  FREE_UNIT_COMMISSION: "commission on free units",
};

function toLikes(rows: { id: string; userId: string; kind: string; qty: number; amountSen: number; windowKey: string; earnedAt: Date; productId: string | null; serviceTypeId: string | null; category: string | null }[]): LedgerUnitLike[] {
  return rows.map((r) => ({
    id: r.id, userId: r.userId, kind: r.kind, qty: r.qty, amountSen: r.amountSen,
    windowKey: r.windowKey, earnedAt: r.earnedAt,
    productId: r.productId, serviceTypeId: r.serviceTypeId, category: r.category,
  }));
}

async function loadContext(organisationId: string, userId: string, windowKey: string) {
  const [rows, tierSetsRaw, tiersRaw, claims, rulesRaw, products, serviceTypes] = await Promise.all([
    db.commissionLedger.findMany({ where: { organisationId, userId, windowKey } }),
    db.commissionTierSet.findMany({ where: { organisationId, active: true }, include: { tiers: true } }),
    db.commissionTier.findMany({ where: { tierSet: { organisationId } } }),
    db.commissionClaim.findMany({ where: { organisationId, userId, windowKey } }),
    db.commissionRule.findMany({ where: { organisationId, active: true } }),
    db.product.findMany({ where: { organisationId }, select: { id: true, name: true } }),
    db.serviceType.findMany({ where: { organisationId }, select: { id: true, name: true } }),
  ]);

  const tierSets: TierSetLike[] = tierSetsRaw.map((s) => ({
    id: s.id, name: s.name, scope: s.scope, targetId: s.targetId, windowKind: s.windowKind,
    countUnit: s.countUnit, rewardKind: s.rewardKind, retroactive: s.retroactive,
    active: s.active, effectiveFrom: s.effectiveFrom, effectiveTo: s.effectiveTo,
  }));
  const tiers: TierLike[] = tiersRaw.map((t) => ({ id: t.id, tierSetId: t.tierSetId, thresholdQty: t.thresholdQty, rewardValue: t.rewardValue }));
  const rules: CommissionRuleLike[] = rulesRaw.map((r) => ({
    id: r.id, scope: r.scope, targetKey: r.targetKey, basis: r.basis, value: r.value,
    valuePercent: r.valuePercent, valueFixedSen: r.valueFixedSen,
    effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, priority: r.priority, active: r.active,
  }));
  return { ledgerRows: toLikes(rows), tierSets, tiers, claims, rules, products, serviceTypes };
}

/** 面板数据（技师自己看自己）。 */
export async function tierPanelFor(organisationId: string, userId: string, now = new Date()): Promise<TierPanel> {
  const windowKey = windowKeyFor("MONTH", now);
  const { ledgerRows, tierSets, tiers, claims, rules, products, serviceTypes } = await loadContext(organisationId, userId, windowKey);
  const claimedTierIds = claims.map((c) => c.tierId);
  const claimable = claimableTiers({ rows: ledgerRows, tierSets, tiers, claimedTierIds, userId, windowKey });
  const nameOf = (set: TierSetLike) => {
    if (set.scope === "ALL") return "All services & products";
    if (set.scope === "PRODUCT") return products.find((p) => p.id === set.targetId)?.name ?? set.targetId ?? "-";
    if (set.scope === "SERVICE") return serviceTypes.find((s) => s.id === set.targetId)?.name ?? set.targetId ?? "-";
    return set.targetId ?? "-";
  };

  const sets: ClaimableItemView[] = tierSets.map((set) => {
    const progress = evaluateTierSet(ledgerRows, set, tiers, userId, windowKey);
    const ownTiers = tiers.filter((t) => t.tierSetId === set.id).sort((a, b) => a.thresholdQty - b.thresholdQty);
    // 与组合配套的基础规则：拿这一层最具体的一条来解释（商品/服务按 id，分类按分类名，全店看默认）
    const probe = set.scope === "PRODUCT"
      ? { productId: set.targetId, baseSen: 0, qty: 1 }
      : set.scope === "SERVICE"
        ? { serviceTypeId: set.targetId, baseSen: 0, qty: 1 }
        : set.scope === "CATEGORY"
          ? { category: set.targetId, baseSen: 0, qty: 1 }
          : { baseSen: 0, qty: 1 };
    const resolved = resolveCommissionRule(probe, rules, now);
    return {
      tierSetId: set.id,
      tierSetName: set.name,
      scope: set.scope,
      targetId: set.targetId,
      targetName: nameOf(set),
      rewardKind: set.rewardKind,
      rewardLabel: REWARD_LABEL[set.rewardKind] ?? set.rewardKind,
      units: progress.units,
      progressPct: progress.progressPct,
      remaining: progress.remaining,
      nextTier: progress.nextTier ? { tierId: progress.nextTier.id, thresholdQty: progress.nextTier.thresholdQty, rewardValue: progress.nextTier.rewardValue } : null,
      tiers: ownTiers.map((t) => {
        const hit = claimable.find((c) => c.tierSet.id === set.id && c.tier.id === t.id);
        const achieved = progress.achievements.find((a) => a.tier.id === t.id);
        return {
          tierId: t.id, thresholdQty: t.thresholdQty, rewardValue: t.rewardValue,
          amountSen: hit?.amountSen ?? 0,
          claimed: claimedTierIds.includes(t.id),
          claimable: !!hit,
          triggerRowId: achieved?.triggerRowId ?? null,
        };
      }),
      baseRuleLabel: resolved.ok ? describeRule(resolved.rule) : null,
    };
  });

  const history = claims
    .map((c) => ({
      id: c.id,
      tierSetName: tierSets.find((s) => s.id === c.tierSetId)?.name ?? c.tierSetId,
      windowKey: c.windowKey,
      claimedQty: c.claimedQty,
      amountSen: c.amountSen,
      claimedAt: c.claimedAt,
      auto: false,
    }))
    .sort((a, b) => b.claimedAt.getTime() - a.claimedAt.getTime());

  return {
    windowKey,
    sets: sets.filter((s) => s.tiers.length > 0),
    history,
    claimableTotalSen: claimable.reduce((sum, c) => sum + c.amountSen, 0),
  };
}

export interface ClaimResult {
  ok: boolean;
  error?: string;
  amountSen?: number;
  tierSetName?: string;
}

/**
 * 领取一档奖励。userId 由调用方（action）从**会话**里取 —— 不接受客户端传入，
 * 于是"替别人领取"在这个签名下根本表达不出来。
 */
export async function claimTierFor(
  organisationId: string,
  userId: string,
  input: { tierSetId: string; tierId: string },
  now = new Date(),
): Promise<ClaimResult> {
  const windowKey = windowKeyFor("MONTH", now);
  const { ledgerRows, tierSets, tiers, claims } = await loadContext(organisationId, userId, windowKey);
  const claimedTierIds = claims.map((c) => c.tierId);
  // **服务端重算**可领取性：绝不相信客户端传来的"我能领"
  const claimable = claimableTiers({ rows: ledgerRows, tierSets, tiers, claimedTierIds, userId, windowKey });
  const target = claimable.find((c) => c.tierSet.id === input.tierSetId && c.tier.id === input.tierId);
  if (!target) {
    return { ok: false, error: "This reward is not claimable — it is not earned yet, already claimed, or the window has changed." };
  }

  try {
    await db.$transaction(async (tx) => {
      // 先插 claim：唯一键 (userId, tierId, windowKey) 是"只能领一次"的真正保证
      const claim = await tx.commissionClaim.create({
        data: {
          organisationId, userId,
          tierSetId: target.tierSet.id, tierId: target.tier.id, windowKey,
          claimedQty: target.progress.units, amountSen: target.amountSen, claimedAt: now,
        },
      });
      const ledger = await tx.commissionLedger.create({
        data: {
          organisationId, userId,
          kind: "TIER_BONUS", amountSen: target.amountSen, basis: "TIER", baseSen: 0, qty: 1,
          tierSetId: target.tierSet.id,
          tierSnapshot: JSON.stringify({
            tierId: target.tier.id, thresholdQty: target.tier.thresholdQty, rewardValue: target.tier.rewardValue,
            rewardKind: target.tierSet.rewardKind, units: target.progress.units, triggerRowId: target.triggerRowId,
          }),
          reason: "claimed by the mechanic",
          earnedAt: now, windowKey,
        },
      });
      await tx.commissionClaim.update({ where: { id: claim.id }, data: { ledgerId: ledger.id } });
    });
  } catch (e) {
    // P2002 = 并发下两个点击同时到达：唯一键只放一个进来
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
      return { ok: false, error: "Already claimed." };
    }
    throw e;
  }

  return { ok: true, amountSen: target.amountSen, tierSetName: target.tierSet.name };
}
