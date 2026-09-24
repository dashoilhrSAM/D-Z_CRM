"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, History, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";
import {
  exportSetupWorkbook, loadSetupImport, resumeSetupImport, setupSessionHistory, startSetupImport,
  type SheetColumnMeta, type SessionHistoryRow,
} from "@/actions/bulk";
import { BulkReview } from "@/components/workshop/bulk-review";
import type { RowPlan } from "@/modules/bulk/diff";

/**
 * 批量配置（P1 选择性下载 + P2 审核台 + P3 导入会话）。
 *
 * 流程：**挑要下哪几张 → 改 → 传回来 → 逐条 批准/拒绝/修改 → 应用**。
 *
 * P3 之后有一件事与以前不同：**审到一半可以关掉页面**。
 * 打开这一页会自动接上「上次没审完的那一份」（草稿会话存在服务器上）。
 */

interface Desk {
  sessionId: string;
  fileName: string;
  uploadedAt: string;
  status: "DRAFT" | "APPLIED" | "CANCELLED";
  plans: RowPlan[];
  decisions: Record<string, { decision?: "approved" | "declined"; edits?: Record<string, string> }>;
  /** 文件声明包含哪些表（没声明的＝这次不涉及）*/
  declaredSheets: string[] | null;
}

/** 服务端已经把「上次没审完的那一份」读出来了，这里直接接上（客户端不拉、无 effect） */
export interface InitialSession {
  id: string;
  fileName: string;
  uploadedAt: string;
  status: "DRAFT" | "APPLIED" | "CANCELLED";
  plans: RowPlan[];
  decisions: Record<string, { decision?: "approved" | "declined"; edits?: Record<string, string> }>;
  /** 文件声明包含哪些表（没声明的＝这次不涉及）*/
  declaredSheets: string[] | null;
}

export function BulkSetup({
  canDelete,
  branches,
  sheets,
  initialSession,
  initialColumns,
  initialCounts,
  initialHistory,
}: {
  canDelete: boolean;
  branches: { id: string; name: string }[];
  sheets: { key: string; title: string }[];
  initialSession: InitialSession | null;
  initialColumns: Record<string, SheetColumnMeta[]>;
  initialCounts: Record<string, number>;
  /** 导入历史（服务端读好传进来 —— 不用挂载后再拉，也避免 set-state-in-effect） */
  initialHistory: SessionHistoryRow[];
}) {
  const lang = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [desk, setDesk] = useState<Desk | null>(
    initialSession
      ? {
          sessionId: initialSession.id,
          fileName: initialSession.fileName,
          uploadedAt: initialSession.uploadedAt,
          status: initialSession.status,
          plans: initialSession.plans,
          decisions: initialSession.decisions,
          declaredSheets: initialSession.declaredSheets,
        }
      : null,
  );
  const [columns, setColumns] = useState<Record<string, SheetColumnMeta[]>>(initialColumns);
  const [existingCounts, setExistingCounts] = useState<Record<string, number>>(initialCounts);
  const [resumed, setResumed] = useState(initialSession !== null);
  const [file, setFile] = useState<File | null>(null);
  const [downloading, setDownloading] = useState(false);
  // 历史**默认就显示**：原来藏在按钮后面，老板说「也要导入历史记录」—— 它是常规信息，不是隐藏功能
  const [history, setHistory] = useState<SessionHistoryRow[]>(initialHistory);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [selected, setSelected] = useState<string[]>(sheets.map((s) => s.key));
  const [templateOnly, setTemplateOnly] = useState(false);

  /** 接上「上次没审完的那一份」（打开页面时自动做一次） */
  const resume = useCallback(async () => {
    const res = await resumeSetupImport();
    if (!res.ok) return;
    setColumns(res.columns);
    setExistingCounts(res.existingCounts);
    if (res.session) {
      setDesk({
        sessionId: res.session.id,
        fileName: res.session.fileName,
        uploadedAt: res.session.uploadedAt,
        status: res.session.status,
        plans: res.session.plans,
        decisions: res.session.decisions,
        declaredSheets: res.session.declaredSheets,
      });
      setResumed(true);
    }
  }, []);

  // 注意：这里**故意不在 effect 里拉数据** —— 草稿会话由服务端读好传进来（见 page.tsx）。
  // resume() 只在应用/取消之后用（那时机是事件回调，不是 effect）。

  const toggleSheet = (key: string) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const download = async () => {
    setDownloading(true);
    try {
      const res = await exportSetupWorkbook({ branchId, sheets: selected, templateOnly });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  const upload = () => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      const res = await startSetupImport(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setColumns(res.columns);
      setExistingCounts(res.preview.existingCounts);
      setResumed(false);
      setDesk({
        sessionId: res.sessionId,
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
        status: "DRAFT",
        plans: res.preview.plans,
        decisions: {},
        declaredSheets: res.preview.declaredSheets,
      });
      await fetchHistory();
      toast.success(t("bulk.uploaded", lang));
    });
  };

  /** 只取数据，不自己包过渡 —— 这样上传/应用之后也能直接调用它刷新历史 */
  const fetchHistory = async () => {
    const res = await setupSessionHistory();
    if (res.ok) setHistory(res.rows);
  };
  const refreshHistory = () => start(fetchHistory);

  const openSession = (id: string) =>
    start(async () => {
      const res = await loadSetupImport(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setColumns(res.columns);
      setExistingCounts(res.existingCounts);
      setResumed(false);
      setDesk({
        sessionId: res.session.id,
        fileName: res.session.fileName,
        uploadedAt: res.session.uploadedAt,
        status: res.session.status,
        plans: res.session.plans,
        decisions: res.session.decisions,
        declaredSheets: res.session.declaredSheets,
      });
    });

  const onChanged = () => {
    setResumed(false);
    void fetchHistory();
    void resume();
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {/* 1. 挑要下载哪几张 */}
      <div className="rounded-2xl border bg-card p-5 space-y-3">
        <div>
          <h2 className="font-semibold">{t("bulk.step1", lang)}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("bulk.step1-hint", lang)}</p>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {sheets.map((s) => (
            <label key={s.key} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={selected.includes(s.key)}
                disabled={pending || downloading}
                onChange={() => toggleSheet(s.key)}
              />
              {s.title}
            </label>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={templateOnly}
            disabled={pending || downloading}
            onChange={(e) => setTemplateOnly(e.target.checked)}
          />
          {t("bulk.template-only", lang)}
        </label>

        <div className="flex flex-wrap items-center gap-2">
          {branches.length > 1 && (
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              disabled={pending}
              className="h-9 rounded-lg border bg-background px-2 text-sm"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          <Button
            size="sm" variant="outline" onClick={download}
            disabled={downloading || pending || !branchId || selected.length === 0}
          >
            <Download className="h-4 w-4" /> {t("bulk.download", lang) + " (" + selected.length + ")"}
          </Button>
          <Button
            size="sm" variant="ghost" disabled={pending}
            onClick={() => {
              if (historyOpen) {
                setHistoryOpen(false);
              } else {
                setHistoryOpen(true);
                void refreshHistory();
              }
            }}
          >
            <History className="h-4 w-4" /> {t("bulk.history", lang) + (historyOpen ? " ▲" : " ▼")}
          </Button>
          {branches.length === 1 && <span className="text-xs text-muted-foreground">{branches[0].name}</span>}
        </div>
      </div>

      {/* 导入历史：默认展开（服务端预读），可按上方按钮收起或刷新 */}
      {historyOpen && (
        <div className="rounded-2xl border bg-card p-4 space-y-2">
          <h2 className="text-sm font-semibold">{t("bulk.history", lang)}</h2>
          {history.length === 0 && <p className="text-xs text-muted-foreground">{t("bulk.history-empty", lang)}</p>}
          <div className="divide-y text-xs">
            {history.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="min-w-[120px] text-muted-foreground">{h.uploadedAt.slice(0, 16).replace("T", " ")}</span>
                <span className="min-w-[140px] font-medium">{h.fileName}</span>
                <span className="text-muted-foreground">
                  {h.total} {t("bulk.rows-to-decide", lang)} · {h.approved} {t("bulk.approved", lang)} · {h.declined} {t("bulk.declined", lang)}
                </span>
                {h.appliedSummary && (
                  <span className="text-emerald-700">
                    +{h.appliedSummary.created} / ~{h.appliedSummary.updated} / -{h.appliedSummary.deleted}
                    {h.appliedSummary.refused ? " | " + h.appliedSummary.refused + " " + t("bulk.refused-short", lang) : ""}
                  </span>
                )}
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {h.status === "DRAFT" ? t("bulk.status-draft", lang)
                    : h.status === "APPLIED" ? t("bulk.status-applied", lang)
                    : t("bulk.status-cancelled", lang)}
                </span>
                <span className="text-muted-foreground">{h.uploadedByName}</span>
                {h.appliedAt && (
                  <span className="text-muted-foreground">
                    {t("bulk.applied-at", lang) + " " + h.appliedAt.slice(0, 16).replace("T", " ")}
                  </span>
                )}
                <span className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => openSession(h.id)} disabled={pending}>
                  {t("bulk.open", lang)}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. 上传（不写库） */}
      <div className="rounded-2xl border bg-card p-5 space-y-3">
        <div>
          <h2 className="font-semibold">{t("bulk.step2", lang)}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("bulk.step2-hint", lang)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".xlsx"
            disabled={pending}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-xs"
          />
          <Button size="sm" onClick={upload} disabled={pending || !file}>
            <Upload className="h-4 w-4" /> {t("bulk.preview", lang)}
          </Button>
        </div>
      </div>

      {/* 3. 审核台：逐条 批准 / 拒绝 / 修改（决定存在服务器上） */}
      {resumed && desk && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 px-4 py-2 text-xs text-amber-800">
          {t("bulk.resumed", lang) + " " + desk.uploadedAt.slice(0, 16).replace("T", " ")}
        </div>
      )}
      {desk && (
        <BulkReview
          sessionId={desk.sessionId}
          fileName={desk.fileName}
          uploadedAt={desk.uploadedAt}
          status={desk.status}
          plans={desk.plans}
          decisions={desk.decisions}
          columns={columns}
          sheets={sheets}
          existingCounts={existingCounts}
          declaredSheets={desk.declaredSheets}
          onChanged={onChanged}
        />
      )}

      {desk && (
        <p className="text-xs text-muted-foreground">
          {canDelete ? t("bulk.apply-hint", lang) : t("bulk.apply-hint-noDelete", lang)}
        </p>
      )}
    </div>
  );
}
