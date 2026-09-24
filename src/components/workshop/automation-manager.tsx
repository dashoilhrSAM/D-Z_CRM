"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAutomationRule, toggleAutomation } from "@/actions/messaging";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";

const TRIGGERS = ["LEAD_CREATED", "LEAD_STAGE_CHANGED", "BOOKING_CREATED", "BOOKING_APPROACHING", "SERVICE_COMPLETED", "SERVICE_DUE", "JOB_READY", "CUSTOMER_INACTIVE", "LOYALTY_EVENT", "LOW_STOCK"];

/**
 * **还没有事件点的触发器** —— 选了也不会触发，所以标出来并禁选。
 *
 * 教训来自「自动化盘点」：原先 10 个触发器里有 6 个是死的（能选、能建、显示 Active、
 * 但日志永远空白）。现在另外 4 个已接事件点、3 个接了每日扫描，
 * 只剩这两个要等「积分事件」与「库存告警」两处加上调用才能真正工作。
 * 与其让人建一条永远不跑的规则，不如先禁掉。
 */
const UNAVAILABLE_TRIGGERS = ["LOYALTY_EVENT", "LOW_STOCK"];

export function AutomationManager({ templates }: { templates: { id: string; name: string }[] }) {
  const router = useRouter();
  const lang = useLang();
  const [f, setF] = useState({ name: "", trigger: "LEAD_CREATED", actionType: "CREATE_TASK", title: t("autom.follow-up", lang), dueInDays: "2", templateId: "", delayDays: "0" });
  const [busy, setBusy] = useState(false);
  const inputCls = "w-full rounded-md border bg-background px-3 py-1.5 text-sm";
  const labelCls = "text-[11px] font-medium text-muted-foreground mb-0.5 block";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const action: Record<string, unknown> = { type: f.actionType };
    if (f.actionType === "CREATE_TASK") {
      action.title = f.title || undefined;
      action.dueInDays = parseInt(f.dueInDays) || undefined;
    }
    if (f.actionType === "SEND_MESSAGE") {
      action.templateId = f.templateId;
      // 0 = 立刻发；大于 0 = 排队到 N 天后（由每日 cron 发出）
      const delay = parseInt(f.delayDays) || 0;
      if (delay > 0) action.delayDays = delay;
    }
    await createAutomationRule({ name: f.name, trigger: f.trigger, actionsJson: JSON.stringify([action]) });
    setBusy(false);
    setF({ name: "", trigger: "LEAD_CREATED", actionType: "CREATE_TASK", title: t("autom.follow-up", lang), dueInDays: "2", templateId: "", delayDays: "0" });
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="rounded-xl border bg-card p-4 grid sm:grid-cols-[1fr_180px_180px_1fr_90px_auto] gap-3 items-end">
      <div>
        <label className={labelCls}>{t("autom.rule-name", lang)}</label>
        <input className={inputCls} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("autom.rule-name-placeholder", lang)} />
      </div>
      <div>
        <label className={labelCls}>{t("autom.col-trigger", lang)}</label>
        <select className={inputCls} value={f.trigger} onChange={(e) => setF({ ...f, trigger: e.target.value })}>
          {TRIGGERS.map((tr) => {
            const off = UNAVAILABLE_TRIGGERS.includes(tr);
            return (
              <option key={tr} value={tr} disabled={off}>
                {t("autom.trigger." + tr, lang) + (off ? " — " + t("autom.trigger-unavailable", lang) : "")}
              </option>
            );
          })}
        </select>
      </div>
      <div>
        <label className={labelCls}>{t("autom.action", lang)}</label>
        <select className={inputCls} value={f.actionType} onChange={(e) => setF({ ...f, actionType: e.target.value })}>
          <option value="CREATE_TASK">{t("ws.task.create", lang)}</option><option value="ASSIGN_LEAD">{t("autom.action-assign-lead", lang)}</option>
          <option value="SEND_MESSAGE">{t("autom.action-send-message", lang)}</option><option value="SCHEDULE_REMINDER">{t("autom.action-schedule-reminder", lang)}</option>
          <option value="UPDATE_TAGS">{t("autom.action-update-tags", lang)}</option>
        </select>
      </div>
      {f.actionType === "SEND_MESSAGE" ? (
        <div>
          <label className={labelCls}>{t("autom.template", lang)}</label>
          <select className={inputCls} required value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })}>
            <option value="" disabled>{t("autom.template-placeholder", lang)}</option>
            {templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
          </select>
          {/* 延迟发送：0 立刻发；大于 0 先排队，由每日扫描发出 */}
          <label className={labelCls + " mt-2"}>{t("autom.delay-days", lang)}</label>
          <input
            className={inputCls} type="number" min="0" max="365"
            value={f.delayDays} onChange={(e) => setF({ ...f, delayDays: e.target.value })}
          />
        </div>
      ) : (
        <div>
          <label className={labelCls}>{t("autom.task-title", lang)}</label>
          <input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </div>
      )}
      <div>
        <label className={labelCls}>{t("autom.due-days", lang)}</label>
        <input className={inputCls} type="number" min="0" value={f.dueInDays} onChange={(e) => setF({ ...f, dueInDays: e.target.value })} />
      </div>
      <button type="submit" disabled={busy} className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50">{t("autom.create", lang)}</button>
    </form>
  );
}

export function ToggleRule({ ruleId, active }: { ruleId: string; active: boolean }) {
  const router = useRouter();
  const lang = useLang();
  return (
    <button
      className={"rounded-md border px-3 py-1 text-xs font-medium " + (active ? "text-destructive" : "text-primary")}
      onClick={async () => { await toggleAutomation(ruleId, !active); router.refresh(); }}
    >
      {active ? t("autom.pause", lang) : t("autom.enable", lang)}
    </button>
  );
}
