"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAutomationRule, toggleAutomation } from "@/actions/messaging";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";

const TRIGGERS = ["LEAD_CREATED", "LEAD_STAGE_CHANGED", "BOOKING_CREATED", "BOOKING_APPROACHING", "SERVICE_COMPLETED", "SERVICE_DUE", "JOB_READY", "CUSTOMER_INACTIVE", "LOYALTY_EVENT", "LOW_STOCK"];

export function AutomationManager({ templates }: { templates: { id: string; name: string }[] }) {
  const router = useRouter();
  const lang = useLang();
  const [f, setF] = useState({ name: "", trigger: "LEAD_CREATED", actionType: "CREATE_TASK", title: t("autom.follow-up", lang), dueInDays: "2", templateId: "" });
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
    if (f.actionType === "SEND_MESSAGE") action.templateId = f.templateId;
    await createAutomationRule({ name: f.name, trigger: f.trigger, actionsJson: JSON.stringify([action]) });
    setBusy(false);
    setF({ name: "", trigger: "LEAD_CREATED", actionType: "CREATE_TASK", title: t("autom.follow-up", lang), dueInDays: "2", templateId: "" });
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
          {TRIGGERS.map((tr) => <option key={tr} value={tr}>{t("autom.trigger." + tr, lang)}</option>)}
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
