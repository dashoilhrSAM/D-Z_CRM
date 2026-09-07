"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateOrganisation, updateBranch, createBranch, createServiceType, toggleServiceType, deleteServiceType } from "@/actions/settings";
import { formatRM } from "@/lib/money";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";

const inputCls = "w-full rounded-md border bg-background px-3 py-1.5 text-sm";
const labelCls = "text-[11px] font-medium text-muted-foreground mb-0.5 block";

export function OrgProfileForm({ org }: { org: { name: string; contactPhone: string | null; contactEmail: string | null; address: string | null; taxId: string | null; timezone: string; currency: string } }) {
  const router = useRouter();
  const lang = useLang();
  const [f, setF] = useState(org);
  const [msg, setMsg] = useState("");
  return (
    <div className="rounded-xl border bg-card p-4">
      <h2 className="font-semibold text-sm mb-3">{t("settings-form.org-title", lang)}</h2>
      <div className="grid grid-cols-2 gap-2">
        <div><label className={labelCls}>{t("ws.products.col.name", lang)}</label><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className={labelCls}>{t("common.phone", lang)}</label><input className={inputCls} value={f.contactPhone ?? ""} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></div>
        <div><label className={labelCls}>{t("common.email", lang)}</label><input className={inputCls} value={f.contactEmail ?? ""} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></div>
        <div><label className={labelCls}>{t("pdf.tax-id", lang)}</label><input className={inputCls} value={f.taxId ?? ""} onChange={(e) => setF({ ...f, taxId: e.target.value })} /></div>
        <div><label className={labelCls}>{t("settings-form.timezone", lang)}</label><input className={inputCls} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></div>
        <div><label className={labelCls}>{t("settings-form.currency", lang)}</label><input className={inputCls} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} /></div>
        <div className="col-span-2"><label className={labelCls}>{t("form.address", lang)}</label><input className={inputCls} value={f.address ?? ""} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
      </div>
      <button className="mt-3 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium" onClick={async () => { await updateOrganisation(f); setMsg(t("toast.saved", lang)); router.refresh(); }}>{t("common.save", lang)}</button>
      {msg && <span className="ml-2 text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}

export function LostReasonsEditor({ current }: { current: string }) {
  const router = useRouter();
  const lang = useLang();
  const [val, setVal] = useState((JSON.parse(current || "[]") as string[]).join("\n"));
  const [msg, setMsg] = useState("");
  return (
    <div className="rounded-xl border bg-card p-4">
      <h2 className="font-semibold text-sm mb-1">{t("settings-form.lost-title", lang)}</h2>
      <p className="text-[11px] text-muted-foreground mb-2">{t("settings-form.lost-hint", lang)}</p>
      <textarea className={inputCls + " h-32"} value={val} onChange={(e) => setVal(e.target.value)} />
      <button className="mt-2 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium" onClick={async () => {
        const reasons = val.split("\n").map((s) => s.trim()).filter(Boolean);
        await updateOrganisation({ lostReasons: JSON.stringify(reasons) });
        setMsg(tpl("settings-form.saved-reasons", lang, { n: reasons.length })); router.refresh();
      }}>{t("common.save", lang)}</button>
      {msg && <span className="ml-2 text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}

export function BranchManager({ branches }: { branches: { id: string; name: string; city: string; phone: string | null; address: string | null; isMain: boolean; operatingHours: string | null }[] }) {
  const router = useRouter();
  const lang = useLang();
  const [nf, setNf] = useState({ name: "D&Z Smart Workshop", city: "", phone: "", address: "" });
  return (
    <div className="rounded-xl border bg-card p-4">
      <h2 className="font-semibold text-sm mb-3">{t("settings-form.branches-title", lang)}</h2>
      <div className="space-y-2">
        {branches.map((b) => (
          <div key={b.id} className="flex items-center gap-2 text-sm">
            <span className="font-medium">{b.name} · {b.city}</span>
            {b.isMain && <span className="rounded-full bg-primary/10 text-primary text-[10px] px-2 py-0.5">{t("settings-form.main", lang)}</span>}
            <span className="text-xs text-muted-foreground">{b.phone}</span>
            <div className="flex-1" />
            <span className="text-[11px] text-muted-foreground">{t(b.operatingHours ? "settings-form.hours-set" : "settings-form.no-hours", lang)}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 border-t pt-3">
        <input className={inputCls} placeholder={t("settings-form.city", lang)} value={nf.city} onChange={(e) => setNf({ ...nf, city: e.target.value })} />
        <input className={inputCls} placeholder={t("common.phone", lang)} value={nf.phone} onChange={(e) => setNf({ ...nf, phone: e.target.value })} />
        <input className={inputCls + " col-span-2"} placeholder={t("form.address", lang)} value={nf.address} onChange={(e) => setNf({ ...nf, address: e.target.value })} />
        <button className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium col-span-4" disabled={!nf.city} onClick={async () => { await createBranch(nf); setNf({ name: "D&Z Smart Workshop", city: "", phone: "", address: "" }); router.refresh(); }}>
          {t("settings-form.add-branch", lang)}
        </button>
      </div>
    </div>
  );
}

export function ServiceTypeManager({ serviceTypes }: { serviceTypes: { id: string; name: string; category: string | null; durationMin: number | null; priceSen: number | null; active: boolean }[] }) {
  const router = useRouter();
  const lang = useLang();
  const [nf, setNf] = useState({ name: "", category: "MAINTENANCE", durationMin: "60", price: "" });
  const activeCount = serviceTypes.filter((s) => s.active).length;
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-sm">{t("settings-form.catalogue-title", lang)}</h2>
        <span className="text-[11px] text-muted-foreground">{tpl("settings-form.active-count", lang, { n: activeCount })} · {tpl("settings-form.total-count", lang, { n: serviceTypes.length })}</span>
      </div>

      {/* 添加服务 */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input className={inputCls + " flex-1 min-w-[120px]"} placeholder={t("settings-form.service-name", lang)} value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} />
        <select className={inputCls + " w-36"} value={nf.category} onChange={(e) => setNf({ ...nf, category: e.target.value })}>
          <option value="MAINTENANCE">MAINTENANCE</option><option value="REPAIR">REPAIR</option><option value="DIAGNOSTIC">DIAGNOSTIC</option><option value="DETAILING">DETAILING</option>
        </select>
        <input className={inputCls + " w-20"} type="number" placeholder={t("settings-form.min", lang)} value={nf.durationMin} onChange={(e) => setNf({ ...nf, durationMin: e.target.value })} />
        <input className={inputCls + " w-28"} type="number" placeholder={t("settings-form.price", lang)} value={nf.price} onChange={(e) => setNf({ ...nf, price: e.target.value })} />
        <button className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium" disabled={!nf.name} onClick={async () => {
          await createServiceType({ name: nf.name, category: nf.category, durationMin: parseInt(nf.durationMin) || undefined, priceSen: nf.price ? Math.round(parseFloat(nf.price) * 100) : undefined });
          setNf({ name: "", category: "MAINTENANCE", durationMin: "60", price: "" });
          router.refresh();
        }}>{t("common.add", lang)}</button>
      </div>

      {/* 服务列表：每行 名称/分类/时长/价格/状态 + 开关 + 删除 */}
      <div className="border rounded-lg divide-y divide-border">
        {serviceTypes.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("settings-form.no-services", lang)}</p>}
        {serviceTypes.map((s) => (
          <div key={s.id} className={"flex items-center gap-3 px-3 py-2 " + (s.active ? "" : "opacity-55 bg-muted/30")}>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{s.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {s.category ?? "—"}{s.durationMin ? " · " + s.durationMin + " " + t("settings-form.min", lang) : ""}{s.priceSen != null ? " · " + formatRM(s.priceSen) : ""}
              </div>
            </div>
            <span className={"rounded-full px-2 py-0.5 text-[10px] font-semibold " + (s.active ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground")}>
              {t(s.active ? "common.active" : "ws.pkg.inactive", lang)}
            </span>
            <button
              className={"relative h-5 w-9 rounded-full transition-colors " + (s.active ? "bg-primary" : "bg-muted")}
              aria-label={tpl("settings-form.toggle-label", lang, { name: s.name })}
              onClick={async () => { await toggleServiceType(s.id, !s.active); router.refresh(); }}
            >
              <span className={"absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all " + (s.active ? "left-[18px]" : "left-0.5")} />
            </button>
            <button aria-label={tpl("settings-form.delete-label", lang, { name: s.name })} className="text-muted-foreground hover:text-destructive" onClick={async () => { if (confirm(tpl("settings-form.delete-confirm", lang, { name: s.name }))) { await deleteServiceType(s.id); router.refresh(); } }}>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z" /></svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- My Branch Settings (branch 级 manager 只编辑自己分行) ----------
const DAYS: [string, string][] = [["mon","Mon"],["tue","Tue"],["wed","Wed"],["thu","Thu"],["fri","Fri"],["sat","Sat"],["sun","Sun"]];
type DayHours = { open: string; close: string; closed: boolean };
function parseHours(s: string | null): Record<string, DayHours> {
  let raw: Record<string, string> = {};
  try { raw = s ? JSON.parse(s) : {}; } catch { raw = {}; }
  const out: Record<string, DayHours> = {};
  for (const [k] of DAYS) {
    const v = raw[k];
    if (typeof v === "string" && v.includes("-")) {
      const [open, close] = v.split("-");
      out[k] = { open: open ?? "", close: close ?? "", closed: false };
    } else out[k] = { open: "", close: "", closed: true };
  }
  return out;
}
function serializeHours(h: Record<string, DayHours>): string {
  const o: Record<string, string> = {};
  for (const [k] of DAYS) {
    const d = h[k];
    o[k] = d && !d.closed && d.open && d.close ? `${d.open}-${d.close}` : "";
  }
  return JSON.stringify(o);
}

export function MyBranchSettings({ branch }: { branch: { id: string; name: string; city: string; phone: string | null; address: string | null; operatingHours: string | null; appointmentCapacity: number | null } }) {
  const router = useRouter();
  const lang = useLang();
  const [phone, setPhone] = useState(branch.phone ?? "");
  const [address, setAddress] = useState(branch.address ?? "");
  const [capacity, setCapacity] = useState(String(branch.appointmentCapacity ?? ""));
  const [hours, setHours] = useState<Record<string, DayHours>>(parseHours(branch.operatingHours));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setMsg("");
    const res = await updateBranch(branch.id, { phone, address, operatingHours: serializeHours(hours), appointmentCapacity: Number(capacity) || 0 });
    setBusy(false);
    setMsg(res.ok ? t("settings-form.no-saved", lang) : (res.error ?? "Failed"));
    if (res.ok) router.refresh();
  }
  return (
    <div className="rounded-xl border bg-card p-4">
      <h2 className="font-semibold text-sm">{t("settings-form.no-my-branch", lang)}</h2>
      <p className="text-xs text-muted-foreground mb-3">{branch.name} · {branch.city}</p>
      <div className="grid grid-cols-2 gap-2">
        <div><label className={labelCls}>{t("common.phone", lang)}</label><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03-1234 5678" /></div>
        <div><label className={labelCls}>{t("settings-form.no-capacity", lang)}</label><input className={inputCls} type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
        <div className="col-span-2"><label className={labelCls}>{t("form.address", lang)}</label><input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} /></div>
      </div>
      <div className="mt-3">
        <h3 className="text-xs font-semibold text-muted-foreground mb-1.5">{t("settings-form.no-hours-label", lang)}</h3>
        <div className="space-y-1.5">
          {DAYS.map(([k]) => (
            <div key={k} className="flex items-center gap-2 text-sm">
              <span className="w-9 text-muted-foreground">{t("day." + k, lang)}</span>
              <input type="time" className={"rounded-md border bg-background px-2 py-1 text-sm " + (hours[k].closed ? "opacity-40" : "")} disabled={hours[k].closed} value={hours[k].open} onChange={(e) => setHours({ ...hours, [k]: { ...hours[k], open: e.target.value } })} />
              <span className="text-muted-foreground">–</span>
              <input type="time" className={"rounded-md border bg-background px-2 py-1 text-sm " + (hours[k].closed ? "opacity-40" : "")} disabled={hours[k].closed} value={hours[k].close} onChange={(e) => setHours({ ...hours, [k]: { ...hours[k], close: e.target.value } })} />
              <label className="flex items-center gap-1 text-xs text-muted-foreground"><input type="checkbox" checked={hours[k].closed} onChange={(e) => setHours({ ...hours, [k]: { ...hours[k], closed: e.target.checked } })} /> {t("settings-form.no-closed", lang)}</label>
            </div>
          ))}
        </div>
      </div>
      {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
      <button className="mt-3 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium" disabled={busy} onClick={save}>{busy ? t("pub.login.signing_in", lang) : t("common.save", lang)}</button>
    </div>
  );
}