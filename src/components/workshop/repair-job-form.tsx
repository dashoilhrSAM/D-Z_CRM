"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bike, ChevronDown, Plus, X, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createJob } from "@/actions/workshop";
import { formatRM } from "@/lib/money";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";

export interface CustomerOption { id: string; name: string; phone: string | null }
export interface MotorcycleOption { id: string; customerId: string; brand: string; model: string; plate: string; year: number; type: string; currentMileage: number }
import { spansBranches, mechanicLabel, type MechanicOption } from "./mechanic-option";

export interface PartLine { productId: string; name: string; quantity: number; unitPriceSen: number; unitCostSen: number }
export interface LabourLine { description: string; kind: string; quantity: number; unitPriceSen: number }

export function RepairJobForm({
  customers, motorcyclesByCustomer, mechanics, preselectCustomer, preselectMotorcycle, bookingId,
}: {
  customers: CustomerOption[];
  motorcyclesByCustomer: Record<string, MotorcycleOption[]>;
  mechanics: MechanicOption[];
  preselectCustomer: string | null;
  preselectMotorcycle?: string | null;
  bookingId?: string | null;
}) {
  const router = useRouter();
  // The suffix only earns its width when the list really spans branches.
  const showBranch = spansBranches(mechanics);
  const lang = useLang();
  const [pending, start] = useTransition();
  const initialBike = preselectMotorcycle ? Object.values(motorcyclesByCustomer).flat().find((m) => m.id === preselectMotorcycle) : undefined;
  const [customerId, setCustomerId] = useState(initialBike?.customerId ?? preselectCustomer ?? "");
  const [motorcycleId, setMotorcycleId] = useState(initialBike?.id ?? "none");
  // 预填：从 Model A check-in 流预选的车 或 用户在表单里选的车，都用该车 currentMileage，避免里程写错（< 车实际里程）导致完成时 Mileage regression
  const [mileage, setMileage] = useState(initialBike ? String(initialBike.currentMileage) : "");
  const [problem, setProblem] = useState("");
  const [mechanicId, setMechanicId] = useState("none");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [q, setQ] = useState("");
  // parts
  const [parts, setParts] = useState<PartLine[]>([]);
  const [partSearch, setPartSearch] = useState("");
  const [partResults, setPartResults] = useState<{ id: string; name: string; sku: string; sellPriceSen: number; costPriceSen: number; stock: number }[]>([]);
  const [partOpen, setPartOpen] = useState(false);
  // labour
  const [labour, setLabour] = useState<LabourLine[]>([]);

  const motorcycles = customerId ? (motorcyclesByCustomer[customerId] ?? []) : [];
  const filteredCustomers = customers.filter((c) => (c.name + " " + (c.phone ?? "")).toLowerCase().includes(q.toLowerCase()));

  useEffect(() => {
    if (!partSearch.trim()) {
      const id = requestAnimationFrame(() => setPartResults([]));
      return () => cancelAnimationFrame(id);
    }
    let cancelled = false;
    fetch("/api/repair-parts?q=" + encodeURIComponent(partSearch))
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setPartResults(d.parts ?? []); });
    return () => { cancelled = true; };
  }, [partSearch]);

  const addPart = (p: { id: string; name: string; sku: string; sellPriceSen: number; costPriceSen: number }) => {
    setParts((prev) => prev.some((x) => x.productId === p.id) ? prev : [...prev, { productId: p.id, name: p.name, quantity: 1, unitPriceSen: p.sellPriceSen, unitCostSen: p.costPriceSen }]);
    setPartOpen(false);
  };
  const totalParts = parts.reduce((s, p) => s + p.unitPriceSen * p.quantity, 0);
  const totalLabour = labour.reduce((s, l) => s + l.unitPriceSen * l.quantity, 0);
  const estimated = totalParts + totalLabour;

  const submit = () => {
    if (!customerId || !motorcycleId || !mileage) { toast.error(t("toast.job-fields-required", lang)); return; }
    start(async () => {
      try {
        const r = await createJob({
          customerId, motorcycleId, mileage: Number(mileage), customerRequest: problem || undefined,
          mechanicId: mechanicId === "none" ? undefined : mechanicId,
          type: "REPAIR",
          bookingId: bookingId ?? undefined,
          parts: parts.map((p) => ({ productId: p.productId, quantity: p.quantity, unitPriceSen: p.unitPriceSen, unitCostSen: p.unitCostSen })),
          labour: labour.map((l) => ({ description: l.description, kind: l.kind, quantity: l.quantity, unitPriceSen: l.unitPriceSen })),
        });
        router.push("/workshop/jobs/" + r.id);
        toast.success(tpl("toast.job-created", lang, { job: r.jobNumber }));
      } catch (e) { toast.error((e as Error).message); }
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
              <Select value={motorcycleId} onValueChange={(v) => { setMotorcycleId(v ?? "none"); const bik = motorcycles.find((m) => m.id === v); if (bik) setMileage(String(bik.currentMileage)); }}>
                <SelectTrigger className="mt-1.5"><SelectValue>{(v) => (v === "none" ? t("job-form.placeholder-motorcycle", lang) : motorcycles.find((m) => m.id === v)?.brand + " " + motorcycles.find((m) => m.id === v)?.model + " · " + motorcycles.find((m) => m.id === v)?.plate)}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("job-form.placeholder-motorcycle", lang)}</SelectItem>
                  {motorcycles.map((m) => (<SelectItem key={m.id} value={m.id}>{m.brand} {m.model} · {m.plate} · {m.year}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h3 className="font-semibold mb-3">{t("job-form.heading-mileage-problem", lang)}</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label>{t("job-form.label-mileage", lang)}</Label>
              <Input inputMode="numeric" value={mileage} onChange={(e) => setMileage(e.target.value)} placeholder={t("job-form.placeholder-mileage", lang)} className="mt-1.5" />
            </div>
            <div>
              <Label>{t("repair.problem", lang)}</Label>
              <Input value={problem} onChange={(e) => setProblem(e.target.value)} placeholder={t("repair.problem-hint", lang)} className="mt-1.5" />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h3 className="font-semibold mb-3">{t("repair.parts", lang)}</h3>
          <div className="relative">
            <Input value={partSearch} onChange={(e) => { setPartSearch(e.target.value); setPartOpen(true); }} placeholder={t("repair.search-part", lang)} className="mb-2" />
            {partOpen && partResults.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border bg-popover shadow-lg">
                <div className="max-h-56 overflow-y-auto p-1">
                  {partResults.map((p) => (
                    <button key={p.id} type="button" onClick={() => addPart(p)} className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted">
                      <span>{p.name} <span className="text-xs text-muted-foreground">{p.sku}</span></span>
                      <span className="shrink-0 text-xs font-semibold">{formatRM(p.sellPriceSen)} · {tpl("job-form.in-stock", lang, { n: p.stock })}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {parts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("repair.no-parts", lang)}</p>
          ) : (
            <div className="space-y-1.5">
              {parts.map((p, i) => (
                <div key={p.productId} className="flex items-center gap-2 rounded-xl border px-3 py-2">
                  <span className="flex-1 min-w-0 truncate text-sm font-medium">{p.name}</span>
                  <input type="number" inputMode="numeric" value={p.quantity} min={1} onChange={(e) => setParts((prev) => prev.map((x, j) => j === i ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x))} className="w-12 rounded-md border bg-background px-1.5 py-1 text-right text-sm" />
                  <input type="number" inputMode="decimal" value={(p.unitPriceSen / 100).toFixed(2)} onChange={(e) => setParts((prev) => prev.map((x, j) => j === i ? { ...x, unitPriceSen: Math.max(0, Math.round(Number(e.target.value) * 100) || 0) } : x))} className="w-20 rounded-md border bg-background px-1.5 py-1 text-right text-sm tabular-nums" />
                  <span className="text-sm font-semibold tabular-nums w-20 text-right">{formatRM(p.unitPriceSen * p.quantity)}</span>
                  <button type="button" onClick={() => setParts((prev) => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-rose-600"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={() => setParts((prev) => [...prev, { productId: "", name: t("repair.add-part", lang), quantity: 1, unitPriceSen: 0, unitCostSen: 0 }])}><Plus className="h-3.5 w-3.5 mr-1" /> {t("repair.add-part", lang)}</Button>
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h3 className="font-semibold mb-3">{t("repair.labour", lang)}</h3>
          <div className="space-y-1.5">
            {labour.length === 0 && <p className="text-sm text-muted-foreground">{t("job-form.no-labour", lang)}</p>}
            {labour.map((l, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl border px-3 py-2">
                <Input value={l.description} placeholder={t("repair.description", lang)} onChange={(e) => setLabour((prev) => prev.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} className="h-8 flex-1" />
                <input type="number" inputMode="numeric" value={l.quantity} min={1} onChange={(e) => setLabour((prev) => prev.map((x, j) => j === i ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x))} className="w-12 rounded-md border bg-background px-1.5 py-1 text-right text-sm" />
                <input type="number" inputMode="decimal" value={(l.unitPriceSen / 100).toFixed(2)} onChange={(e) => setLabour((prev) => prev.map((x, j) => j === i ? { ...x, unitPriceSen: Math.max(0, Math.round(Number(e.target.value) * 100) || 0) } : x))} className="w-20 rounded-md border bg-background px-1.5 py-1 text-right text-sm tabular-nums" />
                <span className="text-sm font-semibold tabular-nums w-20 text-right">{formatRM(l.unitPriceSen * l.quantity)}</span>
                <button type="button" onClick={() => setLabour((prev) => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-rose-600"><X className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={() => setLabour((prev) => [...prev, { description: "", kind: "LABOUR", quantity: 1, unitPriceSen: 0 }])}><Plus className="h-3.5 w-3.5 mr-1" /> {t("repair.add-labour", lang)}</Button>
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h3 className="font-semibold mb-3">{t("job-form.heading-mechanic", lang)}</h3>
          <Select value={mechanicId} onValueChange={(v) => setMechanicId(v ?? "none")}>
            <SelectTrigger data-testid="mechanic-select" className="mt-1.5 w-full max-w-sm"><SelectValue>{(v) => (v === "none" ? t("job-form.assign-later", lang) : mechanics.find((m) => m.id === v)?.name ?? t("job-form.assign-later", lang))}</SelectValue></SelectTrigger>
            <SelectContent className="min-w-64">
              <SelectItem value="none">{t("job-form.assign-later", lang)}</SelectItem>
              {mechanics.map((m) => <SelectItem key={m.id} value={m.id}>{mechanicLabel(m, showBranch)}</SelectItem>)}
            </SelectContent>
          </Select>
        </section>
      </div>

      <div className="lg:col-span-2 space-y-6">
        <section className="rounded-2xl border bg-card p-5 sticky top-24">
          <div className="flex items-center gap-2 mb-3"><Wrench className="h-4 w-4 text-primary" /><h3 className="font-semibold">{t("repair.title", lang)}</h3></div>
          <div className="space-y-1.5 text-sm">
            {parts.map((p) => (<div key={p.productId} className="flex justify-between text-xs"><span>{p.name} ×{p.quantity}</span><span className="tabular-nums">{formatRM(p.unitPriceSen * p.quantity)}</span></div>))}
            {labour.map((l, i) => (<div key={i} className="flex justify-between text-xs"><span>{l.description || "—"} ×{l.quantity}</span><span className="tabular-nums">{formatRM(l.unitPriceSen * l.quantity)}</span></div>))}
            <div className="border-t pt-2 mt-2 flex justify-between font-bold"><span>{t("common.total", lang)}</span><span className="tabular-nums">{formatRM(estimated)}</span></div>
          </div>
          <Button className="w-full mt-4" size="lg" disabled={pending || !customerId || !motorcycleId || !mileage} onClick={submit}>
            <Bike className="h-4 w-4 mr-2" /> {pending ? t("job-form.creating", lang) : t("job-form.confirm-repair", lang)}
          </Button>
        </section>
      </div>
    </div>
  );
}
