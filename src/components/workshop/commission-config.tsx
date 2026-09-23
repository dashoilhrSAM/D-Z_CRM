"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useLang } from "@/components/shared/language-context";
import { t, type Lang } from "@/lib/i18n";
import { upsertCommissionRule, setCommissionRuleActive, simulateCommission, type CommissionConfigItem, type CommissionRuleRow } from "@/actions/commission";

// 佣金配置界面（P1）——**只管"逐项设置"**：试算器与奖励目标由页面分别摆放（页面负责顺序与分组）。
//
// 两个刻意的设计：
//  ① **没配的排前面**（默认开启）：这一页的价值是「哪些还没配」，不是「看看我配了多少」。
//     没配的项目会继承上层规则，页面上直接写明继承自哪一层 —— 否则老板会以为它是 0。
//  ② 模拟器与解析器共用同一份逻辑（都走 resolveCommissionRule），所以"页面上算出来的"和
//     "将来计提时算出来的"不可能不一致。

const SCOPES = ["PRODUCT", "SERVICE", "PACKAGE", "CATEGORY", "DEFAULT"] as const;
type Scope = (typeof SCOPES)[number];

const SCOPE_LABEL: Record<string, string> = {
  PRODUCT: "SKU",
  SERVICE: "Service",
  PACKAGE: "Package",
  CATEGORY: "Category",
  DEFAULT: "Default",
};

function ruleText(r: CommissionRuleRow): string {
  const pct = (v: number) => (v / 100).toFixed(2).replace(/\.00$/, "") + "%";
  const rm = (v: number) => "RM " + (v / 100).toFixed(2);
  if (r.basis === "FIXED") return rm(r.value) + "/unit";
  if (r.basis === "COMBO") return pct(r.valuePercent ?? 0) + " + " + rm(r.valueFixedSen ?? 0) + "/unit";
  return pct(r.value);
}

const rmSen = (sen: number) => (sen / 100).toFixed(2);

export function CommissionConfigView({
  items,
  rules,
  conflicts,
  canEdit,
}: {
  items: CommissionConfigItem[];
  rules: CommissionRuleRow[];
  conflicts: { scope: string; targetKey: string | null; ids: string[] }[];
  canEdit: boolean;
}) {
  const lang = useLang();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [unconfiguredFirst, setUnconfiguredFirst] = useState(true);

  const filterSort = (scope: Scope) =>
    items
      .filter((i) => i.scope === scope)
      .filter((i) => (q ? (i.name + " " + i.meta).toLowerCase().includes(q.toLowerCase()) : true))
      .sort((a, b) => {
        if (unconfiguredFirst) {
          const au = a.rule ? 1 : 0;
          const bu = b.rule ? 1 : 0;
          if (au !== bu) return au - bu;
        }
        return a.name.localeCompare(b.name);
      });

  const counts = useMemo(() => {
    const byScope = (s: Scope) => {
      const list = items.filter((i) => i.scope === s);
      return { total: list.length, missing: list.filter((i) => !i.rule).length };
    };
    return { PRODUCT: byScope("PRODUCT"), SERVICE: byScope("SERVICE"), PACKAGE: byScope("PACKAGE"), CATEGORY: byScope("CATEGORY"), DEFAULT: byScope("DEFAULT") };
  }, [items]);

  return (
    <div className="space-y-4">
      {conflicts.length > 0 && (
        <div className="rounded-2xl border border-amber-500/50 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-amber-700 font-medium">
            <AlertTriangle className="h-4 w-4" /> {t("comm.conflict-title", lang)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t("comm.conflict-desc", lang)}</p>
          <ul className="mt-2 space-y-1 text-xs font-mono">
            {conflicts.slice(0, 5).map((c, i) => (
              <li key={i}>
                {SCOPE_LABEL[c.scope] ?? c.scope} · {c.targetKey ?? "default"} → {c.ids.join(" / ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 全部规则（含已停用）：停用是"保留历史、不再生效"，所以必须能看见、也能重新启用 ——
          否则一次误停用就只能靠数据库改回来。 */}
      <details className="rounded-2xl border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          {t("comm.all-rules", lang)} ({rules.length})
        </summary>
        <div className="divide-y border-t">
          {rules.length === 0 && <div className="p-4 text-sm text-muted-foreground">{t("comm.empty", lang)}</div>}
          {rules.map((r) => {
            const target = items.find((i) => i.scope === r.scope && (i.scope === "DEFAULT" ? true : i.key === r.targetKey));
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <span className="w-24 text-xs text-muted-foreground">{SCOPE_LABEL[r.scope] ?? r.scope}</span>
                <span className="flex-1 min-w-[140px]">{target?.name ?? r.targetKey ?? "default"}</span>
                <span className="font-medium">{ruleText(r)}</span>
                <span className="text-xs text-muted-foreground">
                  {r.effectiveFrom.slice(0, 10)} → {r.effectiveTo ? r.effectiveTo.slice(0, 10) : "…"}
                </span>
                {!r.active && <span className="text-xs text-amber-600">{t("comm.inactive", lang)}</span>}
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await setCommissionRuleActive(r.id, !r.active);
                        if (res.ok) toast.success(t("comm.saved", lang));
                        else toast.error(res.error);
                      })
                    }
                  >
                    {r.active ? t("comm.disable", lang) : t("comm.enable", lang)}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </details>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">{t("sec.peritem", lang)}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("sec.peritem-hint", lang)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("comm.search", lang)} className="pl-9" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={unconfiguredFirst} onChange={(e) => setUnconfiguredFirst(e.target.checked)} className="h-4 w-4" />
          {t("comm.unconfigured-first", lang)}
        </label>
      </div>

      <Tabs defaultValue="PRODUCT">
        <TabsList className="flex-wrap">
          {SCOPES.map((s) => (
            <TabsTrigger key={s} value={s}>
              {SCOPE_LABEL[s]} ({counts[s].total - counts[s].missing}/{counts[s].total})
            </TabsTrigger>
          ))}
        </TabsList>

        {SCOPES.map((s) => (
          <TabsContent key={s} value={s} className="mt-3">
            <div className="rounded-2xl border bg-card divide-y">
              {filterSort(s).length === 0 && <div className="p-4 text-sm text-muted-foreground">{t("comm.empty", lang)}</div>}
              {filterSort(s).map((item) => (
                <Row key={item.scope + item.key} item={item} canEdit={canEdit} pending={pending} start={start} lang={lang} />
              ))}
            </div>
          </TabsContent>
        ))}
        </Tabs>
      </section>
    </div>
  );
}

function Row({
  item,
  canEdit,
  pending,
  start,
  lang,
}: {
  item: CommissionConfigItem;
  canEdit: boolean;
  pending: boolean;
  start: (cb: () => Promise<void>) => void;
  lang: Lang;
}) {
  const [open, setOpen] = useState(false);
  const [basis, setBasis] = useState(item.rule?.basis ?? "PERCENT");
  const [percent, setPercent] = useState(item.rule?.basis === "PERCENT" ? String((item.rule.value / 100).toString()) : "5");
  const [fixed, setFixed] = useState(item.rule?.basis === "FIXED" ? rmSen(item.rule.value) : "2");
  const [comboPct, setComboPct] = useState(item.rule?.basis === "COMBO" ? String(((item.rule.valuePercent ?? 0) / 100).toString()) : "5");
  const [comboFixed, setComboFixed] = useState(item.rule?.basis === "COMBO" ? rmSen(item.rule.valueFixedSen ?? 0) : "2");
  const [note, setNote] = useState(item.rule?.note ?? "");

  const save = () =>
    start(async () => {
      const base = {
        id: item.rule?.id,
        scope: item.scope,
        targetKey: item.scope === "DEFAULT" ? null : item.key,
        basis: basis as "PERCENT" | "FIXED" | "COMBO",
        note: note || null,
      };
      const payload =
        basis === "PERCENT"
          ? { ...base, value: Math.round(parseFloat(percent || "0") * 100) }
          : basis === "FIXED"
            ? { ...base, value: Math.round(parseFloat(fixed || "0") * 100) }
            : { ...base, valuePercent: Math.round(parseFloat(comboPct || "0") * 100), valueFixedSen: Math.round(parseFloat(comboFixed || "0") * 100) };
      const r = await upsertCommissionRule(payload);
      if (r.ok) {
        toast.success(t("comm.saved", lang));
        setOpen(false);
      } else {
        toast.error(r.error);
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
      <div className="flex-1 min-w-[180px]">
        <div className="text-sm font-medium">{item.name}</div>
        {item.meta && <div className="text-xs text-muted-foreground">{item.meta}</div>}
      </div>

      <div className="min-w-[160px] text-sm">
        {item.rule ? (
          <span className="inline-flex items-center gap-1 text-emerald-600">
            <Check className="h-3.5 w-3.5" /> {ruleText(item.rule)}
            {item.ambiguous && <span className="text-amber-600">(!)</span>}
          </span>
        ) : item.matchedBy && item.matchedBy !== item.scope ? (
          <span className="text-muted-foreground text-xs">
            {t("comm.inherits", lang)} {SCOPE_LABEL[item.matchedBy] ?? item.matchedBy}
          </span>
        ) : (
          <span className="text-xs text-amber-600">{t("comm.not-set", lang)}</span>
        )}
      </div>

      {canEdit && (
        <Dialog open={open} onOpenChange={setOpen}>
          {/* 这个 DialogTrigger 自带样式（asChild 不支持）——与 edit-job-form 的用法保持一致 */}
          <DialogTrigger className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted">
            <Pencil className="h-3.5 w-3.5" /> {item.rule ? t("comm.edit", lang) : t("comm.set", lang)}
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {SCOPE_LABEL[item.scope]} · {item.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>{t("comm.basis", lang)}</Label>
                <select
                  value={basis}
                  onChange={(e) => setBasis(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm"
                >
                  <option value="PERCENT">{t("comm.basis-percent", lang)}</option>
                  <option value="FIXED">{t("comm.basis-fixed", lang)}</option>
                  <option value="COMBO">{t("comm.basis-combo", lang)}</option>
                </select>
              </div>

              {basis === "PERCENT" && (
                <div>
                  <Label>{t("comm.percent", lang)}</Label>
                  <Input value={percent} onChange={(e) => setPercent(e.target.value)} className="mt-1.5" inputMode="decimal" />
                </div>
              )}
              {basis === "FIXED" && (
                <div>
                  <Label>{t("comm.fixed", lang)}</Label>
                  <Input value={fixed} onChange={(e) => setFixed(e.target.value)} className="mt-1.5" inputMode="decimal" />
                </div>
              )}
              {basis === "COMBO" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t("comm.percent", lang)}</Label>
                    <Input value={comboPct} onChange={(e) => setComboPct(e.target.value)} className="mt-1.5" inputMode="decimal" />
                  </div>
                  <div>
                    <Label>{t("comm.fixed", lang)}</Label>
                    <Input value={comboFixed} onChange={(e) => setComboFixed(e.target.value)} className="mt-1.5" inputMode="decimal" />
                  </div>
                </div>
              )}

              <div>
                <Label>{t("comm.note", lang)}</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1.5" />
              </div>

              {item.rule && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    start(async () => {
                      const r = await setCommissionRuleActive(item.rule!.id, false);
                      if (r.ok) toast.success(t("comm.saved", lang));
                      else toast.error(r.error);
                    })
                  }
                >
                  {t("comm.disable", lang)}
                </Button>
              )}
            </div>
            <DialogFooter>
              <Button onClick={save} disabled={pending}>
                {t("common.save", lang)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** 模拟器：拿一张「假设的工单明细」立刻看出每行佣金 —— 写规则之前先看结果，最省事故的一块。 */
/** 试算返回的一行（结构由服务端给出；界面只用不重算 —— 否则就是第二个实现，迟早与发薪漂移）。 */
interface SimLevel {
  scope: string;
  covers: boolean;
  ruleLabel: string | null;
  amountSen: number | null;
}
interface SimLine {
  baseSen: number;
  qty: number;
  matchedBy: string | null;
  ruleLabel: string | null;
  amountSen: number;
  basis: string | null;
  value: number | null;
  valuePercent: number | null;
  valueFixedSen: number | null;
  levels: SimLevel[];
  explanation: string;
}

const pctText = (v: number) => (v / 100).toFixed(2).replace(/\.00$/, "") + "%";

/** 把佣金算式写成人话：按比例、按件固定、或两者组合。 */
function formulaText(r: SimLine): string {
  const base = "RM " + rmSen(r.baseSen);
  if (r.basis === "FIXED") return "RM " + rmSen(r.value ?? 0) + " × " + r.qty + " = RM " + rmSen(r.amountSen);
  if (r.basis === "COMBO")
    return base + " × " + pctText(r.valuePercent ?? 0) + " + RM " + rmSen(r.valueFixedSen ?? 0) + " × " + r.qty + " = RM " + rmSen(r.amountSen);
  return base + " × " + pctText(r.value ?? 0) + " = RM " + rmSen(r.amountSen);
}

/**
 * 试算器。
 *
 * 老板的原话是「有点看不懂」。看不懂的通常不是那个数字，而是**这个数字怎么来的** ——
 * 所以这里给三样东西：算式、命中的是哪一层规则、以及五层各自的解析结果。
 * 上一层没配就往下找这件事，光看规则列表是看不出来的，必须画出来。
 */
export function Simulator({ items }: { items: CommissionConfigItem[] }) {
  const lang = useLang();
  const [pending, start] = useTransition();
  const [pick, setPick] = useState("");
  const [amount, setAmount] = useState("100");
  const [qty, setQty] = useState("1");
  const [result, setResult] = useState<SimLine | null>(null);

  const options = items.filter((i) => i.scope !== "DEFAULT" && i.scope !== "CATEGORY");

  const run = () =>
    start(async () => {
      const item = options.find((o) => o.scope + ":" + o.key === pick);
      if (!item) return;
      const line =
        item.scope === "PRODUCT"
          ? { productId: item.key }
          : item.scope === "SERVICE"
            ? { serviceTypeId: item.key }
            : { packageId: item.key };
      const r = await simulateCommission([{ ...line, baseSen: Math.round(parseFloat(amount || "0") * 100), qty: Math.max(1, parseInt(qty || "1", 10)) }]);
      if (r.ok && r.lines[0]) setResult(r.lines[0]);
      else if (!r.ok) toast.error(r.error);
    });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <Label className="text-xs">{t("comm.sim-pick", lang)}</Label>
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm"
          >
            <option value="">{t("comm.sim-pick", lang)}</option>
            {options.map((o) => (
              <option key={o.scope + ":" + o.key} value={o.scope + ":" + o.key}>
                {SCOPE_LABEL[o.scope]} · {o.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs">{t("comm.sim-amount", lang)}</Label>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1.5" inputMode="decimal" />
        </div>
        <div>
          <Label className="text-xs">{t("comm.sim-qty", lang)}</Label>
          <Input value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1.5" inputMode="numeric" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={run} disabled={pending || !pick}>
          {t("comm.sim-run", lang)}
        </Button>
        <span className="text-xs text-muted-foreground">{t("sim.no-write", lang)}</span>
      </div>

      {result && (
        <div className="space-y-3 rounded-xl border bg-background/40 p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-bold text-emerald-600">RM {rmSen(result.amountSen)}</span>
            <span className="text-sm text-muted-foreground">{t("sim.verdict", lang)}</span>
          </div>

          {result.matchedBy ? (
            <dl className="grid gap-x-6 gap-y-1.5 text-sm md:grid-cols-2">
              <SimFact label={t("sim.rule", lang)} value={(SCOPE_LABEL[result.matchedBy] ?? result.matchedBy) + " · " + (result.ruleLabel ?? "")} />
              <SimFact label={t("sim.base", lang)} value={"RM " + rmSen(result.baseSen)} />
              <SimFact label={t("comm.sim-qty", lang)} value={String(result.qty)} />
              <SimFact label={t("sim.formula", lang)} value={formulaText(result)} />
            </dl>
          ) : (
            <p className="text-sm text-amber-700">{t("sim.no-rule", lang)}</p>
          )}

          <div>
            <div className="text-xs font-medium text-muted-foreground">{t("sim.levels", lang)}</div>
            <ul className="mt-1.5 divide-y rounded-lg border bg-card">
              {result.levels.map((l) => (
                <li
                  key={l.scope}
                  className={"flex items-center gap-3 px-3 py-1.5 " + (l.scope === result.matchedBy ? "bg-emerald-500/5" : "")}
                >
                  <span className="w-20 shrink-0 text-xs font-medium">{SCOPE_LABEL[l.scope] ?? l.scope}</span>
                  <span className="flex-1 text-xs text-muted-foreground">
                    {l.covers ? (l.ruleLabel ?? "") + " → RM " + rmSen(l.amountSen ?? 0) : t("sim.level-none", lang)}
                  </span>
                  {l.scope === result.matchedBy && (
                    <span className="text-xs font-medium text-emerald-700">{t("sim.level-used", lang)}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-muted-foreground">{t("sim.levels-hint", lang)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** 试算结果里的一行「标签 — 值」。**放在组件外**：组件内定义子组件会让它每次渲染都是新类型。 */
function SimFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
