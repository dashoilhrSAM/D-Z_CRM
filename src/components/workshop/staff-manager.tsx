"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, UserPlus, Power, Pencil, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createStaff, toggleStaffActive, updateStaff, resetStaffPassword } from "@/actions/workshop";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";

export interface StaffRow { id: string; name: string; role: string; phone: string | null; email: string | null; active: boolean; jobCount: number; }

const ROLE_OPTIONS = [
  ["MECHANIC", "Mechanic"], ["COUNTER_STAFF", "Counter Staff"], ["MANAGER", "Manager"], ["SERVICE_ADVISOR", "Service Advisor"], ["INVENTORY", "Inventory"], ["MARKETING", "Marketing"],
] as const;

const ROLE_BADGE: Record<string, string> = {
  OWNER: "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300", SUPER_ADMIN: "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300",
  MANAGER: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300", COUNTER_STAFF: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300",
  SERVICE_ADVISOR: "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300", MECHANIC: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  INVENTORY: "bg-slate-100 text-slate-700 dark:bg-slate-950/60 dark:text-slate-300", MARKETING: "bg-fuchsia-100 text-fuchsia-700",
};

export function StaffManager({ staff, canManage }: { staff: StaffRow[]; canManage: boolean }) {
  const router = useRouter();
  const lang = useLang();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [add, setAdd] = useState({ name: "", role: "MECHANIC", phone: "", email: "", password: "" });
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [edit, setEdit] = useState({ name: "", role: "MECHANIC", phone: "", email: "", active: true });
  const [resetPw, setResetPw] = useState("");

  const submit = () => start(async () => {
    if (!add.name.trim()) { toast.error(t("toast.enter-staff-name", lang)); return; }
    const r = await createStaff({ name: add.name, role: add.role, phone: add.phone || undefined, email: add.email || undefined, password: add.password || undefined });
    if (r.authCreated) toast.success(tpl("toast.staff-login-created", lang, { email: r.authEmail ?? add.email }));
    else toast.success(t("toast.staff-added", lang));
    setAdd({ name: "", role: "MECHANIC", phone: "", email: "", password: "" }); setAdding(false);
    router.refresh();
  });

  const toggle = (id: string, active: boolean, name: string) => start(async () => {
    await toggleStaffActive(id); router.refresh();
    toast.success(active ? tpl("toast.staff-deactivated", lang, { name }) : tpl("toast.staff-activated", lang, { name }));
  });

  const openEdit = (s: StaffRow) => { setEditing(s); setEdit({ name: s.name, role: s.role, phone: s.phone ?? "", email: s.email ?? "", active: s.active }); setResetPw(""); };
  const saveEdit = () => start(async () => {
    if (!editing) return;
    try {
      await updateStaff(editing.id, { name: edit.name, role: edit.role, phone: edit.phone || undefined, email: edit.email || undefined, active: edit.active });
      toast.success(t("staff.saved", lang));
      if (resetPw) { await resetStaffPassword(editing.id, resetPw); toast.success(t("staff.pw-reset", lang)); }
      setEditing(null); router.refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("staff.subtitle", lang)}</p>
        {canManage && !adding && (<Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4 mr-1.5" /> {t("staff.add-staff", lang)}</Button>)}
      </div>

      {adding && (
        <div className="rounded-2xl border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2"><UserPlus className="h-4 w-4 text-primary" /><h3 className="font-semibold">{t("staff.add-member-title", lang)}</h3></div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div><Label>{t("common.name", lang)}</Label><Input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} className="mt-1.5" /></div>
            <div><Label>{t("staff.label-role", lang)}</Label>
              <Select value={add.role} onValueChange={(v) => setAdd({ ...add, role: v ?? "MECHANIC" })}><SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger><SelectContent>{ROLE_OPTIONS.map(([v]) => <SelectItem key={v} value={v}>{t("staff.role." + v, lang)}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label>{t("staff.label-phone-optional", lang)}</Label><Input value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} className="mt-1.5" /></div>
            <div><Label>{t("staff.label-email-optional", lang)}</Label><Input value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} className="mt-1.5" /></div>
            <div><Label>{t("staff.password", lang)} <span className="text-muted-foreground">({t("staff.optional", lang)})</span></Label><Input type="password" value={add.password} onChange={(e) => setAdd({ ...add, password: e.target.value })} className="mt-1.5" /></div>
          </div>
          <div className="flex gap-2"><Button variant="outline" onClick={() => setAdding(false)}>{t("common.cancel", lang)}</Button><Button disabled={pending || !add.name.trim()} onClick={submit}>{pending ? t("staff.adding", lang) : t("staff.add-staff", lang)}</Button></div>
        </div>
      )}

      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-4 py-3 font-medium">{t("common.name", lang)}</th><th className="px-4 py-3 font-medium">{t("staff.label-role", lang)}</th>
            <th className="px-4 py-3 font-medium">{t("lead.col-contact", lang)}</th><th className="px-4 py-3 font-medium">{t("ws.kpi.col-jobs", lang)}</th>
            <th className="px-4 py-3 font-medium">{t("common.status", lang)}</th><th className="px-4 py-3" />
          </tr></thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className={"border-b last:border-0 " + (s.active ? "" : "opacity-50")}>
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3"><span className={"rounded-full px-2 py-0.5 text-[11px] font-semibold " + (ROLE_BADGE[s.role] ?? "bg-slate-100 text-slate-600 dark:text-slate-300")}>{t("staff.role." + s.role, lang)}</span></td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{s.phone ?? "—"}{s.email ? " · " + s.email : ""}</td>
                <td className="px-4 py-3 tabular-nums">{s.jobCount}</td>
                <td className="px-4 py-3"><span className={"text-[11px] font-semibold " + (s.active ? "text-emerald-600 dark:text-emerald-300" : "text-slate-400")}>{s.active ? t("staff.status-active", lang) : t("staff.status-inactive", lang)}</span></td>
                <td className="px-4 py-3 text-right">
                  {s.role !== "OWNER" && s.role !== "SUPER_ADMIN" && (
                    <div className="inline-flex gap-1.5">
                      {canManage && <button onClick={() => openEdit(s)} disabled={pending} className="inline-flex h-7 w-7 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted disabled:opacity-40" title={t("staff.edit", lang)}><Pencil className="h-3.5 w-3.5" /></button>}
                      <button onClick={() => toggle(s.id, s.active, s.name)} disabled={pending} className="inline-flex h-7 w-7 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted disabled:opacity-40" title={s.active ? t("staff.title-deactivate", lang) : t("staff.title-activate", lang)}><Power className="h-3.5 w-3.5" /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("staff.edit", lang)} · {editing?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>{t("common.name", lang)}</Label><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="mt-1.5" /></div>
            <div><Label>{t("staff.label-role", lang)}</Label>
              <Select value={edit.role} onValueChange={(v) => setEdit({ ...edit, role: v ?? "MECHANIC" })}><SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger><SelectContent>{ROLE_OPTIONS.map(([v]) => <SelectItem key={v} value={v}>{t("staff.role." + v, lang)}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label>{t("staff.label-phone-optional", lang)}</Label><Input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} className="mt-1.5" /></div>
            <div><Label>{t("staff.label-email-optional", lang)}</Label><Input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} className="mt-1.5" /></div>
            <div className="flex items-center gap-2"><Label className="mb-0">{t("common.status", lang)}</Label>
              <button type="button" onClick={() => setEdit({ ...edit, active: !edit.active })} className={"rounded-lg border px-3 py-1.5 text-sm " + (edit.active ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>{edit.active ? t("staff.status-active", lang) : t("staff.status-inactive", lang)}</button>
            </div>
            <div><Label className="inline-flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> {t("staff.reset-pw", lang)}</Label><Input type="password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} placeholder={t("staff.pw-placeholder", lang)} className="mt-1.5" /></div>
            <div className="flex gap-2 pt-1"><Button variant="outline" onClick={() => setEditing(null)}>{t("common.cancel", lang)}</Button><Button disabled={pending} onClick={saveEdit}>{t("staff.save", lang)}</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
