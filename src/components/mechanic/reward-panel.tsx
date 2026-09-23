"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Gift, Sparkles, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";
import { formatRM } from "@/lib/money";
import { claimTier } from "@/actions/commission-claims";

// 技师的阶梯奖励面板（P3）。
//
// 设计稿 §3.4 要求这一屏展示四件事，缺一件技师都会来问人：
//  ① **我适用的组合**（含作用域：单个商品 / 某个服务 / 一个分类 / 全店）+ 它配套的基础规则
//     —— 只看"阶梯"看不懂自己在赚什么，必须和"这单本来拿多少"放在一起；
//  ② **进度**：本窗口 7 / 10 件、"再 3 件触发"。没有进度条，技师就不知道值不值得冲；
//  ③ **可领取**：卡片 + 领取按钮，点完立刻变成"已领取，将随本月结算发放"（不能让按钮点了没反应）；
//  ④ **历史**：往期已领（与工资明细同源）。
//
// 面板数据里的日期在服务端已转成字符串（跨 RSC 边界传 Date 容易踩时区/序列化的坑，
// 而这一屏显示的是"哪一期"，不是精确时刻）。

export interface RewardPanelData {
  windowKey: string;
  claimableTotalSen: number;
  sets: {
    tierSetId: string;
    tierSetName: string;
    scope: string;
    targetName: string;
    rewardKind: string;
    units: number;
    progressPct: number;
    remaining: number;
    nextTier: { thresholdQty: number } | null;
    baseRuleLabel: string | null;
    tiers: { tierId: string; thresholdQty: number; amountSen: number; claimed: boolean; claimable: boolean }[];
  }[];
  history: { id: string; tierSetName: string; windowKey: string; claimedQty: number; amountSen: number; claimedAt: string }[];
}

const REWARD_KEY: Record<string, string> = {
  ONE_OFF_FIXED: "reward.kind-one-off",
  EXTRA_PER_UNIT_FIXED: "reward.kind-per-unit",
  FREE_UNIT_COMMISSION: "reward.kind-free-units",
};

const SCOPE_KEY: Record<string, string> = {
  ALL: "reward.scope-all",
  PRODUCT: "reward.scope-product",
  SERVICE: "reward.scope-service",
  CATEGORY: "reward.scope-category",
};

export function RewardPanel({ panel }: { panel: RewardPanelData }) {
  const lang = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [justClaimed, setJustClaimed] = useState<string[]>([]);

  const claim = (tierSetId: string, tierId: string) =>
    start(async () => {
      const res = await claimTier({ tierSetId, tierId });
      if (res.ok) {
        setJustClaimed((prev) => [...prev, tierId]);
        toast.success(tpl("reward.claim-toast", lang, { amount: formatRM(res.amountSen ?? 0) }));
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });

  if (panel.sets.length === 0 && panel.history.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 font-semibold">
          <Gift className="h-4 w-4 text-cyan" /> {t("reward.title", lang)}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{t("reward.none", lang)}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold">
          <Gift className="h-4 w-4 text-cyan" /> {t("reward.title", lang)}
          <span className="text-xs font-normal text-muted-foreground">{tpl("reward.window", lang, { window: panel.windowKey })}</span>
        </div>
        {panel.claimableTotalSen > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600">
            <Sparkles className="h-3.5 w-3.5" /> {tpl("reward.claimable", lang, { amount: formatRM(panel.claimableTotalSen) })}
          </span>
        )}
      </div>

      {panel.sets.map((set) => (
        <div key={set.tierSetId} className="rounded-xl border bg-background/40 p-3 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="text-sm font-medium">{set.tierSetName}</div>
              <div className="text-[11px] text-muted-foreground">
                {t(SCOPE_KEY[set.scope] ?? "reward.scope-all", lang)} · {set.targetName}
                {set.baseRuleLabel ? " · " + t("reward.base-rule", lang) + " " + set.baseRuleLabel : ""}
                {" · " + t(REWARD_KEY[set.rewardKind] ?? "reward.kind-one-off", lang)}
              </div>
            </div>
            <div className="text-sm font-semibold">
              {tpl("reward.units", lang, { units: set.units, threshold: set.nextTier?.thresholdQty ?? set.units })}
            </div>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-cyan transition-all" style={{ width: set.progressPct + "%" }} />
          </div>
          {set.nextTier && set.remaining > 0 && (
            <div className="text-[11px] text-muted-foreground">{tpl("reward.remaining", lang, { n: set.remaining })}</div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            {set.tiers.map((tier) => {
              const claimed = tier.claimed || justClaimed.includes(tier.tierId);
              return (
                <div key={tier.tierId} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Trophy className={"h-4 w-4 " + (claimed ? "text-emerald-600" : tier.claimable ? "text-amber-500" : "text-muted-foreground/50")} />
                    <span>{tpl("reward.tier", lang, { qty: tier.thresholdQty })}</span>
                    <span className="font-semibold">{formatRM(tier.amountSen)}</span>
                  </div>
                  {claimed ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                      <Check className="h-3.5 w-3.5" /> {t("reward.claimed", lang)}
                    </span>
                  ) : tier.claimable ? (
                    <Button size="sm" disabled={pending} onClick={() => claim(set.tierSetId, tier.tierId)}>
                      {t("reward.claim", lang)}
                    </Button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">{t("reward.not-yet", lang)}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-[11px] text-muted-foreground">{t("reward.auto-note", lang)}</p>

      <details className="rounded-xl border bg-background/40 p-3">
        <summary className="cursor-pointer text-sm font-medium">{t("reward.history", lang)}</summary>
        <div className="mt-2 space-y-1">
          {panel.history.length === 0 && <div className="text-xs text-muted-foreground">{t("reward.history-empty", lang)}</div>}
          {panel.history.map((h) => (
            <div key={h.id} className="flex items-center justify-between text-xs">
              <span>
                {h.tierSetName} · {h.windowKey} · {tpl("reward.units-short", lang, { n: h.claimedQty })}
              </span>
              <span className="font-medium">{formatRM(h.amountSen)}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
