"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronRight, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";
import { applySetupImport, type PreviewResult, type SheetColumnMeta } from "@/actions/bulk";
import type { RowPlan } from "@/modules/bulk/diff";

/**
 * 改动审核台（P2）。
 *
 * 这一屏是老板要的那件事：**上传之后不是只有「全部应用」一个按钮** ——
 * 每一行可以 批准 / 拒绝 / 就地修改，出错的改对就能批，改错了不用回 Excel。
 *
 * 三条与 Excel 端一致的语义（界面不发明新规则）：
 *   · 输入框留空 = **不动**（不是清成 0）—— 空白处的占位文字显示库里现在的值
 *   · 出错的行**不能被批准**（要么改对、要么拒绝）
 *   · 只有你批准的行才会写库
 */

type Decision = "approved" | "declined";

export function BulkReview({ preview, onDone }: { preview: PreviewResult; onDone: () => void }) {
  const lang = useLang();
  const [pending, start] = useTransition();
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [refused, setRefused] = useState<{ sheet: string; key: string; fields: string[] }[] | null>(null);

  const rowKey = (p: RowPlan) => p.sheet + "#" + p.rowNumber;
  const hasError = (p: RowPlan) => p.action === "error";
  const actionable = preview.plans.filter((p) => p.action !== "skip");
  const approved = actionable.filter((p) => decisions[rowKey(p)] === "approved" && !hasError(p));

  const setDecision = (p: RowPlan, d: Decision) =>
    setDecisions((prev) => ({ ...prev, [rowKey(p)]: prev[rowKey(p)] === d ? "declined" : d })) as never;

  const bulk = (d: Decision | "clean") =>
    setDecisions((prev) => {
      const next = { ...prev };
      for (const p of actionable) {
        if (d === "clean") next[rowKey(p)] = hasError(p) ? next[rowKey(p)] : "approved";
        else next[rowKey(p)] = hasError(p) && d === "approved" ? next[rowKey(p)] : d;
      }
      return next;
    });

  const setEdit = (p: RowPlan, field: string, value: string) =>
    setEdits((prev) => ({ ...prev, [rowKey(p)]: { ...(prev[rowKey(p)] ?? {}), [field]: value } }));

  const valueOf = (p: RowPlan, c: SheetColumnMeta): string => {
    const edited = edits[rowKey(p)]?.[c.field];
    if (edited !== undefined) return edited;
    const v = p.values[c.field];
    if (v === undefined || v === null) return "";
    if (c.type === "money" && typeof v === "number") return String(v / 100);
    return String(v);
  };
  const oldValueOf = (p: RowPlan, field: string): string => {
    const c = p.changes.find((x) => x.field === field);
    if (!c || c.from === null || c.from === undefined) return "";
    return typeof c.from === "number" && field.toLowerCase().includes("sen") ? String(c.from / 100) : String(c.from);
  };

  const apply = () =>
    start(async () => {
      // 只送**已批准**的行；界面里「就地修改」的原始值单独送出（由服务端解析 + 复验）
      const plans = approved;
      const editsOut: Record<string, Record<string, unknown>> = {};
      for (const p of approved) {
        const edited = edits[rowKey(p)];
        if (edited && Object.keys(edited).length > 0) editsOut[rowKey(p)] = edited;
      }
      const res = await applySetupImport({ plans, branchId: preview.branchId, edits: editsOut });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const total = Object.values(res.summary).reduce(
        (a, s) => ({
          created: a.created + s.created, updated: a.updated + s.updated,
          deleted: a.deleted + s.deleted, deactivated: a.deactivated + s.deactivated,
        }),
        { created: 0, updated: 0, deleted: 0, deactivated: 0 },
      );
      toast.success(
        t("bulk.applied", lang) + ": +" + total.created + " / ~" + total.updated + " / -" + total.deleted,
      );
      setRefused(res.refused ?? []);
      onDone();
    });

  const chip = (label: string, tone: string) => (
    <span className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + tone}>{label}</span>
  );

  return (
    <div className="space-y-3">
      {/* 顶部：读数 + 批量 + 应用 */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card px-4 py-3">
        <span className="text-sm font-semibold">{t("bulk.review-title", lang)}</span>
        {chip(approved.length + " " + t("bulk.approved", lang), "bg-emerald-500/10 text-emerald-700")}
        {chip(actionable.length - approved.length + " " + t("bulk.not-decided", lang), "bg-muted text-muted-foreground")}
        <span className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => bulk("approved")} disabled={pending}>{t("bulk.approve-clean", lang)}</Button>
        <Button size="sm" variant="outline" onClick={() => bulk("declined")} disabled={pending}>{t("bulk.decline-all", lang)}</Button>
        <Button size="sm" onClick={apply} disabled={pending || approved.length === 0}>
          {t("bulk.apply-approved", lang) + " (" + approved.length + ")"}
        </Button>
      </div>

      {refused && refused.length > 0 && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs">
          <p className="font-medium text-destructive">{t("bulk.refused-title", lang)}</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {refused.map((r, i) => (
              <li key={i}>· {r.key}: {r.fields.join("; ")}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 逐张 sheet */}
      {preview.sheets.map((sheet) => {
        const rows = actionable.filter((p) => p.sheet === sheet.key);
        if (!sheet.found) {
          return (
            <div key={sheet.key} className="rounded-2xl border bg-card px-4 py-3 text-xs">
              <span className="font-medium">{sheet.title}</span>
              <span className="ml-2 text-muted-foreground">{t("bulk.sheet-missing", lang)}</span>
            </div>
          );
        }
        if (rows.length === 0) return null;
        const cols = preview.columns[sheet.key] ?? [];
        return (
          <div key={sheet.key} className="rounded-2xl border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
              <span className="font-semibold">{sheet.title}</span>
              <span className="text-muted-foreground">
                {rows.length} {t("bulk.rows-to-decide", lang)} · {sheet.summary.skip} {t("bulk.nochange", lang)}
              </span>
            </div>
            <div className="divide-y">
              {rows.slice(0, 200).map((p) => {
                const k = rowKey(p);
                const decision = decisions[k];
                const expanded = open[k] ?? (p.action === "error" || p.changes.length > 0 || p.action === "create");
                return (
                  <div key={k} className={decision === "declined" ? "opacity-45" : ""}>
                    <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                      <button
                        className="text-muted-foreground"
                        onClick={() => setOpen((prev) => ({ ...prev, [k]: !expanded }))}
                        title={t("bulk.toggle", lang)}
                      >
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <span className="min-w-[130px] font-medium">{p.key}</span>
                      {p.action === "create" && chip(t("bulk.create", lang), "bg-emerald-500/10 text-emerald-700")}
                      {p.action === "update" && chip(t("bulk.update", lang), "bg-sky-500/10 text-sky-700")}
                      {p.action === "delete" && chip(t("bulk.delete", lang), "bg-destructive/10 text-destructive")}
                      {p.action === "error" && chip(t("bulk.error", lang), "bg-destructive/15 text-destructive")}
                      {p.action === "error" && (
                        <span className="flex items-center gap-1 text-xs text-destructive">
                          <TriangleAlert className="h-3.5 w-3.5" /> {p.errors.join("; ")}
                        </span>
                      )}
                      <span className="flex-1" />
                      <Button
                        size="sm" variant="ghost" disabled={pending || hasError(p)}
                        onClick={() => setDecision(p, "approved")}
                        title={hasError(p) ? t("bulk.fix-first", lang) : t("bulk.approve", lang)}
                      >
                        <Check className={"h-4 w-4 " + (decision === "approved" ? "text-emerald-600" : "text-muted-foreground")} />
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setDecision(p, "declined")} title={t("bulk.decline", lang)}>
                        <X className={"h-4 w-4 " + (decision === "declined" ? "text-destructive" : "text-muted-foreground")} />
                      </Button>
                    </div>

                    {expanded && (
                      <div className="grid gap-2 px-4 pb-3 sm:grid-cols-2 lg:grid-cols-3">
                        {cols.map((c) => {
                          const changed = p.changes.some((x) => x.field === c.field);
                          const old = oldValueOf(p, c.field);
                          return (
                            <label key={c.field} className="text-xs">
                              <span className={changed ? "font-medium text-sky-700" : "text-muted-foreground"}>
                                {c.zh || c.header}{c.required ? " *" : ""}
                              </span>
                              {c.type === "enum" && c.options ? (
                                <select
                                  className="mt-0.5 h-8 w-full rounded-lg border bg-background px-2"
                                  value={valueOf(p, c)}
                                  disabled={pending}
                                  onChange={(e) => setEdit(p, c.field, e.target.value)}
                                >
                                  <option value="">{old ? "(" + old + ")" : "—"}</option>
                                  {c.options.map((o) => (
                                    <option key={o} value={o}>{o}</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  className="mt-0.5 h-8 w-full rounded-lg border bg-background px-2"
                                  value={valueOf(p, c)}
                                  placeholder={old ? "(" + old + ")" : ""}
                                  disabled={pending}
                                  onChange={(e) => setEdit(p, c.field, e.target.value)}
                                />
                              )}
                              {changed && old !== "" && (
                                <span className="text-[11px] text-muted-foreground">{t("bulk.was", lang) + " " + old}</span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {rows.length > 200 && <div className="px-4 py-2 text-xs text-muted-foreground">… {rows.length - 200} {t("bulk.more-rows", lang)}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
