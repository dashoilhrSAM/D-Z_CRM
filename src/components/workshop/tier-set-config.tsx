"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Gift, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";
import { formatRM } from "@/lib/money";
import { upsertCommissionTierSet, setCommissionTierSetActive, type TierSetRow, type UpsertTierSetInput } from "@/actions/commission-tiers";

// 阶梯组合的管理界面（P3 最后一块）。
//
// 设计稿 §3.1 的硬要求：rewardKind 三种**全部由 workshop 在界面上选**，
// 所以每一种都要写清**人话解释**与**一个算式示例** —— 否则老板选错形态只能靠自己猜，
// 而选错的后果是钱发错（这类错误通常几周后才被发现）。

export interface TierCatalogue {
  products: { id: string; name: string }[];
  serviceTypes: { id: string; name: string }[];
  categories: string[];
}

const KIND_KEY: Record<string, string> = {
  ONE_OFF_FIXED: "reward.kind-one-off",
  EXTRA_PER_UNIT_FIXED: "reward.kind-per-unit",
  FREE_UNIT_COMMISSION: "reward.kind-free-units",
};
const KIND_DESC: Record<string, string> = {
  ONE_OFF_FIXED: "tier.kind-desc-one-off",
  EXTRA_PER_UNIT_FIXED: "tier.kind-desc-per-unit",
  FREE_UNIT_COMMISSION: "tier.kind-desc-free-units",
};
const KIND_EXAMPLE: Record<string, string> = {
  ONE_OFF_FIXED: "tier.kind-example-one-off",
  EXTRA_PER_UNIT_FIXED: "tier.kind-example-per-unit",
  FREE_UNIT_COMMISSION: "tier.kind-example-free-units",
};
const SCOPE_KEY: Record<string, string> = {
  ALL: "reward.scope-all",
  PRODUCT: "reward.scope-product",
  SERVICE: "reward.scope-service",
  CATEGORY: "reward.scope-category",
};

type Draft = UpsertTierSetInput & { id?: string };

const emptyDraft = (): Draft => ({
  name: "",
  scope: "PRODUCT",
  targetId: null,
  countUnit: "ITEM_QTY",
  rewardKind: "ONE_OFF_FIXED",
  retroactive: true,
  effectiveFrom: null,
  tiers: [{ thresholdQty: 10, rewardValue: 5000 }],
});

export function TierSetConfig({ items, catalogue }: { items: TierSetRow[]; catalogue: TierCatalogue }) {
  const lang = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);

  const save = () =>
    start(async () => {
      if (!draft) return;
      const res = await upsertCommissionTierSet({
        id: draft.id, name: draft.name, scope: draft.scope, targetId: draft.targetId,
        countUnit: draft.countUnit, rewardKind: draft.rewardKind, retroactive: draft.retroactive,
        effectiveFrom: draft.effectiveFrom, tiers: draft.tiers,
      });
      if (res.ok) {
        toast.success(t("tier.saved", lang));
        setDraft(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });

  const toggle = (id: string, active: boolean) =>
    start(async () => {
      const res = await setCommissionTierSetActive(id, active);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });

  const targets =
    draft?.scope === "PRODUCT" ? catalogue.products
      : draft?.scope === "SERVICE" ? catalogue.serviceTypes
        : draft?.scope === "CATEGORY" ? catalogue.categories.map((c) => ({ id: c, name: c }))
          : [];

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <Gift className="h-4 w-4 text-cyan" /> {t("tier.title", lang)}
            <span className="text-xs font-normal text-muted-foreground">{t("tier.hint", lang)}</span>
          </div>
        </div>
        {!draft && (
          <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft())}>
            <Plus className="h-4 w-4" /> {t("tier.new", lang)}
          </Button>
        )}
      </div>

      {items.length === 0 && !draft && <p className="text-sm text-muted-foreground">{t("tier.none", lang)}</p>}

      <div className="space-y-2">
        {items.map((s) => (
          <div key={s.id} className="rounded-xl border bg-background/40 p-3 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">
                  {s.name}
                  {!s.active && <span className="ml-2 text-[11px] text-muted-foreground">({t("tier.inactive", lang)})</span>}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t(SCOPE_KEY[s.scope] ?? "reward.scope-all", lang)}
                  {s.targetName ? " · " + s.targetName : ""}
                  {" · " + t(KIND_KEY[s.rewardKind] ?? "reward.kind-one-off", lang)}
                  {" · " + t(s.countUnit === "LINE_COUNT" ? "tier.unit-LINE_COUNT" : "tier.unit-ITEM_QTY", lang)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {s.tiers.map((x) => (
                  <span key={x.id} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                    {tpl("tier.chip", lang, { qty: x.thresholdQty, amount: formatRM(x.rewardValue) })}
                  </span>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setDraft({ id: s.id, name: s.name, scope: s.scope as Draft["scope"], targetId: s.targetId, countUnit: s.countUnit, rewardKind: s.rewardKind as Draft["rewardKind"], retroactive: s.retroactive, effectiveFrom: null, tiers: s.tiers.map((x) => ({ thresholdQty: x.thresholdQty, rewardValue: x.rewardValue })) })}>
                  {t("tier.edit", lang)}
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggle(s.id, !s.active)}>
                  {s.active ? t("tier.disable", lang) : t("tier.enable", lang)}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {draft && (
        <div className="rounded-xl border border-cyan/40 bg-background/60 p-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">{t("tier.name", lang)}</span>
              <input className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm" value={draft.name} placeholder={t("tier.name-ph", lang)} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">{t("tier.scope", lang)}</span>
              <select className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm" value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value as Draft["scope"], targetId: null })}>
                {["ALL", "PRODUCT", "SERVICE", "CATEGORY"].map((s) => (
                  <option key={s} value={s}>{t(SCOPE_KEY[s], lang)}</option>
                ))}
              </select>
            </label>
            {draft.scope !== "ALL" && (
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">{t("tier.target", lang)}</span>
                <select className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm" value={draft.targetId ?? ""} onChange={(e) => setDraft({ ...draft, targetId: e.target.value || null })}>
                  <option value="">{t("tier.choose", lang)}</option>
                  {targets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            )}
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">{t("tier.count-unit", lang)}</span>
              <select className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm" value={draft.countUnit} onChange={(e) => setDraft({ ...draft, countUnit: e.target.value })}>
                <option value="ITEM_QTY">{t("tier.unit-ITEM_QTY", lang)}</option>
                <option value="LINE_COUNT">{t("tier.unit-LINE_COUNT", lang)}</option>
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">{t("tier.reward-kind", lang)}</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {["ONE_OFF_FIXED", "EXTRA_PER_UNIT_FIXED", "FREE_UNIT_COMMISSION"].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDraft({ ...draft, rewardKind: k as Draft["rewardKind"] })}
                  className={"rounded-xl border p-2.5 text-left text-xs transition " + (draft.rewardKind === k ? "border-cyan bg-cyan/5" : "hover:bg-muted/40")}
                >
                  <div className="font-medium">{t(KIND_KEY[k], lang)}</div>
                  <div className="mt-1 text-muted-foreground">{t(KIND_DESC[k], lang)}</div>
                  <div className="mt-1 text-[11px] text-cyan">{t(KIND_EXAMPLE[k], lang)}</div>
                </button>
              ))}
            </div>
            {draft.rewardKind === "EXTRA_PER_UNIT_FIXED" && (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={draft.retroactive} onChange={(e) => setDraft({ ...draft, retroactive: e.target.checked })} />
                <span>{t("tier.retroactive", lang)}</span>
                <span className="text-muted-foreground">{t("tier.retroactive-hint", lang)}</span>
              </label>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">{t("tier.tiers", lang)}</div>
            {draft.tiers.map((row, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                <input
                  type="number" min={1} className="w-24 rounded-lg border bg-background px-2 py-1.5"
                  value={row.thresholdQty}
                  onChange={(e) => setDraft({ ...draft, tiers: draft.tiers.map((x, j) => (j === i ? { ...x, thresholdQty: Number(e.target.value) } : x)) })}
                />
                <span>{t("tier.threshold", lang)}</span>
                <input
                  type="number" min={0} step="0.01" className="w-28 rounded-lg border bg-background px-2 py-1.5"
                  value={(row.rewardValue / 100).toString()}
                  onChange={(e) => setDraft({ ...draft, tiers: draft.tiers.map((x, j) => (j === i ? { ...x, rewardValue: Math.round(Number(e.target.value) * 100) } : x)) })}
                />
                <span>{t("tier.reward", lang)}</span>
                {draft.tiers.length > 1 && (
                  <button type="button" className="text-muted-foreground hover:text-red-500" onClick={() => setDraft({ ...draft, tiers: draft.tiers.filter((_, j) => j !== i) })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setDraft({ ...draft, tiers: [...draft.tiers, { thresholdQty: (draft.tiers.at(-1)?.thresholdQty ?? 0) + 10, rewardValue: draft.tiers.at(-1)?.rewardValue ?? 5000 }] })}>
              <Plus className="h-4 w-4" /> {t("tier.add-tier", lang)}
            </Button>
          </div>

          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">{t("tier.effective-from", lang)}</span>
            <input
              type="date"
              className="w-40 rounded-lg border bg-background px-2 py-1.5 text-sm"
              onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value ? e.target.value + "T00:00:00Z" : null })}
            />
          </label>

          <div className="flex items-center gap-2">
            <Button size="sm" disabled={pending} onClick={save}>{t("tier.save", lang)}</Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>{t("tier.cancel", lang)}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
