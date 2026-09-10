"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Upload } from "lucide-react";
import { createCampaign, createPoster, createScript, updateCampaign } from "@/actions/marketing";
import { SegmentBuilder } from "@/components/workshop/segment-builder";
import type { AudienceRules } from "@/modules/marketing/audience";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";

const TONES = [
  { id: "brand", label: "Brand", swatch: "bg-gradient-to-br from-slate-800 to-orange-500" },
  { id: "deep", label: "Deep Blue", swatch: "bg-gradient-to-br from-slate-900 to-sky-700" },
  { id: "fresh", label: "Fresh", swatch: "bg-gradient-to-br from-emerald-950 to-emerald-500" },
  { id: "bold", label: "Bold", swatch: "bg-gradient-to-br from-rose-950 to-rose-500" },
];
const SIZES = [
  { id: "SQUARE", label: "1:1 · Instagram" },
  { id: "STORY", label: "9:16 · Story" },
  { id: "BANNER", label: "16:9 · Banner" },
];

function useForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const run = (fn: () => Promise<unknown>, msg: string) =>
    start(async () => { await fn(); setOpen(false); router.refresh(); toast.success(msg); });
  return { pending, open, setOpen, run };
}

const typeOptions = [["RETURN", "Return"], ["REMINDER", "Reminder"], ["PROMO", "Promo"], ["NEWS", "News"]] as const;
const statusOptions = [["DRAFT", "Draft"], ["SCHEDULED", "Scheduled"], ["ACTIVE", "Active"], ["ENDED", "Ended"]] as const;

export interface CampaignDraft {
  id: string; name: string; type: string; status: string; audience: string | null;
  audienceRules?: AudienceRules | null;
  startDate: Date; endDate: Date | null; discountPercent: number | null;
  pointsBonus?: number | null;
}

function iso(d: Date): string { return d.toISOString().slice(0, 10); }

export function CampaignForm({ initial, onDone }: { initial?: CampaignDraft; onDone?: () => void }) {
  const lang = useLang();
  const { pending, open, setOpen, run } = useForm();
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState(initial?.type ?? "PROMO");
  const [status, setStatus] = useState(initial?.status ?? "DRAFT");
  const [rules, setRules] = useState<AudienceRules>((initial?.audienceRules as AudienceRules | null) ?? {});
  const [startDate, setStartDate] = useState(initial ? iso(initial.startDate) : "");
  const [endDate, setEndDate] = useState(initial?.endDate ? iso(initial.endDate) : "");
  const [discount, setDiscount] = useState(initial?.discountPercent != null ? String(initial.discountPercent) : "");
  const [pointsBonus, setPointsBonus] = useState(initial?.pointsBonus != null ? String(initial.pointsBonus) : "");
  const isEdit = !!initial;

  const submit = () => {
    const hasRules = Object.keys(rules).length > 0;
    const payload = {
      name, type: type as never, status: status as never,
      // rules win; dropping them falls the campaign back to its legacy code (or everyone)
      audience: hasRules ? undefined : (initial?.audience ?? "ALL"),
      audienceRules: hasRules ? rules : null,
      startDate, endDate: endDate || undefined, discountPercent: discount ? Number(discount) : undefined,
      // MKT-014: bonus loyalty points for bookings this campaign drove
      pointsBonus: pointsBonus ? Number(pointsBonus) : null,
    };
    if (isEdit) {
      run(() => updateCampaign({ id: initial.id, ...payload }), t("ws.mkt.form.campaign-updated", lang));
    } else {
      run(() => createCampaign(payload), t("ws.mkt.form.campaign-created", lang));
    }
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
        {isEdit ? t("ws.mkt.form.edit", lang) : t("ws.mkt.form.new-campaign", lang)}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? t("ws.mkt.form.edit-campaign", lang) : t("ws.mkt.form.new-campaign-title", lang)}</DialogTitle>
          <DialogDescription>{isEdit ? t("ws.mkt.form.edit-campaign-desc", lang) : t("ws.mkt.form.new-campaign-desc", lang)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>{t("ws.mkt.form.name", lang)}</Label><Input data-testid="campaign-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ws.mkt.form.name-placeholder", lang)} className="mt-1.5" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t("ws.mkt.form.type", lang)}</Label>
              <Select value={type} onValueChange={(v) => setType(v ?? "PROMO")}><SelectTrigger data-testid="campaign-type" className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>{typeOptions.map(([v]) => <SelectItem key={v} value={v}>{t("ws.mkt.calendar.type." + v, lang)}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label>{t("ws.mkt.form.status", lang)}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v ?? "DRAFT")}><SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>{statusOptions.map(([v]) => <SelectItem key={v} value={v}>{t("ws.mkt.status." + v, lang)}</SelectItem>)}</SelectContent></Select>
            </div>
          </div>
          <div>
            <SegmentBuilder value={rules} onChange={setRules} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t("ws.mkt.form.start-date", lang)}</Label><Input data-testid="campaign-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1.5" /></div>
            <div><Label>{t("ws.mkt.form.end-date", lang)}</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1.5" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {type === "PROMO" && (
              <div><Label>{t("ws.mkt.form.discount", lang)}</Label><Input data-testid="campaign-discount" type="number" min={1} max={100} value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder={t("ws.mkt.form.discount-placeholder", lang)} className="mt-1.5" /></div>
            )}
            <div><Label>{t("ws.mkt.form.points-bonus", lang)}</Label><Input data-testid="campaign-points-bonus" type="number" min={0} value={pointsBonus} onChange={(e) => setPointsBonus(e.target.value)} placeholder={t("ws.mkt.form.points-bonus-placeholder", lang)} className="mt-1.5" /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("ws.mkt.form.cancel", lang)}</Button>
          <Button data-testid="campaign-submit" disabled={!name || !startDate || pending} onClick={submit}>
            {isEdit ? t("ws.mkt.form.save-changes", lang) : t("ws.mkt.form.create-campaign", lang)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PosterForm() {
  const router = useRouter();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [promo, setPromo] = useState("");
  const [tone, setTone] = useState("brand");
  const [size, setSize] = useState("SQUARE");
  const [visual, setVisual] = useState("poster");
  const [count, setCount] = useState("1");
  const [assetUrl, setAssetUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url?: string; error?: string } | null>(null);

  async function onAsset(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("relatedType", "POSTER_REF");
    fd.append("relatedId", "poster-ref");
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.ok) setAssetUrl(data.url);
    } catch { /* ignore */ }
    setUploading(false);
    e.target.value = "";
  }

  async function generate() {
    if (!title.trim()) return;
    setBusy(true); setResult(null);
    const res = await fetch("/api/poster/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, subtitle, promo, tone, size, visual, count: parseInt(count) || 1, assetUrl: assetUrl || undefined }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.ok) {
      setResult({ url: data.url });
      toast.success(t("ws.mkt.form.poster-generated", lang));
      setOpen(false); // auto-close so the flow never feels stuck
      router.refresh();
    } else {
      setResult({ error: data.error ?? t("ws.mkt.form.gen-failed", lang) });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
        <Sparkles className="h-4 w-4" /> {t("ws.mkt.form.generate-ai", lang)}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("ws.mkt.form.generate-poster", lang)}</DialogTitle>
          <DialogDescription>{t("ws.mkt.form.generate-desc", lang)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>{t("ws.mkt.form.poster-title", lang)}</Label>
            <Input data-testid="poster-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("ws.mkt.form.poster-title-placeholder", lang)} className="mt-1.5" />
          </div>
          <div>
            <Label>{t("ws.mkt.form.subtitle", lang)}</Label>
            <Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder={t("ws.mkt.form.poster-subtitle-placeholder", lang)} className="mt-1.5" />
          </div>
          <div>
            <Label>{t("ws.mkt.form.promo", lang)}</Label>
            <Input value={promo} onChange={(e) => setPromo(e.target.value)} placeholder={t("ws.mkt.form.promo-placeholder", lang)} className="mt-1.5" />
          </div>
          <div>
            <Label>{t("ws.mkt.form.tone", lang)}</Label>
            <div className="mt-1.5 flex gap-2 flex-wrap">
              {TONES.map((tn) => (
                <button key={tn.id} type="button" onClick={() => setTone(tn.id)} className={"flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs " + (tone === tn.id ? "border-primary ring-1 ring-primary/40" : "hover:border-primary/40")}>
                  <span className={"h-3 w-3 rounded-full " + tn.swatch} /> {t("ws.mkt.tone." + tn.id, lang)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>{t("ws.mkt.form.size", lang)}</Label>
            <div className="mt-1.5 flex gap-2 flex-wrap">
              {SIZES.map((s) => (
                <button key={s.id} type="button" onClick={() => setSize(s.id)} className={"rounded-lg border px-2.5 py-1.5 text-xs " + (size === s.id ? "border-primary ring-1 ring-primary/40" : "hover:border-primary/40")}>
                  {t("ws.mkt.size." + s.id, lang)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>{t("ws.mkt.form.style", lang)}</Label>
            <div className="mt-1.5 flex gap-2 flex-wrap">
              {[["poster", "ws.mkt.form.style-poster"], ["photo", "ws.mkt.form.style-photo"]].map(([v, label]) => (
                <button key={v} type="button" onClick={() => setVisual(v)} className={"rounded-lg border px-2.5 py-1.5 text-xs " + (visual === v ? "border-primary ring-1 ring-primary/40" : "hover:border-primary/40")}>
                  {t(label, lang)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>{t("ws.mkt.form.variants", lang)}</Label>
            <div className="mt-1.5 flex gap-2">
              {["1", "2", "4"].map((c) => (
                <button key={c} type="button" onClick={() => setCount(c)} className={"rounded-lg border px-3 py-1.5 text-xs " + (count === c ? "border-primary ring-1 ring-primary/40" : "hover:border-primary/40")}>
                  {c} {c === "1" ? t("ws.mkt.form.poster", lang) : t("ws.mkt.form.posters", lang)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>{t("ws.mkt.form.ref-asset", lang)}</Label>
            <label className="mt-1.5 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground hover:bg-accent/40">
              <Upload className="h-4 w-4" /> {uploading ? t("ws.ctrl.uploading", lang) : assetUrl ? "✓ " + assetUrl.split("/").pop() : t("ws.mkt.form.upload-image", lang)}
              <input type="file" accept="image/*" className="hidden" onChange={onAsset} disabled={uploading} />
            </label>
          </div>
          {result?.url && (
            <div className="rounded-lg border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.url} alt={t("ws.mkt.form.alt-generated", lang)} className="w-full rounded-md border" />
            </div>
          )}
          {result?.error && <p className="text-xs text-destructive">{result.error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("ws.mkt.form.close", lang)}</Button>
          <Button data-testid="poster-generate" disabled={!title.trim() || busy} onClick={generate}>
            <Sparkles className="h-4 w-4 mr-1.5" /> {busy ? t("ws.mkt.form.generating", lang) : t("ws.mkt.form.generate-poster", lang)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ScriptForm() {
  const lang = useLang();
  const { pending, open, setOpen, run } = useForm();
  const [title, setTitle] = useState(""); const [platform, setPlatform] = useState("TIKTOK"); const [hook, setHook] = useState(""); const [body, setBody] = useState(""); const [tone, setTone] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
        {t("ws.mkt.form.new-script", lang)}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("ws.mkt.form.new-script-title", lang)}</DialogTitle>
          <DialogDescription>{t("ws.mkt.form.new-script-desc", lang)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>{t("ws.mkt.form.name", lang)}</Label><Input data-testid="script-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("ws.mkt.form.title-placeholder", lang)} className="mt-1.5" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t("ws.mkt.form.platform", lang)}</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v ?? "TIKTOK")}><SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="TIKTOK">TikTok</SelectItem><SelectItem value="REELS">Reels</SelectItem><SelectItem value="YT_SHORTS">YT Shorts</SelectItem></SelectContent></Select>
            </div>
            <div><Label>{t("ws.mkt.form.tone", lang)}</Label><Input value={tone} onChange={(e) => setTone(e.target.value)} placeholder={t("ws.mkt.form.tone-placeholder", lang)} className="mt-1.5" /></div>
          </div>
          <div><Label>{t("ws.mkt.form.hook", lang)}</Label><Input data-testid="script-hook" value={hook} onChange={(e) => setHook(e.target.value)} placeholder={t("ws.mkt.form.hook-placeholder", lang)} className="mt-1.5" /></div>
          <div><Label>{t("ws.mkt.form.script-body", lang)}</Label><Textarea data-testid="script-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("ws.mkt.form.body-placeholder", lang)} className="mt-1.5" rows={5} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("ws.mkt.form.cancel", lang)}</Button>
          <Button data-testid="script-submit" disabled={!title || !body || pending} onClick={() => run(
            () => createScript({ title, platform, hook: hook || undefined, body, tone: tone || undefined }),
            t("ws.mkt.form.script-added", lang)
          )}>{t("ws.mkt.form.add-script", lang)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
