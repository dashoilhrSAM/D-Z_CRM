import { db } from "@/lib/db";
import { claimableTiers, previousWindowKey, windowKeyFor, type LedgerUnitLike, type TierLike, type TierSetLike } from "@/lib/commission/tiers";

// 阶梯奖励的「过期策略」按设计稿方案甲：**窗口结束后未领取的自动补发**。
//
// 为什么选甲（而不是"过期作废"）：奖励达成是既成事实，不该因为"忘了点按钮"而丢掉 ——
// 那会产生**无法解释的工资差异**，而解释不了的钱最后都会变成投诉。
//
// 实现要点：复用的是**同一个 claimableTiers 纯函数**。自动补发与手动领取必须走同一套判定，
// 否则会出现"面板显示可领但没人发"（或反过来）这种最难查的不一致。

export interface AutoGrantResult {
  windowKey: string;
  granted: number;
  totalSen: number;
  users: number;
}

/**
 * 把上一个窗口里「达标但没领」的阶梯奖励补发掉。
 * 幂等：CommissionClaim 的 (userId, tierId, windowKey) 唯一键兜住 —— 重复调用只会撞键。
 */
export async function autoGrantExpiredTiers(opts: { organisationId: string; now?: Date }): Promise<AutoGrantResult> {
  const now = opts.now ?? new Date();
  const windowKey = previousWindowKey(windowKeyFor("MONTH", now));

  const [rows, tierSetsRaw, tiersRaw, claims] = await Promise.all([
    db.commissionLedger.findMany({ where: { organisationId: opts.organisationId, windowKey } }),
    db.commissionTierSet.findMany({ where: { organisationId: opts.organisationId, active: true }, include: { tiers: true } }),
    db.commissionTier.findMany({ where: { tierSet: { organisationId: opts.organisationId } } }),
    db.commissionClaim.findMany({ where: { organisationId: opts.organisationId, windowKey } }),
  ]);

  const tierSets: TierSetLike[] = tierSetsRaw.map((s) => ({
    id: s.id, name: s.name, scope: s.scope, targetId: s.targetId, windowKind: s.windowKind,
    countUnit: s.countUnit, rewardKind: s.rewardKind, retroactive: s.retroactive,
    active: s.active, effectiveFrom: s.effectiveFrom, effectiveTo: s.effectiveTo,
  }));
  const tiers: TierLike[] = tiersRaw.map((t) => ({ id: t.id, tierSetId: t.tierSetId, thresholdQty: t.thresholdQty, rewardValue: t.rewardValue }));
  const ledgerRows: LedgerUnitLike[] = rows.map((r) => ({
    id: r.id, userId: r.userId, kind: r.kind, qty: r.qty, amountSen: r.amountSen,
    windowKey: r.windowKey, earnedAt: r.earnedAt,
    productId: r.productId, serviceTypeId: r.serviceTypeId, category: r.category,
  }));

  const userIds = [...new Set(ledgerRows.map((r) => r.userId))];
  let granted = 0;
  let totalSen = 0;

  for (const userId of userIds) {
    const claimedTierIds = claims.filter((c) => c.userId === userId).map((c) => c.tierId);
    const list = claimableTiers({ rows: ledgerRows, tierSets, tiers, claimedTierIds, userId, windowKey });
    for (const item of list) {
      try {
        await db.$transaction(async (tx) => {
          const claim = await tx.commissionClaim.create({
            data: {
              organisationId: opts.organisationId, userId,
              tierSetId: item.tierSet.id, tierId: item.tier.id, windowKey,
              claimedQty: item.progress.units, amountSen: item.amountSen, claimedAt: now,
            },
          });
          const ledger = await tx.commissionLedger.create({
            data: {
              organisationId: opts.organisationId, userId,
              kind: "TIER_BONUS", amountSen: item.amountSen, basis: "TIER", baseSen: 0, qty: 1,
              tierSetId: item.tierSet.id,
              tierSnapshot: JSON.stringify({
                tierId: item.tier.id, thresholdQty: item.tier.thresholdQty, rewardValue: item.tier.rewardValue,
                rewardKind: item.tierSet.rewardKind, units: item.progress.units, triggerRowId: item.triggerRowId,
              }),
              reason: "auto-granted: the window closed with this reward unclaimed",
              earnedAt: now, windowKey,
            },
          });
          await tx.commissionClaim.update({ where: { id: claim.id }, data: { ledgerId: ledger.id } });
        });
        granted += 1;
        totalSen += item.amountSen;
      } catch (e) {
        // P2002 = 唯一键冲突 = 这一档已经领过/发过（重跑就是这么被挡住的）
        if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") continue;
        throw e;
      }
    }
  }

  return { windowKey, granted, totalSen, users: userIds.length };
}
