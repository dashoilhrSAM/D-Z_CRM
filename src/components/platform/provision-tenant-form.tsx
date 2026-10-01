"use client";

import { useActionState } from "react";
import { createTenantAction } from "@/app/platform/actions";
import type { ProvisionTenantResult } from "@/modules/platform/service";

const inputCls = "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

/** 开通表单 + **一次性**回执（临时密码只在这里显示一次，不写进 URL、不进日志）。 */
export function ProvisionTenantForm() {
  const [state, formAction, pending] = useActionState<ProvisionTenantResult | null, FormData>(createTenantAction, null);

  if (state?.ok) return <OnboardingCard result={state} />;

  return (
    <form action={formAction} className="max-w-xl space-y-3">
      {state && !state.ok && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          [{state.code}] {state.error}
        </p>
      )}
      <div>
        <label className={labelCls} htmlFor="name">店名 *</label>
        <input id="name" name="name" required className={inputCls} placeholder="KL Bike Works" />
      </div>
      <div>
        <label className={labelCls} htmlFor="slug">slug *（门店链接 /t/&lt;slug&gt;，小写字母数字连字符，上线后不复用）</label>
        <input id="slug" name="slug" required pattern="[a-z0-9][a-z0-9-]{1,46}[a-z0-9]" className={inputCls} placeholder="kl-bike-works" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="ownerEmail">店主邮箱 *（同时是登录账号）</label>
          <input id="ownerEmail" name="ownerEmail" type="email" required className={inputCls} placeholder="owner@klbike.my" />
        </div>
        <div>
          <label className={labelCls} htmlFor="ownerName">店主姓名</label>
          <input id="ownerName" name="ownerName" className={inputCls} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="city">城市</label>
          <input id="city" name="city" className={inputCls} placeholder="Kuala Lumpur" />
        </div>
        <div>
          <label className={labelCls} htmlFor="phone">联系电话</label>
          <input id="phone" name="phone" className={inputCls} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="address">地址</label>
          <input id="address" name="address" className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="trialDays">试用天数（留空 = 直接 ACTIVE）</label>
          <input id="trialDays" name="trialDays" type="number" min={1} max={365} className={inputCls} placeholder="30" />
        </div>
      </div>
      <button type="submit" disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {pending ? "正在开通…" : "开通"}
      </button>
      <p className="text-xs text-muted-foreground">
        会同时建好：租户 + 唯一门店 + 店主账号 + 归属关系 + 默认配置（服务目录/线索来源与阶段/消息模板/预约时段/库位）。
      </p>
    </form>
  );
}

function OnboardingCard({ result }: { result: Extract<ProvisionTenantResult, { ok: true }> }) {
  const rows: Array<[string, string]> = [
    ["店名", `${result.slug}`],
    ["状态", result.status],
    ["店主", result.ownerEmail + (result.reusedAuthAccount ? "（复用了已有账号，密码不变）" : "")],
    ["开通链接", result.entryUrl],
  ];
  if (result.workshopQrUrl) rows.push(["门店码", result.workshopQrUrl]);
  rows.push([
    "默认配置",
    `服务 ${result.counts.serviceTypes} · 来源 ${result.counts.leadSources} · 阶段 ${result.counts.leadStages} · 模板 ${result.counts.messageTemplates} · 时段 ${result.counts.slots}`,
  ]);

  return (
    <div className="max-w-xl space-y-3 rounded-lg border p-4">
      <h2 className="text-sm font-semibold text-emerald-600">✅ 开店成功</h2>
      <dl className="space-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">{k}</dt>
            <dd className="break-all font-mono text-xs">{v}</dd>
          </div>
        ))}
      </dl>
      {result.tempPassword && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <p className="text-xs font-medium text-amber-700">临时密码（**只显示这一次**，请立刻转发给店主并让他登录后修改）</p>
          <p className="mt-1 font-mono text-sm">{result.tempPassword}</p>
        </div>
      )}
      {result.warnings.map((w) => (
        <p key={w} className="text-xs text-amber-600">⚠️ {w}</p>
      ))}
      <a href="/platform" className="inline-block rounded-md border px-3 py-1.5 text-sm">回到租户列表</a>
    </div>
  );
}
