"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createProduct, updateProduct, deleteProduct, setProductActive } from "@/actions/products";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";
import { formatRM } from "@/lib/money";

type PRow = { id: string; name: string; sku: string; manufacturerPartNo: string | null; category: string | null; brand: string | null; sellPriceSen: number; costPriceSen: number; minStock: number; active: boolean };
type Draft = { name: string; sku: string; category: string; brand: string; cost: string; sell: string; minStock: string };

const inputCls = "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm";
const labelCls = "text-[11px] font-medium text-muted-foreground mb-0.5 block";

function toSen(rm: string): number { return Number(rm) ? Math.round(parseFloat(rm) * 100) : 0; }
function toRM(sen: number): string { return (sen / 100).toFixed(2); }
function empty(): Draft { return { name: "", sku: "", category: "", brand: "", cost: "", sell: "", minStock: "5" }; }
function fromRow(p: PRow): Draft { return { name: p.name, sku: p.sku, category: p.category ?? "", brand: p.brand ?? "", cost: toRM(p.costPriceSen), sell: toRM(p.sellPriceSen), minStock: String(p.minStock) }; }

export function ProductManager({ products, canManage }: { products: PRow[]; canManage: boolean }) {
  const router = useRouter();
  const lang = useLang();
  const [add, setAdd] = useState<Draft>(empty());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(empty());
  const [msg, setMsg] = useState("");

  async function doCreate() {
    const res = await createProduct({ name: add.name, sku: add.sku.trim().toUpperCase(), category: add.category || null, brand: add.brand || null, costPriceSen: toSen(add.cost), sellPriceSen: toSen(add.sell), minStock: Number(add.minStock) || 5 });
    setMsg(res.ok ? "" : (res.error ?? "Failed"));
    if (res.ok) { setAdd(empty()); router.refresh(); }
  }
  async function doUpdate(id: string) {
    const res = await updateProduct(id, { name: draft.name, sku: draft.sku.trim().toUpperCase(), category: draft.category || null, brand: draft.brand || null, costPriceSen: toSen(draft.cost), sellPriceSen: toSen(draft.sell), minStock: Number(draft.minStock) || 5 });
    setMsg(res.ok ? "" : (res.error ?? "Failed"));
    if (res.ok) { setEditingId(null); router.refresh(); }
  }
  async function doDelete(id: string) {
    if (!confirm(t("ws.products.confirm-delete", lang))) return;
    await deleteProduct(id); router.refresh();
  }
  async function doToggle(p: PRow) { await setProductActive(p.id, !p.active); router.refresh(); }

  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      <div className="border-b bg-muted/30 px-4 py-3 flex items-center justify-between">
        <h2 className="font-semibold text-sm">{t("ws.products.title", lang)}</h2>
        {canManage && <span className="text-[11px] text-muted-foreground">{t("ws.products.subtitle", lang).replace("{n}", String(products.length))}</span>}
      </div>

      {canManage && (
        <div className="p-4 border-b">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
            <input className={inputCls} placeholder={t("ws.products.col.name", lang)} value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
            <input className={inputCls} placeholder="SKU" value={add.sku} onChange={(e) => setAdd({ ...add, sku: e.target.value })} />
            <input className={inputCls} placeholder={t("ws.products.col.category", lang)} value={add.category} onChange={(e) => setAdd({ ...add, category: e.target.value })} />
            <input className={inputCls} placeholder={t("ws.products.col.brand", lang)} value={add.brand} onChange={(e) => setAdd({ ...add, brand: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <input className={inputCls} placeholder={t("ws.products.cost-label", lang)} value={add.cost} onChange={(e) => setAdd({ ...add, cost: e.target.value })} />
            <input className={inputCls} placeholder={t("ws.products.sell-label", lang)} value={add.sell} onChange={(e) => setAdd({ ...add, sell: e.target.value })} />
            <input className={inputCls} type="number" placeholder={t("ws.products.min-stock", lang)} value={add.minStock} onChange={(e) => setAdd({ ...add, minStock: e.target.value })} />
          </div>
          <button className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium" disabled={!add.name || !add.sku} onClick={doCreate}>{t("ws.products.add", lang)}</button>
          {msg && <p className="mt-2 text-xs text-destructive">{msg}</p>}
        </div>
      )}

      <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
        <table className="dz-table">
          <thead><tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground sticky top-0 z-10">
            <th className="px-4 py-3">{t("ws.products.col.name", lang)}</th><th className="px-4 py-3">SKU</th><th className="px-4 py-3">{t("ws.products.col.category", lang)}</th>
            <th className="px-4 py-3">{t("ws.products.col.brand", lang)}</th><th className="px-4 py-3">{t("ws.products.col.cost", lang)}</th><th className="px-4 py-3">{t("ws.products.col.sell", lang)}</th>
            <th className="px-4 py-3">{t("ws.products.col.margin", lang)}</th><th className="px-4 py-3">{t("ws.products.col.status", lang)}</th>{canManage && <th className="px-4 py-3 text-right">•</th>}
          </tr></thead>
          <tbody>
            {products.map((p) => {
              const margin = p.sellPriceSen > 0 ? Math.round(((p.sellPriceSen - p.costPriceSen) / p.sellPriceSen) * 100) : 0;
              const editing = editingId === p.id;
              return (
                <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                  {editing ? (
                    <>
                      <td className="px-2 py-1.5"><input className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></td>
                      <td className="px-2 py-1.5"><input className={inputCls} value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} /></td>
                      <td className="px-2 py-1.5"><input className={inputCls} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></td>
                      <td className="px-2 py-1.5"><input className={inputCls} value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} /></td>
                      <td className="px-2 py-1.5"><input className={inputCls} value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} /></td>
                      <td className="px-2 py-1.5"><input className={inputCls} value={draft.sell} onChange={(e) => setDraft({ ...draft, sell: e.target.value })} /></td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground"><input className={inputCls} type="number" value={draft.minStock} onChange={(e) => setDraft({ ...draft, minStock: e.target.value })} /></td>
                      <td className="px-2 py-1.5"><span className="text-[11px]">{t("ws.products.col.status", lang)}</span></td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        <button className="text-primary hover:underline mr-2" onClick={() => doUpdate(p.id)}>{t("ws.products.save", lang)}</button>
                        <button className="text-muted-foreground hover:underline" onClick={() => setEditingId(null)}>{t("ws.products.cancel", lang)}</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 font-medium">{p.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{p.sku}</td>
                      <td className="px-4 py-2.5 text-xs">{p.category?.replace("_", " ") ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs">{p.brand ?? "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums">{formatRM(p.costPriceSen)}</td>
                      <td className="px-4 py-2.5 font-semibold tabular-nums">{formatRM(p.sellPriceSen)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-emerald-600 dark:text-emerald-300">{margin}%</td>
                      <td className="px-4 py-2.5"><span className={"rounded-full px-2 py-0.5 text-[10px] font-semibold " + (p.active ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground")}>{t(p.active ? "ws.products.col.active" : "ws.products.col.archived", lang)}</span></td>
                      {canManage && (
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <button className="text-muted-foreground hover:text-foreground mr-2" onClick={() => { setEditingId(p.id); setDraft(fromRow(p)); }}>{t("ws.products.edit", lang)}</button>
                          <button className="text-muted-foreground hover:text-destructive mr-2" onClick={() => doToggle(p)}>{t(p.active ? "ws.products.col.archived" : "ws.products.col.active", lang)}</button>
                          <button className="text-muted-foreground hover:text-destructive" onClick={() => doDelete(p.id)}>{t("ws.products.delete", lang)}</button>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}