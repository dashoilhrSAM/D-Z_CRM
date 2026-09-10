"use client";

import { useState } from "react";
import { Send, CheckCircle2 } from "lucide-react";
import { submitWebsiteEnquiry } from "@/actions/website";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";

export function EnquiryForm({ defaultModel, branches, campaignId }: { defaultModel?: string; branches: { id: string; label: string }[]; campaignId?: string | null }) {
  const lang = useLang();
  const [form, setForm] = useState({ name: "", phone: "", email: "", model: defaultModel ?? "", notes: "", branchId: "" });
  const [done, setDone] = useState<{ ok: boolean; leadNumber?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const inputCls = "w-full rounded-md border bg-background px-3 py-2 text-sm";
  const labelCls = "text-xs font-medium text-muted-foreground mb-1 block";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await submitWebsiteEnquiry({
      name: form.name, phone: form.phone, email: form.email || undefined, model: form.model || undefined,
      notes: form.notes || undefined, branchId: form.branchId || undefined,
      campaignId: campaignId || undefined,
    });
    setBusy(false);
    setDone(res);
  }

  if (done?.ok) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"><CheckCircle2 className="h-6 w-6" /></div>
        <h2 className="text-lg font-semibold mt-3">{t("form.enquiry_received", lang)}</h2>
        <p className="text-sm text-muted-foreground mt-1">{tpl("form.enquiry_ref", lang, { ref: done.leadNumber ?? "" })}</p>
        <p className="text-sm text-muted-foreground">{t("form.enquiry_followup", lang)}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border bg-card p-5 space-y-3">
      <h2 className="font-semibold">{t("form.enquiry_title", lang)}</h2>
      {done && !done.ok && <p className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">{done.error}</p>}
      <div>
        <label className={labelCls}>{t("common.name", lang)} *</label>
        <input className={inputCls} required value={form.name} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>{t("common.phone", lang)} *</label>
        <input className={inputCls} required value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="012-345 6789" />
      </div>
      <div>
        <label className={labelCls}>{t("common.email", lang)}</label>
        <input className={inputCls} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>{t("form.interested_model", lang)}</label>
        <input className={inputCls} value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="e.g. Yamaha Y16ZR" />
      </div>
      <div>
        <label className={labelCls}>{t("form.preferred_branch", lang)}</label>
        <select className={inputCls} value={form.branchId} onChange={(e) => set("branchId", e.target.value)}>
          <option value="">{t("form.main_branch", lang)}</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      </div>
      <div>
        <label className={labelCls}>{t("form.message", lang)}</label>
        <textarea className={inputCls} rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>
      <button type="submit" disabled={busy} className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-50">
        <Send className="h-4 w-4" /> {busy ? t("form.sending", lang) : t("form.send_enquiry", lang)}
      </button>
    </form>
  );
}
