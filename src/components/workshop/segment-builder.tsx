"use client";

// MKT-005..012: campaign segment builder.
// Replaces the old five-option audience dropdown (ALL / NEW / 30_DAYS / 60_DAYS /
// OVERDUE) with composable conditions, and shows the real reach instead of the
// global "customers due" number the calendar page used to show for every campaign.
import { useState, useTransition } from "react";
import { Plus, Users, X } from "lucide-react";
import { previewAudienceCount } from "@/actions/marketing";
import type { AudienceRules } from "@/modules/marketing/audience";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";

type ConditionType =
  | "tags" | "models" | "tiers"
  | "lastServiceWithinDays" | "inactiveForDays" | "joinedWithinDays"
  | "motorcycleOwned" | "overdueService" | "requireMarketingConsent";

const NUMERIC: ConditionType[] = ["lastServiceWithinDays", "inactiveForDays", "joinedWithinDays"];
const LIST: ConditionType[] = ["tags", "models", "tiers"];
const FLAG: ConditionType[] = ["motorcycleOwned", "overdueService", "requireMarketingConsent"];

const DEFAULTS: Record<ConditionType, unknown> = {
  tags: "", models: "", tiers: "",
  lastServiceWithinDays: 30, inactiveForDays: 90, joinedWithinDays: 30,
  motorcycleOwned: true, overdueService: true, requireMarketingConsent: true,
};

const LABEL: Record<ConditionType, string> = {
  tags: "ws.mkt.seg.tags", models: "ws.mkt.seg.models", tiers: "ws.mkt.seg.tiers",
  lastServiceWithinDays: "ws.mkt.seg.lastService", inactiveForDays: "ws.mkt.seg.inactive",
  joinedWithinDays: "ws.mkt.seg.joined", motorcycleOwned: "ws.mkt.seg.owned",
  overdueService: "ws.mkt.seg.overdue", requireMarketingConsent: "ws.mkt.seg.consent",
};

const ALL_TYPES: ConditionType[] = [...LIST, ...NUMERIC, ...FLAG];

function parseList(v: unknown): string {
  return Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : "";
}
function toList(v: string): string[] | undefined {
  const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

export function SegmentBuilder({ value, onChange }: { value: AudienceRules; onChange: (r: AudienceRules) => void }) {
  const lang = useLang();
  const [pending, start] = useTransition();
  const [reach, setReach] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = ALL_TYPES.filter((k) => {
    const v = (value as Record<string, unknown>)[k];
    return v !== undefined && v !== null && v !== "";
  });

  const set = (k: ConditionType, v: unknown) => {
    setReach(null);
    const next = { ...value } as Record<string, unknown>;
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) delete next[k];
    else next[k] = v;
    onChange(next as AudienceRules);
  };

  const add = (k: ConditionType) => set(k, DEFAULTS[k]);
  const available = ALL_TYPES.filter((k) => !active.includes(k));

  const preview = () =>
    start(async () => {
      setError(null);
      try {
        setReach(await previewAudienceCount(value));
      } catch {
        setError(t("ws.mkt.seg.error", lang));
      }
    });

  return (
    <div data-tut="segment-builder" className="rounded-xl border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("ws.mkt.seg.title", lang)}</span>
        {available.length > 0 && (
          <Select value="" onValueChange={(v) => v && add(v as ConditionType)}>
            <SelectTrigger data-testid="segment-add" className="h-7 w-auto gap-1 border-dashed px-2 text-[11px]">
              <Plus className="h-3 w-3" /><SelectValue placeholder={t("ws.mkt.seg.add", lang)} />
            </SelectTrigger>
            <SelectContent>
              {available.map((k) => <SelectItem key={k} value={k}>{t(LABEL[k], lang)}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {active.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">{t("ws.mkt.seg.none", lang)}</p>
      )}

      <div className="mt-2 space-y-2">
        {active.map((k) => {
          const v = (value as Record<string, unknown>)[k];
          return (
            <div key={k} className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5">
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{t(LABEL[k], lang)}</span>

              {LIST.includes(k) && (
                <Input
                  data-testid={"segment-" + k}
                  value={parseList(v)}
                  onChange={(e) => set(k, toList(e.target.value) as unknown)}
                  placeholder={t("ws.mkt.seg.comma", lang)}
                  className="h-7 w-40 text-xs"
                />
              )}

              {NUMERIC.includes(k) && (
                <div className="flex items-center gap-1">
                  <Input
                    data-testid={"segment-" + k}
                    type="number" min={1}
                    value={String(v ?? "")}
                    onChange={(e) => set(k, e.target.value ? Number(e.target.value) : undefined)}
                    className="h-7 w-20 text-xs"
                  />
                  <span className="text-[11px] text-muted-foreground">{t("ws.mkt.seg.days", lang)}</span>
                </div>
              )}

              {FLAG.includes(k) && (
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <input
                    data-testid={"segment-" + k}
                    type="checkbox"
                    checked={v === true}
                    onChange={(e) => set(k, e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--primary)]"
                  />
                  {v ? t("ws.mkt.seg.yes", lang) : t("ws.mkt.seg.no", lang)}
                </label>
              )}

              <button type="button" onClick={() => set(k, undefined)} aria-label={t("ws.mkt.seg.remove", lang)} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {active.some((k) => k === "requireMarketingConsent") && (
        <p className="mt-2 text-[11px] text-muted-foreground">{t("ws.mkt.seg.consent-hint", lang)}</p>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          data-testid="segment-preview"
          onClick={preview}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
        >
          <Users className="h-3 w-3" />
          {pending ? t("ws.mkt.seg.loading", lang) : t("ws.mkt.seg.preview", lang)}
        </button>
        {reach !== null && (
          <span data-testid="segment-reach" className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
            {tpl("ws.mkt.seg.reach", lang, { n: reach })}
          </span>
        )}
        {error && <span className="text-[11px] text-destructive">{error}</span>}
      </div>
    </div>
  );
}
