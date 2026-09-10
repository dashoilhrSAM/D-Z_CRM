"use client";

// The content studio: the whole workflow in one place.
//
//   1. describe what you want  →  2. review a batch of candidate scripts  →
//   3. pick one  →  4. expand it into captions and poster lines  →  5. render the poster
//
// Steps 2-5 are intentionally manual — the operator filters, nothing auto-publishes.
import { useState } from "react";
import { Sparkles, Check, Loader2, Image as ImageIcon, Copy, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";

interface Candidate {
  id: string; angle: string; title: string; hook: string; body: string; cta: string;
  score: number | null; reasoning: string; includeProduct: boolean; productSku: string | null;
}
interface Expanded {
  caption: string; hashtags: string[];
  versions: { platform: string; caption: string; note?: string }[];
  posterScene: string;
  posterText: { headline: string; sub?: string; productLine?: string; specsLine?: string; cta?: string };
  publishNote: string;
}

export function ContentStudio({ brands, occasions }: { brands: string[]; occasions: { key: string; name: string }[] }) {
  const lang = useLang();
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState("TIKTOK");
  const [language, setLanguage] = useState("ms");
  const [brandKey, setBrandKey] = useState(brands[0] ?? "DZ_WORKSHOP");
  const [occasionKey, setOccasionKey] = useState("");
  const [count, setCount] = useState("6");
  const [includeProduct, setIncludeProduct] = useState(false);
  const [useTrends, setUseTrends] = useState(true);

  const [busy, setBusy] = useState<"" | "candidates" | "expand" | "poster">("");
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [batchId, setBatchId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [expanded, setExpanded] = useState<Expanded | null>(null);
  const [posterUrl, setPosterUrl] = useState("");
  const [posterCheck, setPosterCheck] = useState<{ ok: boolean; missing: string[]; readError?: string; retried: boolean; transcribed?: string } | null>(null);
  const [copied, setCopied] = useState("");

  async function call(payload: Record<string, unknown>) {
    const res = await fetch("/api/marketing/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  const generate = async () => {
    setBusy("candidates"); setError(""); setExpanded(null); setPosterUrl(""); setSelectedId("");
    try {
      const d = await call({
        action: "candidates", topic, platform, language, brandKey,
        occasionKey: occasionKey || undefined,
        count: Number(count) || 6, includeProduct, useTrends,
      });
      setCandidates(d.candidates);
      setBatchId(d.batchId);
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  };

  const pick = async (id: string) => {
    setBusy("expand"); setError(""); setSelectedId(id); setPosterUrl("");
    try {
      await call({ action: "select", id });
      const d = await call({ action: "expand", id, platforms: ["TIKTOK", "INSTAGRAM", "FACEBOOK", "WHATSAPP"] });
      setExpanded(d.expanded);
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  };

  const renderPoster = async (size: string) => {
    if (!selectedId) return;
    setBusy("poster"); setError(""); setPosterCheck(null);
    try {
      const d = await call({ action: "poster", id: selectedId, size });
      setPosterUrl(d.url);
      setPosterCheck(d.verification ? { ...d.verification, retried: Boolean(d.retried) } : null);
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  };

  const discard = async () => {
    if (!batchId) return;
    setBusy("candidates");
    try {
      await call({ action: "discard", batchId });
      setCandidates([]); setExpanded(null); setPosterUrl(""); setSelectedId("");
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  };

  const copy = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(""), 1600); } catch { /* clipboard blocked */ }
  };

  const inputCls = "mt-1.5";

  return (
    <div className="space-y-4" data-tut="content-studio">
      {/* ---------- 1. brief ---------- */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" /> {t("ws.mkt.studio.brief", lang)}</div>
        <div className="mt-3 space-y-3">
          <div>
            <Label>{t("ws.mkt.studio.topic", lang)}</Label>
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t("ws.mkt.studio.topic-placeholder", lang)} className={inputCls} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><Label>{t("ws.mkt.studio.brand", lang)}</Label>
              <Select value={brandKey} onValueChange={(v) => setBrandKey(v ?? brandKey)}><SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
                <SelectContent>{brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>{t("ws.mkt.studio.platform", lang)}</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v ?? platform)}><SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
                <SelectContent>{["TIKTOK", "INSTAGRAM", "FACEBOOK", "WHATSAPP"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>{t("ws.mkt.studio.language", lang)}</Label>
              <Select value={language} onValueChange={(v) => setLanguage(v ?? language)}><SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
                <SelectContent>{[["ms", "Bahasa Malaysia"], ["en", "English"], ["zh", "中文"]].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>{t("ws.mkt.studio.count", lang)}</Label>
              <Select value={count} onValueChange={(v) => setCount(v ?? count)}><SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
                <SelectContent>{["4", "6", "8", "10", "12"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>{t("ws.mkt.studio.occasion", lang)}</Label>
              <Select value={occasionKey || "auto"} onValueChange={(v) => setOccasionKey(v === "auto" ? "" : (v ?? ""))}><SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t("ws.mkt.studio.occasion-auto", lang)}</SelectItem>
                  {occasions.map((o) => <SelectItem key={o.key} value={o.key}>{o.name}</SelectItem>)}
                </SelectContent></Select></div>
            <div className="flex items-end gap-4 pb-1">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeProduct} onChange={(e) => setIncludeProduct(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
                {t("ws.mkt.studio.include-product", lang)}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={useTrends} onChange={(e) => setUseTrends(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
                {t("ws.mkt.studio.use-trends", lang)}
              </label>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="studio-generate" onClick={generate} disabled={busy !== ""}>
              {busy === "candidates" ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {t("ws.mkt.studio.working", lang)}</> : <><Wand2 className="mr-1.5 h-4 w-4" /> {t("ws.mkt.studio.generate", lang)}</>}
            </Button>
            {candidates.length > 0 && (
              <Button variant="outline" onClick={discard} disabled={busy !== ""}><Trash2 className="mr-1.5 h-4 w-4" /> {t("ws.mkt.studio.discard", lang)}</Button>
            )}
            <span className="text-[11px] text-muted-foreground">{t("ws.mkt.studio.manual-note", lang)}</span>
          </div>
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
        </div>
      </div>

      {/* ---------- 2. candidates ---------- */}
      {candidates.length > 0 && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="text-sm font-semibold">{t("ws.mkt.studio.candidates", lang).replace("{n}", String(candidates.length))}</div>
          <div className="mt-3 grid gap-2.5 lg:grid-cols-2">
            {candidates.map((c) => (
              <button
                key={c.id}
                data-testid={"candidate-" + c.id}
                onClick={() => pick(c.id)}
                disabled={busy !== ""}
                className={cn(
                  "rounded-xl border p-3 text-left transition-colors",
                  selectedId === c.id ? "border-primary ring-1 ring-primary/40 bg-primary/5" : "hover:border-primary/40",
                  busy !== "" && selectedId !== c.id && "opacity-60",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{c.angle}</span>
                  <span className="flex items-center gap-1.5">
                    {c.includeProduct && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{c.productSku ?? "product"}</span>}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold">{c.score ?? "-"}</span>
                    {selectedId === c.id && <Check className="h-3.5 w-3.5 text-primary" />}
                  </span>
                </div>
                {c.hook && <p className="mt-2 text-sm font-medium">{c.hook}</p>}
                <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{c.body}</p>
                {c.reasoning && <p className="mt-2 text-[11px] italic text-muted-foreground/80">{c.reasoning}</p>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---------- 3. expansion ---------- */}
      {busy === "expand" && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("ws.mkt.studio.expanding", lang)}</div>}

      {expanded && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="text-sm font-semibold">{t("ws.mkt.studio.expanded", lang)}</div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {expanded.versions.map((v) => (
              <div key={v.platform} className="rounded-xl border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wide">{v.platform}</span>
                  <button onClick={() => copy(v.caption + "\n\n" + expanded.hashtags.join(" "), v.platform)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                    <Copy className="h-3 w-3" /> {copied === v.platform ? t("ws.mkt.studio.copied", lang) : t("ws.mkt.studio.copy", lang)}
                  </button>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-xs">{v.caption}</p>
                {v.note && <p className="mt-2 text-[11px] text-muted-foreground">{v.note}</p>}
              </div>
            ))}
          </div>

          {expanded.hashtags.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("ws.mkt.studio.hashtags", lang)}</span>
                <button onClick={() => copy(expanded.hashtags.join(" "), "tags")} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                  <Copy className="h-3 w-3" /> {copied === "tags" ? t("ws.mkt.studio.copied", lang) : t("ws.mkt.studio.copy", lang)}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-primary">{expanded.hashtags.join(" ")}</p>
            </div>
          )}

          {expanded.publishNote && <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">{expanded.publishNote}</p>}
        </div>
      )}

      {/* ---------- 4. poster ---------- */}
      {expanded && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{t("ws.mkt.studio.poster", lang)}</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={() => renderPoster("SQUARE")} disabled={busy !== ""}>1:1</Button>
              <Button size="sm" variant="outline" onClick={() => renderPoster("STORY")} disabled={busy !== ""}>9:16</Button>
              <Button size="sm" variant="outline" onClick={() => renderPoster("BANNER")} disabled={busy !== ""}>16:9</Button>
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-1 space-y-1.5 text-xs">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("ws.mkt.studio.poster-lines", lang)}</div>
              <div className="rounded-lg border p-2.5 space-y-1">
                <div className="font-bold">{expanded.posterText.headline}</div>
                {expanded.posterText.sub && <div className="text-amber-600 dark:text-amber-400">{expanded.posterText.sub}</div>}
                {expanded.posterText.productLine && <div>{expanded.posterText.productLine}</div>}
                {expanded.posterText.specsLine && <div className="text-emerald-600 dark:text-emerald-400">{expanded.posterText.specsLine}</div>}
              </div>
              {expanded.posterScene && <p className="text-[11px] text-muted-foreground">{expanded.posterScene}</p>}
            </div>

            <div className="sm:col-span-2">
              {busy === "poster" ? (
                <div className="flex h-64 items-center justify-center gap-2 rounded-xl border text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("ws.mkt.studio.rendering", lang)}
                </div>
              ) : posterUrl ? (
                <div className="space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={posterUrl} alt={t("ws.mkt.studio.poster", lang)} className="w-full rounded-xl border" />

                  {posterCheck && !posterCheck.ok && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      {posterCheck.readError
                        ? t("ws.mkt.studio.check-unreadable", lang)
                        : t("ws.mkt.studio.check-missing", lang).replace("{words}", posterCheck.missing.join(", "))}
                      {posterCheck.retried ? " " + t("ws.mkt.studio.check-retried", lang) : ""}
                    </p>
                  )}
                  {posterCheck?.ok && (
                    <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                      {t("ws.mkt.studio.check-ok", lang)}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <a href={posterUrl} download className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                      <ImageIcon className="h-3.5 w-3.5" /> {t("ws.mkt.studio.download", lang)}
                    </a>
                    {posterCheck?.transcribed && (
                      <a href={posterUrl} target="_blank" rel="noreferrer" className="text-[11px] text-muted-foreground hover:text-foreground">
                        {t("ws.mkt.studio.open-full", lang)}
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-64 items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">
                  {t("ws.mkt.studio.poster-empty", lang)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {candidates.length === 0 && expanded === null && (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">{t("ws.mkt.studio.empty", lang)}</div>
      )}
    </div>
  );
}
