"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { updateJobDetails, addJobServiceItems, removeJobItem } from "@/actions/workshop";
import { formatRM } from "@/lib/money";
import { SERVICE_CATALOG, servicesForType } from "@/lib/service-catalog";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";

export interface EditJobData {
  jobId: string;
  mileage: number;
  customerRequest: string | null;
  mechanicId: string | null;
  motorcycleType: string;
  items: { id: string; description: string; kind: "item" | "part"; unitPriceSen: number; status: string }[];
}
import { spansBranches, mechanicLabel, type MechanicOption } from "./mechanic-option";

export function EditJobForm({ data, mechanics }: { data: EditJobData; mechanics: MechanicOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [mileage, setMileage] = useState(String(data.mileage));
  const [request, setRequest] = useState(data.customerRequest ?? "");
  // "none" = unassigned sentinel — avoids a controlled Select value ("") that
  // matches no item (base-ui render-phase correction would loop → React 441).
  const [mechanicId, setMechanicId] = useState(data.mechanicId ?? "none");
  const showBranch = spansBranches(mechanics);
  const [extra, setExtra] = useState<Record<string, { label: string; priceSen: number }>>({});

  const applicable = servicesForType(data.motorcycleType).flatMap((g) => g.items);
  const extras = applicable.length > 0 ? applicable : [...SERVICE_CATALOG];

  const save = () =>
    start(async () => {
      try {
        await updateJobDetails({
          jobId: data.jobId,
          mileage: Number(mileage) || 0,
          customerRequest: request || undefined,
          mechanicId: mechanicId === "none" ? null : mechanicId,
        });
        const added = Object.values(extra);
        if (added.length > 0) {
          await addJobServiceItems({ jobId: data.jobId, items: added.map((x) => ({ description: x.label, priceSen: x.priceSen })) });
        }
        setOpen(false);
        router.refresh();
        toast.success(t("job-form.toast-updated", lang) + (added.length > 0 ? " — " + tpl("job-form.toast-lines-added", lang, { n: added.length }) : ""));
      } catch (e) {
        toast.error((e as Error).message);
      }
    });

  const removeLine = (kind: "item" | "part", itemId: string, description: string) =>
    start(async () => {
      await removeJobItem({ jobId: data.jobId, kind, itemId });
      router.refresh();
      toast.success(tpl("job-form.toast-removed", lang, { name: description }));
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted">
        <Pencil className="h-3.5 w-3.5" /> {t("bike.edit-details", lang)}
      </DialogTrigger>
      <DialogContent style={{ maxWidth: "48rem" }} className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("job-form.edit-title", lang)}</DialogTitle>
          <DialogDescription>{t("job-form.edit-desc", lang)}</DialogDescription>
        </DialogHeader>

        <div className="grid sm:grid-cols-3 gap-3 py-2">
          <div>
            <Label>{t("job-form.mileage", lang)}</Label>
            <Input inputMode="numeric" value={mileage} onChange={(e) => setMileage(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label>{t("job-form.mechanic", lang)}</Label>
            <Select value={mechanicId} onValueChange={(v) => setMechanicId(v ?? "")}>
              <SelectTrigger data-testid="mechanic-select" className="mt-1.5 w-full sm:w-80"><SelectValue>{(v) => (v === "none" ? t("job-form.unassigned", lang) : mechanics.find((m) => m.id === v)?.name ?? t("job-form.unassigned", lang))}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("job-form.unassigned", lang)}</SelectItem>
                {mechanics.map((m) => <SelectItem key={m.id} value={m.id}>{mechanicLabel(m, showBranch)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("ws.job.customer-request", lang)}</Label>
            <Input value={request} onChange={(e) => setRequest(e.target.value)} placeholder="—" className="mt-1.5" />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mt-1">
          {/* current lines with remove */}
          <div>
            <Label>{t("ws.job.lines-title", lang)}</Label>
            <div className="mt-1.5 space-y-1 max-h-52 overflow-y-auto">
              {data.items.length === 0 && <p className="text-xs text-muted-foreground">{t("job-form.no-lines", lang)}</p>}
              {data.items.map((it) => (
                <div key={it.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm">
                  <span className="flex-1 truncate">{it.description}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{formatRM(it.unitPriceSen)}</span>
                  <button
                    type="button"
                    onClick={() => removeLine(it.kind, it.id, it.description)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600"
                    title={t("job-form.remove-line-title", lang)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* add-on services */}
          <div>
            <Label>{t("job-form.add-service", lang)}</Label>
            <div className="mt-1.5 space-y-1 max-h-52 overflow-y-auto">
              {extras.map((s) => {
                const active = !!extra[s.key];
                return (
                  <div key={s.key} className={"flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm " + (active ? "border-emerald-300 bg-emerald-50/40" : "")}>
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => setExtra((prev) => {
                        const next = { ...prev };
                        if (next[s.key]) delete next[s.key];
                        else next[s.key] = { label: s.label, priceSen: s.defaultPriceSen };
                        return next;
                      })}
                      className="h-4 w-4 accent-emerald-600"
                    />
                    <span className="flex-1 truncate">{s.label}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{formatRM(s.defaultPriceSen)}</span>
                  </div>
                );
              })}
            </div>
            {Object.keys(extra).length > 0 && (
              <p className="mt-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                {tpl("job-form.will-add", lang, { n: Object.keys(extra).length })} — +{formatRM(Object.values(extra).reduce((s, x) => s + x.priceSen, 0))}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel", lang)}</Button>
          <Button disabled={pending} onClick={save}>{pending ? t("job-form.saving", lang) : t("profile.save-changes", lang)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
