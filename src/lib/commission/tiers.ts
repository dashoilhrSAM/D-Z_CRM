// 阶梯的纯函数层（P3，无 IO）。
//
// 三条不可动摇的规矩（设计稿 §3）：
//  ① **不存"当前件数"计数器** —— 件数一律从台账推导。计数器 + 定时清零是这类系统最经典的事故源：
//     漏跑一次就算错，而且没人会发现。窗口天然切换让"重置"这件事在架构上不存在。
//  ② 达档归属必须**确定性**：两单落在同一毫秒时也要有唯一答案（按 earnedAt 升序、id 升序，
//     排序后跨过门槛的那一条负责记奖励）。否则两个技师会为"第 10 件归谁"扯皮。
//  ③ 奖励的金额在这个函数里算清，并允许调用方把「触发的那一条台账行」写进快照 —— 争议时靠它解释。
import { windowKeyOf } from "@/lib/commission/apportion";

export type TierScope = "PRODUCT" | "SERVICE" | "CATEGORY" | "ALL";
export type TierRewardKind = "ONE_OFF_FIXED" | "EXTRA_PER_UNIT_FIXED" | "FREE_UNIT_COMMISSION";

export interface TierSetLike {
  id: string;
  name: string;
  scope: string;
  targetId: string | null;
  windowKind: string; // MONTH（目前只实现这个；PAY_CYCLE / ROLLING_30D 需要额外口径）
  countUnit: string; // ITEM_QTY（件）| LINE_COUNT（行）
  rewardKind: string;
  retroactive: boolean;
  active: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface TierLike {
  id: string;
  tierSetId: string;
  thresholdQty: number;
  rewardValue: number;
}

/** 台账行参与统计所需的最小形状（含 P3 新增的作用域身份列）。 */
export interface LedgerUnitLike {
  id: string;
  userId: string;
  kind: string;
  qty: number;
  amountSen: number;
  windowKey: string;
  earnedAt: Date;
  productId?: string | null;
  serviceTypeId?: string | null;
  category?: string | null;
}

/** 组合生效区间内、且落在该窗口的时间点是否适用（组合可以后来才建）。 */
function tierSetApplies(tierSet: TierSetLike, windowKey: string): boolean {
  const from = windowKeyOf(tierSet.effectiveFrom);
  if (windowKey < from) return false;
  if (tierSet.effectiveTo && windowKey > windowKeyOf(tierSet.effectiveTo)) return false;
  return tierSet.active;
}

/** 窗口键（目前只支持 MONTH = 门店时区 MYT 的自然月）。 */
export function windowKeyFor(windowKind: string, at: Date): string {
  if (windowKind === "MONTH") return windowKeyOf(at);
  // 其它窗口类型还没实现：**明确抛错而不是悄悄按 MONTH 算** —— 悄悄按错的窗口统计比没有统计更糟。
  throw new Error("Unsupported tier windowKind: " + windowKind);
}

/** 这一条台账行是否在这个组合的作用域里。 */
export function rowMatchesScope(row: LedgerUnitLike, tierSet: TierSetLike): boolean {
  const key = tierSet.targetId;
  switch (tierSet.scope) {
    case "PRODUCT":
      return !!key && !!row.productId && row.productId === key;
    case "SERVICE":
      return !!key && !!row.serviceTypeId && row.serviceTypeId === key;
    case "CATEGORY":
      return !!key && !!row.category && row.category === key;
    case "ALL":
      return true; // 全店：所有 BASE 行都算
    default:
      return false;
  }
}

/**
 * 该窗口内、该技师、该作用域下的合格台账行，**确定性排序**（earnedAt 升序、id 升序）。
 * 只统计 kind=BASE：PENDING/LEGACY 是 0 元痕迹，ADJUSTMENT/REVERSAL 是事后修正，
 * 都不代表"卖出去了一件"。
 */
export function qualifyingRows(
  rows: readonly LedgerUnitLike[],
  tierSet: TierSetLike,
  userId: string,
  windowKey: string,
): LedgerUnitLike[] {
  return rows
    .filter(
      (r) =>
        r.kind === "BASE" &&
        r.userId === userId &&
        r.windowKey === windowKey &&
        rowMatchesScope(r, tierSet),
    )
    .sort((a, b) => {
      const byTime = a.earnedAt.getTime() - b.earnedAt.getTime();
      if (byTime !== 0) return byTime;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/** 件数：ITEM_QTY = qty 之和（默认）；LINE_COUNT = 行数。 */
export function countUnits(rows: readonly LedgerUnitLike[], tierSet: TierSetLike): number {
  if (tierSet.countUnit === "LINE_COUNT") return rows.length;
  return rows.reduce((s, r) => s + Math.max(0, r.qty), 0);
}

export interface TierAchievement {
  tier: TierLike;
  /** 跨过这一档的那一条台账行（"第 10 件归谁"的答案） */
  triggerRowId: string | null;
  /** 触发时刻（按确定性排序后的累计时点） */
  earnedAt: Date | null;
  /** 触发时的件数快照 */
  atUnits: number;
}

export interface TierProgress {
  units: number;
  achievements: TierAchievement[];
  nextTier: TierLike | null;
  /** 距下一档还差多少件 */
  remaining: number;
  /** 0-100，用于进度条 */
  progressPct: number;
}

/**
 * 评估一个组合在某窗口的达成情况。
 * 累计件数按确定性顺序推进，**跨过门槛的那一条行**即该档的触发者 —— 于是"第 10 件归谁"永远有唯一答案。
 */
export function evaluateTierSet(
  rows: readonly LedgerUnitLike[],
  tierSet: TierSetLike,
  tiers: readonly TierLike[],
  userId: string,
  windowKey: string,
): TierProgress {
  const qualifying = qualifyingRows(rows, tierSet, userId, windowKey);
  const units = countUnits(qualifying, tierSet);
  const sortedTiers = [...tiers].filter((t) => t.tierSetId === tierSet.id).sort((a, b) => a.thresholdQty - b.thresholdQty);

  const achievements: TierAchievement[] = [];
  for (const tier of sortedTiers) {
    let running = 0;
    let triggerRowId: string | null = null;
    let earnedAt: Date | null = null;
    for (const row of qualifying) {
      running += tierSet.countUnit === "LINE_COUNT" ? 1 : Math.max(0, row.qty);
      if (running >= tier.thresholdQty) {
        triggerRowId = row.id;
        earnedAt = row.earnedAt;
        break;
      }
    }
    if (triggerRowId) achievements.push({ tier, triggerRowId, earnedAt, atUnits: tier.thresholdQty });
  }

  const nextTier = sortedTiers.find((t) => units < t.thresholdQty) ?? null;
  return {
    units,
    achievements,
    nextTier,
    remaining: nextTier ? nextTier.thresholdQty - units : 0,
    progressPct: nextTier ? Math.min(100, Math.round((units / nextTier.thresholdQty) * 100)) : 100,
  };
}

/**
 * 奖励金额（sen）。rewardValue 的含义随 rewardKind 变化 —— 这正是要在界面上写清人话示例的原因。
 *  · ONE_OFF_FIXED：一次性 RM X（rewardValue = sen）
 *  · EXTRA_PER_UNIT_FIXED：每件额外 +RM X（rewardValue = sen/件）；
 *    retroactive=true → 窗口内**全部**合格件都算；false → 只算跨过门槛之后的件数
 *  · FREE_UNIT_COMMISSION：等价"送 N 件的佣金"（rewardValue = 件数）× 该窗口的**平均单件佣金**
 */
export function rewardAmount(
  tierSet: TierSetLike,
  tier: TierLike,
  ctx: { units: number; avgUnitCommissionSen: number },
): number {
  switch (tierSet.rewardKind) {
    case "ONE_OFF_FIXED":
      return Math.max(0, Math.round(tier.rewardValue));
    case "EXTRA_PER_UNIT_FIXED": {
      const counted = tierSet.retroactive ? ctx.units : Math.max(0, ctx.units - tier.thresholdQty);
      return Math.max(0, Math.round(tier.rewardValue)) * counted;
    }
    case "FREE_UNIT_COMMISSION":
      return Math.max(0, Math.round(tier.rewardValue)) * Math.max(0, Math.round(ctx.avgUnitCommissionSen));
    default:
      return 0;
  }
}

/** 窗口内某组合的平均单件佣金（FREE_UNIT_COMMISSION 要用；没有合格行时为 0）。 */
export function avgUnitCommission(rows: readonly LedgerUnitLike[]): number {
  const units = rows.reduce((s, r) => s + Math.max(0, r.qty), 0);
  if (units === 0) return 0;
  const total = rows.reduce((s, r) => s + r.amountSen, 0);
  return Math.round(total / units);
}

export interface ClaimableTier {
  tierSet: TierSetLike;
  tier: TierLike;
  progress: TierProgress;
  amountSen: number;
  /** "你是窗口内第 10 件" —— 争议时靠它解释 */
  triggerRowId: string | null;
}

/**
 * 可领取清单：**状态是推导出来的，不是存出来的**。
 * 达标（件数 ≥ 门槛）且 claims 里没有 (user, tier, window) → 可领取。
 * 这样"已经领过"由唯一键保证，不存在"状态字段忘了改"。
 */
export function claimableTiers(args: {
  rows: readonly LedgerUnitLike[];
  tierSets: readonly TierSetLike[];
  tiers: readonly TierLike[];
  claimedTierIds: readonly string[];
  userId: string;
  windowKey: string;
}): ClaimableTier[] {
  const out: ClaimableTier[] = [];
  for (const tierSet of args.tierSets) {
    if (tierSet.windowKind !== "MONTH") continue;
    if (!tierSetApplies(tierSet, args.windowKey)) continue;
    const progress = evaluateTierSet(args.rows, tierSet, args.tiers, args.userId, args.windowKey);
    const qualifying = qualifyingRows(args.rows, tierSet, args.userId, args.windowKey);
    const avg = avgUnitCommission(qualifying);
    for (const a of progress.achievements) {
      if (args.claimedTierIds.includes(a.tier.id)) continue;
      out.push({
        tierSet,
        tier: a.tier,
        progress,
        amountSen: rewardAmount(tierSet, a.tier, { units: progress.units, avgUnitCommissionSen: avg }),
        triggerRowId: a.triggerRowId,
      });
    }
  }
  return out;
}
