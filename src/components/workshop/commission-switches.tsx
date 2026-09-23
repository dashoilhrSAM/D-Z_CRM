"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";
import { setCommissionSwitch } from "@/actions/commission";

// 两个业务开关：零件是否计佣 / 佣金按原价还是实付。
//
// 设计意图：**钱怎么算是业务决定，不是代码常量**。所以它们必须出现在这张配置页上，
// 而不是只躺在数据库字段里等人来问你（commissionOnGross 从 P2 起就是这样被埋了一个多月）。

export interface CommissionSwitchState {
  onParts: boolean;
  onGross: boolean;
}

export function CommissionSwitches({ initial }: { initial: CommissionSwitchState }) {
  const lang = useLang();
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [pending, start] = useTransition();

  const flip = (key: "PARTS" | "GROSS", active: boolean) =>
    start(async () => {
      const res = await setCommissionSwitch({ key, active });
      if (res.ok) {
        setState((s) => (key === "PARTS" ? { ...s, onParts: active } : { ...s, onGross: active }));
        toast.success(t("sw.saved", lang));
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-2">
      <div className="font-semibold">{t("sw.title", lang)}</div>
      <SwitchRow label={t("sw.parts", lang)} hint={t("sw.parts-hint", lang)} on={state.onParts} disabled={pending} onToggle={(v) => flip("PARTS", v)} />
      <SwitchRow label={t("sw.gross", lang)} hint={t("sw.gross-hint", lang)} on={state.onGross} disabled={pending} onToggle={(v) => flip("GROSS", v)} />
    </div>
  );
}

/**
 * 一行开关。**刻意放在组件外面**：在组件内定义子组件会让每次渲染都产生新的组件类型，
 * React 会把整棵子树卸载重建（本项目的 eslint 规则 react-hooks/static-components 也会拦下）。
 */
function SwitchRow(props: { label: string; hint: string; on: boolean; disabled: boolean; onToggle: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 rounded-xl border bg-background/40 p-3">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={props.on}
        disabled={props.disabled}
        onChange={(e) => props.onToggle(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium">{props.label}</span>
        <span className="block text-[11px] text-muted-foreground">{props.hint}</span>
      </span>
    </label>
  );
}
