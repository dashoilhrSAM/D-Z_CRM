"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bike, Check, ChevronDown, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createJob } from "@/actions/workshop";
import { formatRM } from "@/lib/money";
import { SERVICE_CATALOG, servicesForType } from "@/lib/service-catalog";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";

export interface CustomerOption { id: string; name: string; phone: string | null }
export interface MotorcycleOption { id: string; customerId: string; brand: string; model: string; plate: string; year: number; type: string; currentMileage: number }
export interface PackageOption { id: string; name: string; tier: string; priceSen: number; isBestValue?: boolean; description?: string | null }
export interface MechanicOption { id: string; name: string; branchName?: string | null }
export interface Rec { kind: string; description: string; reason: string; script: string; priceSen: number; productId?: string; unitCostSen?: number }

export function CreateJobForm({
  customers, motorcyclesByCustomer, packages, mechanics, preselectCustomer, preselectMotorcycle,
}: {
  customers: CustomerOption[];
  motorcyclesByCustomer: Record<string, MotorcycleOption[]>;
  packages: PackageOption[];
  mechanics: MechanicOption[];
  preselectCustomer: string | null;
  preselectMotorcycle?: string | null;
}) {
  const router = useRouter();
  const lang = useLang();
  const [pending, start] = useTransition();
  // preselectMotorcycle 优先：带出车主 + 摩托（QR 扫码直达开单）
  const initialBike = preselectMotorcycle
    ? Object.values(motorcyclesByCustomer).flat().find((m) => m.id === preselectMotorcycle)
    : undefined;
  const [customerId, setCustomerId] = useState(initialBike?.customerId ?? preselectCustomer ?? "");
  const [motorcycleId, setMotorcycleId] = useState(initialBike?.id ?? "none"); // "none" = no bike picked yet (must match a SelectItem value)
  const [mileage, setMileage] = useState("");
  const [request, setRequest] = useState("");
  const [packageId, setPackageId] = useState("");
  // "none" = assign later sentinel (must match a SelectItem value, see edit-job-form)
  const [mechanicId, setMechanicId] = useState("none");
  const [recs, setRecs] = useState<Rec[]>([]);
  const [recState, setRecState] = useState<Record<string, "added" | "skipped">>({});
  const [showScript, setShowScript] = useState<string | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [q, setQ] = useState("");
  // additional services (manual add-ons from the market service catalogue)
  const [extraServices, setExtraServices] = useState<Record<string, { label: string; priceSen: number }>>({});

  const motorcycles = customerId ? (motorcyclesByCustomer[customerId] ?? []) : [];
  const bike = motorcycles.find((m) => m.id === motorcycleId);
  // services applicable to the selected bike type (falls back to full catalogue)
  const availableServices = bike && servicesForType(bike.type).flatMap((g) => g.items);
  const extras = availableServices && availableServices.length > 0 ? availableServices : [...SERVICE_CATALOG];
  const selectedExtras = Object.values(extraServices);
  const totalExtras = selectedExtras.reduce((s, x) => s + x.priceSen, 0);

  useEffect(() => {
    if (!motorcycleId) {
      const id = requestAnimationFrame(() => setRecs([]));
      return () => cancelAnimationFrame(id);
    }
    let cancelled = false;
    fetch("/api/recommendations?motorcycleId=" + motorcycleId + "&mileage=" + (Number(mileage) || 0))
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setRecs(d.recs ?? []); });
    return () => { cancelled = true; };
  }, [motorcycleId, mileage]);

  const filteredCustomers = customers.filter((c) => (c.name + " " + (c.phone ?? "")).toLowerCase().includes(q.toLowerCase()));
  const selectedRecs = recs.filter((r) => recState[r.description] === "added");
  const totalAddons = selectedRecs.reduce((s, r) => s + r.priceSen, 0) + totalExtras;
  const pkg = packages.find((p) => p.id === packageId);
  const estimated = (pkg?.priceSen ?? 0) + totalAddons;

  const submit = () => {
    if (!customerId || !motorcycleId || !mileage) { toast.error(t("toast.job-fields-required", lang)); return; }
    start(async () => {
      try {
        const r = await createJob({
          customerId, motorcycleId, mileage: Number(mileage), customerRequest: request || undefined,
          packageId: packageId || undefined, mechanicId: mechanicId === "none" ? undefined : mechanicId,
          addons: [
            ...selectedRecs.map((rec) => ({ description: rec.description, kind: rec.kind, quantity: 1, unitPriceSen: rec.priceSen, productId: rec.productId, unitCostSen: rec.unitCostSen })),
            ...selectedExtras.map((x) => ({ description: x.label, kind: "SERVICE", quantity: 1, unitPriceSen: x.priceSen })),
          ],
        });
        router.push("/workshop/jobs/" + r.id);
        toast.success(tpl("toast.job-created", lang, { job: r.jobNumber }));
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  };

  return (
    <div className="grid lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 space-y-6">
        <section className="rounded-2xl border bg-card p-5">
          <h3 className="font-semibold mb-3">{t("job-form.heading-customer", lang)}</h3>
          <div className="relative">
            <button type="button" onClick={() => setCustomerOpen((o) => !o)} className="w-full flex items-center justify-between rounded-lg border bg-background px-3 py-2 text-sm hover:bg-muted/40">
              <span>{customerId ? customers.find((c) => c.id === customerId)?.name : t("job-form.placeholder-customer", lang)}</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
            {customerOpen && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border bg-popover shadow-lg">
                <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ws.customers.search-placeholder", lang)} className="border-0 border-b rounded-none focus-visible:ring-0" />
                <div className="max-h-56 overflow-y-auto p-1">
                  {filteredCustomers.map((c) => (
                    <button key={c.id} type="button" onClick={() => { setCustomerId(c.id); setMotorcycleId(""); setCustomerOpen(false); setQ(""); }}
                      className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted">
                      <span>{c.name}</span><span className="text-xs text-muted-foreground">{c.phone}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {motorcycles.length > 0 && (
            <div className="mt-4">
              <Label>{t("ws.crm.return.col.motorcycle", lang)}</Label>
              <Select value={motorcycleId} onValueChange={(v) => setMotorcycleId(v ?? "none")}>
                <SelectTrigger className="mt-1.5"><SelectValue>{(v) => (v === "none" ? t("job-form.placeholder-motorcycle", lang) : motorcycles.find((m) => m.id === v) ? motorcycles.find((m) => m.id === v)!.brand + " " + motorcycles.find((m) => m.id === v)!.model + " · " + motorcycles.find((m) => m.id === v)!.plate : t("job-form.placeholder-motorcycle", lang))}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("job-form.placeholder-motorcycle", lang)}</SelectItem>
                  {motorcycles.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.brand} {m.model} · {m.plate} · {m.year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h3 className="font-semibold mb-3">{t("job-form.heading-mileage", lang)}</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label>{t("job-form.label-mileage", lang)}</Label>
              <Input inputMode="numeric" value={mileage} onChange={(e) => setMileage(e.target.value)} placeholder={t("job-form.placeholder-mileage", lang)} className="mt-1.5" />
            </div>
            <div>
              <Label>{t("ws.job.customer-request", lang)}</Label>
              <Input value={request} onChange={(e) => setRequest(e.target.value)} placeholder={t("job-form.placeholder-request", lang)} className="mt-1.5" />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h3 className="font-semibold mb-3">{t("job-form.heading-package", lang)}</h3>
          <RadioGroup value={packageId} onValueChange={(v) => setPackageId(v ?? "")} className="grid sm:grid-cols-3 gap-3">
            {packages.map((p) => (
              <label key={p.id} className={"relative cursor-pointer rounded-2xl border p-4 transition-colors " + (packageId === p.id ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/40")}>
                <RadioGroupItem value={p.id} className="absolute top-3 right-3" />
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{p.tier}</div>
                <div className="mt-1 font-semibold">{p.name}</div>
                <div className="mt-1 text-lg font-bold tabular-nums">{formatRM(p.priceSen)}</div>
                {p.isBestValue && <span className="mt-2 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">{t("ws.packages.best-value", lang)}</span>}
                {p.description && <p className="mt-2 text-[11px] text-muted-foreground leading-snug">{p.description}</p>}
              </label>
            ))}
          </RadioGroup>
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h3 className="font-semibold mb-1">{t("job-form.heading-additional", lang)}</h3>
          <p className="text-xs text-muted-foreground mb-3">{t("job-form.additional-hint", lang)}</p>
          {!motorcycleId ? (
            <p className="text-sm text-muted-foreground">{t("job-form.select-bike-services", lang)}</p>
          ) : (
            <div className="space-y-1.5">
              {extras.map((s) => {
                const added = extraServices[s.key];
                const active = !!added;
                return (
                  <div key={s.key} className={"flex items-center gap-3 rounded-xl border px-3 py-2.5 " + (active ? "border-emerald-300 bg-emerald-50/40" : "hover:border-primary/40")}>
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => {
                        setExtraServices((prev) => {
                          const next = { ...prev };
                          if (next[s.key]) delete next[s.key];
                          else next[s.key] = { label: s.label, priceSen: s.defaultPriceSen };
                          return next;
                        });
                      }}
                      className="h-4 w-4 accent-emerald-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{s.label}</div>
                      <div className="text-[11px] text-muted-foreground">{s.family} · {s.typicalInterval}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">RM</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        disabled={!active}
                        value={active ? (added.priceSen / 100).toFixed(2) : (s.defaultPriceSen / 100).toFixed(2)}
                        onChange={(ev) => {
                          const v = Math.max(0, Math.round(Number(ev.target.value) * 100));
                          setExtraServices((prev) => ({ ...prev, [s.key]: { label: s.label, priceSen: isNaN(v) ? 0 : v } }));
                        }}
                        className="w-16 rounded-md border bg-background px-1.5 py-1 text-right text-sm tabular-nums disabled:opacity-40"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h3 className="font-semibold mb-3">{t("job-form.heading-mechanic", lang)}</h3>
          <Select value={mechanicId} onValueChange={(v) => setMechanicId(v ?? "none")}>
            <SelectTrigger className="mt-1.5 max-w-sm"><SelectValue>{(v) => (v === "none" ? t("job-form.assign-later", lang) : mechanics.find((m) => m.id === v)?.name ?? t("job-form.assign-later", lang))}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("job-form.assign-later", lang)}</SelectItem>
              {mechanics.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}{m.branchName ? " · " + m.branchName : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </section>
      </div>

      <div className="lg:col-span-2 space-y-6">
        <section className="rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">{t("job-form.heading-recommendations", lang)}</h3>
          </div>
          {!motorcycleId ? (
            <p className="text-sm text-muted-foreground">{t("job-form.select-bike-recs", lang)}</p>
          ) : recs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("job-form.loading-recs", lang)}</p>
          ) : (
            <div className="space-y-3">
              {recs.map((r) => {
                const state = recState[r.description];
                return (
                  <div key={r.description} className={"rounded-xl border p-3.5 " + (state === "added" ? "border-emerald-300 bg-emerald-50/50" : state === "skipped" ? "border-slate-200 bg-muted/30 opacity-60" : "")}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold">{r.description}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{r.reason}</div>
                      </div>
                      <div className="text-sm font-bold tabular-nums shrink-0">{formatRM(r.priceSen)}</div>
                    </div>
                    <button type="button" onClick={() => setShowScript(showScript === r.description ? null : r.description)} className="mt-1.5 text-[11px] font-medium text-primary hover:underline">
                      {showScript === r.description ? t("job-form.hide-script", lang) : t("job-form.show-script", lang)}
                    </button>
                    {showScript === r.description && (
                      <p className="mt-1 rounded-lg bg-primary/5 p-2.5 text-xs italic text-muted-foreground">“{r.script}”</p>
                    )}
                    <div className="mt-2.5 flex gap-2">
                      {state === "added" ? (
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => setRecState((s) => ({ ...s, [r.description]: "skipped" }))}><X className="h-3.5 w-3.5 mr-1" /> {t("job-form.remove", lang)}</Button>
                      ) : (
                        <Button size="sm" className="flex-1" disabled={state === "skipped"} onClick={() => setRecState((s) => ({ ...s, [r.description]: "added" }))}><Check className="h-3.5 w-3.5 mr-1" /> {t("job-form.add", lang)}</Button>
                      )}
                      <Button size="sm" variant="ghost" disabled={state === "added"} onClick={() => setRecState((s) => ({ ...s, [r.description]: "skipped" }))}>{t("job-form.skip", lang)}</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-card p-5 sticky top-24">
          <h3 className="font-semibold mb-3">{t("ws.job.estimated-total", lang)}</h3>
          <div className="space-y-1.5 text-sm">
            {pkg ? (
              <div className="flex justify-between"><span>{pkg.name}</span><span className="tabular-nums">{formatRM(pkg.priceSen)}</span></div>
            ) : <div className="text-muted-foreground text-xs">{t("job-form.no-package", lang)}</div>}
            {selectedRecs.map((r) => (
              <div key={r.description} className="flex justify-between text-xs"><span>{r.description}</span><span className="tabular-nums">{formatRM(r.priceSen)}</span></div>
            ))}
            <div className="border-t pt-2 mt-2 flex justify-between font-bold"><span>{t("common.total", lang)}</span><span className="tabular-nums">{formatRM(estimated)}</span></div>
          </div>
          <Button className="w-full mt-4" size="lg" disabled={pending || !customerId || !motorcycleId || !mileage} onClick={submit}>
            <Bike className="h-4 w-4 mr-2" /> {pending ? t("job-form.creating", lang) : t("job-form.confirm-job", lang)}
          </Button>
        </section>
      </div>
    </div>
  );
}
