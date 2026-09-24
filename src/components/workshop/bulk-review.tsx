"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronRight, Download, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";
import {
  applySetupSession, cancelSetupSession, saveSetupDecisions, type SheetColumnMeta,
} from "@/actions/bulk";
import { rowKeyOf, type RowPlan } from "@/modules/bulk/diff";

/**
 * 改动审核台（P2 + P3）。
 *
 * P3 之后这一屏是**接着会话干活**的：决定存在服务器上，关掉页面回来还在。
 * 与上一版的三处不同：
 *   ① 决定与「就地修改」合成一个对象，改完**自动存回**（600ms 合并一次，不是每次按键都打服务器）；
 *   ② 顶部显示**上次保存于** —— 老板要能确信「我批的这些没丢」；
 *   ③ 已应用/已取消的会话打开时**只读**（终态不许再改，历史才可信）。
 *
 * 与 Excel 端一致的语义（界面不发明新规则）：
 *   · 输入框留空 = 不动（占位文字显示库里现在的值）
 *   · 出错的行不能被批准
 *   · 只有批准的行才会写库
 */

type Decision = { decision?: "approved" | "declined"; edits?: Record<string, string> };

interface Props {
  sessionId: string;
  fileName: string;
  uploadedAt: string;
  status: "DRAFT" | "APPLIED" | "CANCELLED";
  plans: RowPlan[];
  decisions: Record<string, Decision>;
  columns: Record<string, SheetColumnMeta[]>;
  sheets: { key: string; title: string }[];
  /** 每张表库里有多少行 —— 用来对照「文件里少了几行」，并把「不会删除」讲清楚 */
  existingCounts: Record<string, number>;
  onChanged: () => void;
}

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  return '"' + s.split('"').join('""') + '"';
}

export function BulkReview(props: Props) {
  const lang = useLang();
  const [pending, start] = useTransition();
  const [decisions, setDecisions] = useState<Record<string, Decision>>(props.decisions ?? {});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const dirty = useRef(false);
  const readOnly = props.status !== "DRAFT";

  // 改完自动存回（合并 600ms 内的连续修改）
  useEffect(() => {
    if (!dirty.current || readOnly) return;
    const timer = setTimeout(() => {
      setSaveState("saving");
      void saveSetupDecisions({ sessionId: props.sessionId, decisions }).then((res) => {
        if (res.ok) {
          setSaveState("saved");
          setSavedAt(new Date().toLocaleTimeString());
          dirty.current = false;
        } else {
          setSaveState("error");
          toast.error(res.error);
        }
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [decisions, props.sessionId, readOnly]);

  const actionable = props.plans.filter((p) => p.action !== "skip");
  const hasError = (p: RowPlan) => p.action === "error";
  const decisionOf = (p: RowPlan) => decisions[rowKeyOf(p.sheet, p.rowNumber)] ?? {};
  const approved = actionable.filter((p) => decisionOf(p).decision === "approved" && !hasError(p));

  const setDecision = (p: RowPlan, d: "approved" | "declined") => {
    dirty.current = true;
    setDecisions((prev) => {
      const k = rowKeyOf(p.sheet, p.rowNumber);
      const cur = prev[k] ?? {};
      return { ...prev, [k]: { ...cur, decision: cur.decision === d ? undefined : d } };
    });
  };

  const bulk = (mode: "approved" | "declined") => {
    dirty.current = true;
    setDecisions((prev) => {
      const next = { ...prev };
      for (const p of actionable) {
        const k = rowKeyOf(p.sheet, p.rowNumber);
        const cur = next[k] ?? {};
        // 「批准没出错的」不会把出错的行也批了
        if (mode === "approved" && hasError(p)) continue;
        next[k] = { ...cur, decision: mode };
      }
      return next;
    });
  };

  const setEdit = (p: RowPlan, field: string, value: string) => {
    dirty.current = true;
    setDecisions((prev) => {
      const k = rowKeyOf(p.sheet, p.rowNumber);
      const cur = prev[k] ?? {};
      return { ...prev, [k]: { ...cur, edits: { ...(cur.edits ?? {}), [field]: value } } };
    });
  };

  const valueOf = (p: RowPlan, c: SheetColumnMeta): string => {
    const edited = decisionOf(p).edits?.[c.field];
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
      const res = await applySetupSession({ sessionId: props.sessionId });
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
      const refused = res.refused?.length ?? 0;
      setSummary(
        t("bulk.applied", lang) + ": +" + total.created + " / ~" + total.updated + " / -" + total.deleted +
        (total.deactivated ? " (" + total.deactivated + " " + t("bulk.deactivated", lang) + ")" : "") +
        (refused ? " | " + refused + " " + t("bulk.refused-short", lang) : ""),
      );
      toast.success(t("bulk.applied", lang));
      props.onChanged();
    });

  const cancel = () =>
    start(async () => {
      const res = await cancelSetupSession({ sessionId: props.sessionId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("bulk.cancelled", lang));
      props.onChanged();
    });

  /** 导出本次变更清单（给会计/老板看的那种）——纯客户端，不动服务器 */
  const exportCsv = () => {
    const lines: string[] = [["sheet", "action", "key", "field", "before", "after"].map(csvCell).join(",")];
    for (const p of approved) {
      if (p.changes.length === 0) {
        lines.push([p.sheet, p.action, p.key, "", "", ""].map(csvCell).join(","));
        continue;
      }
      for (const c of p.changes) {
        lines.push([p.sheet, p.action, p.key, c.field, oldValueOf(p, c.field), String(c.to ?? "")].map(csvCell).join(","));
      }
    }
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-changes-" + props.uploadedAt.slice(0, 10) + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const chip = (label: string, tone: string) => (
    <span className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + tone}>{label}</span>
  );

  const saveLabel =
    saveState === "saving" ? t("bulk.saving", lang)
    : saveState === "saved" ? t("bulk.saved-at", lang) + " " + (savedAt ?? "")
    : saveState === "error" ? t("bulk.save-failed", lang)
    : "";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card px-4 py-3">
        <span className="text-sm font-semibold">{props.fileName}</span>
        {readOnly
          ? chip(
              props.status === "APPLIED" ? t("bulk.status-applied", lang) : t("bulk.status-cancelled", lang),
              props.status === "APPLIED" ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground",
            )
          : chip(t("bulk.status-draft", lang), "bg-amber-500/10 text-amber-700")}
        {chip(approved.length + " " + t("bulk.approved", lang), "bg-emerald-500/10 text-emerald-700")}
        {chip(actionable.length - approved.length + " " + t("bulk.not-decided", lang), "bg-muted text-muted-foreground")}
        {saveLabel && <span className="text-[11px] text-muted-foreground">{saveLabel}</span>}
        <span className="flex-1" />
        {!readOnly && (
          <>
            <Button size="sm" variant="outline" onClick={() => bulk("approved")} disabled={pending}>
              {t("bulk.approve-clean", lang)}
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulk("declined")} disabled={pending}>
              {t("bulk.decline-all", lang)}
            </Button>
          </>
        )}
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={approved.length === 0}>
          <Download className="h-4 w-4" /> {t("bulk.export-changes", lang)}
        </Button>
        {!readOnly && (
          <>
            <Button size="sm" variant="ghost" onClick={cancel} disabled={pending}>
              {t("bulk.cancel-import", lang)}
            </Button>
            <Button size="sm" onClick={apply} disabled={pending || approved.length === 0}>
              {t("bulk.apply-approved", lang) + " (" + approved.length + ")"}
            </Button>
          </>
        )}
      </div>

      {summary && (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-xs font-medium text-emerald-800">
          {summary}
        </div>
      )}

      {props.sheets.map((sheet) => {
        const rows = actionable.filter((p) => p.sheet === sheet.key);
        if (rows.length === 0) return null;
        const cols = props.columns[sheet.key] ?? [];
        const skips = props.plans.filter((p) => p.sheet === sheet.key && p.action === "skip").length;
        const fileRows = props.plans.filter((p) => p.sheet === sheet.key).length;
        const dbRows = props.existingCounts[sheet.key] ?? 0;
        const missing = dbRows - fileRows;
        return (
          <div key={sheet.key} className="rounded-2xl border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
              <span className="font-semibold">{sheet.title}</span>
              <span className="text-muted-foreground">
                {rows.length} {t("bulk.rows-to-decide", lang)} · {skips} {t("bulk.nochange", lang)}
              </span>
              <span className="text-muted-foreground">
                {t("bulk.rows-in-file", lang) + " " + fileRows} · {t("bulk.rows-in-db", lang) + " " + dbRows}
              </span>
            </div>
            {missing > 0 && (
              // 老板删了一行却「什么都没发生」—— 因为规则是「文件里没有的行不删」，
              // 而没人告诉过他。这里把数字和规则直接摆出来。
              <div className="flex items-start gap-2 border-b bg-amber-500/5 px-4 py-2 text-xs text-amber-800">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {missing} {t("bulk.missing-rows", lang)}
                </span>
              </div>
            )}
            <div className="divide-y">
              {rows.slice(0, 200).map((p) => {
                const k = rowKeyOf(p.sheet, p.rowNumber);
                const d = decisionOf(p);
                const expanded = open[k] ?? (p.action === "error" || p.changes.length > 0 || p.action === "create");
                return (
                  <div key={k} className={d.decision === "declined" ? "opacity-45" : ""}>
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
                      {!readOnly && (
                        <>
                          <Button
                            size="sm" variant="ghost" disabled={pending || hasError(p)}
                            onClick={() => setDecision(p, "approved")}
                            title={hasError(p) ? t("bulk.fix-first", lang) : t("bulk.approve", lang)}
                          >
                            <Check className={"h-4 w-4 " + (d.decision === "approved" ? "text-emerald-600" : "text-muted-foreground")} />
                          </Button>
                          <Button
                            size="sm" variant="ghost" disabled={pending}
                            onClick={() => setDecision(p, "declined")} title={t("bulk.decline", lang)}
                          >
                            <X className={"h-4 w-4 " + (d.decision === "declined" ? "text-destructive" : "text-muted-foreground")} />
                          </Button>
                        </>
                      )}
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
                                  disabled={pending || readOnly}
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
                                  disabled={pending || readOnly}
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
              {rows.length > 200 && (
                <div className="px-4 py-2 text-xs text-muted-foreground">… {rows.length - 200} {t("bulk.more-rows", lang)}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
