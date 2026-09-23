"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";
import { applySetupImport, exportSetupWorkbook, previewSetupImport, type PreviewResult } from "@/actions/bulk";

/**
 * 批量配置（P2）：下载 → 改 → 上传 → **看差异** → 应用。
 *
 * 界面上刻意只有**两个**动作按钮：Preview（只读）与 Apply（写）。
 * 没有"直接导入"这种捷径 —— 那正是这一期要防的操作。
 */

export function BulkSetup({ canDelete, branches }: { canDelete: boolean; branches: { id: string; name: string }[] }) {
  const lang = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [downloading, setDownloading] = useState(false);
  // 套餐与促销是按分店存的，所以必须明确「这一份文件属于哪个分店」——
  // 文件里也会写明，导入时以文件里的为准（避免把 A 店的文件导进 B 店）。
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");

  const download = async () => {
    setDownloading(true);
    try {
      const res = await exportSetupWorkbook({ branchId });
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

  const runPreview = () => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      const res = await previewSetupImport(fd);
      if (!res.ok) {
        toast.error(res.error);
        setPreview(null);
        return;
      }
      setPreview(res);
    });
  };

  const apply = () =>
    start(async () => {
      if (!preview) return;
      const res = await applySetupImport({ plans: preview.plans, branchId: preview.branchId });
      if (res.ok) {
        const total = Object.values(res.summary).reduce(
          (acc, s) => ({ created: acc.created + s.created, updated: acc.updated + s.updated, deleted: acc.deleted + s.deleted, deactivated: acc.deactivated + s.deactivated }),
          { created: 0, updated: 0, deleted: 0, deactivated: 0 },
        );
        toast.success(
          t("bulk.applied", lang) + ": +" + total.created + " / ~" + total.updated + " / -" + total.deleted +
          (total.deactivated ? " (" + total.deactivated + " " + t("bulk.deactivated", lang) + ")" : ""),
        );
        setPreview(null);
        setFile(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });

  // **按 sheet 汇总**，不能只看第一张：只改了套餐/促销时，零件表是零改动 ——
  // 那时候"应用"按钮若按 sheets[0] 判断就会是灰的，等于那两张表根本改不了。
  // 错误同理：套餐表里的错误也必须挡住应用（服务端会拒绝，但界面不能骗人）。
  const sheetSummaries = preview?.sheets ?? [];
  const totals = sheetSummaries.reduce(
    (acc, s) => ({
      create: acc.create + s.summary.create,
      update: acc.update + s.summary.update,
      delete: acc.delete + s.summary.delete,
      skip: acc.skip + s.summary.skip,
      error: acc.error + s.summary.error,
    }),
    { create: 0, update: 0, delete: 0, skip: 0, error: 0 },
  );
  const blocking = totals.error > 0;
  const ready = totals.create + totals.update + totals.delete > 0;
  const flagged = (preview?.plans ?? []).filter((p) => p.action === "error" || p.action === "create" || p.action === "update" || p.action === "delete");

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-5 space-y-3">
        <div>
          <h2 className="font-semibold">{t("bulk.step1", lang)}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("bulk.step1-hint", lang)}</p>
        </div>
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
          <Button size="sm" variant="outline" onClick={download} disabled={downloading || pending || !branchId}>
            <Download className="h-4 w-4" /> {t("bulk.download", lang)}
          </Button>
          {branches.length === 1 && <span className="text-xs text-muted-foreground">{branches[0].name}</span>}
        </div>
      </div>

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
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
            className="text-xs"
          />
          <Button size="sm" onClick={runPreview} disabled={pending || !file}>
            <Upload className="h-4 w-4" /> {t("bulk.preview", lang)}
          </Button>
        </div>
      </div>

      {preview && (
        <div className="rounded-2xl border bg-card p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{t("bulk.step3", lang)}</h2>
            <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700">+{totals.create} {t("bulk.create", lang)}</span>
            <span className="rounded bg-sky-500/10 px-2 py-0.5 text-xs text-sky-700">~{totals.update} {t("bulk.update", lang)}</span>
            <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">-{totals.delete} {t("bulk.delete", lang)}</span>
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{totals.skip} {t("bulk.nochange", lang)}</span>
            {totals.error > 0 && (
              <span className="rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
                {totals.error} {t("bulk.rowerror", lang)}
              </span>
            )}
          </div>

          {/* 每张 sheet 各自的读数：老板要能一眼看出"哪张表要动、哪张没读进来" */}
          <div className="rounded-xl border divide-y text-xs">
            {sheetSummaries.map((s) => (
              <div key={s.key} className="flex flex-wrap items-center gap-3 px-3 py-1.5">
                <span className="min-w-[140px] font-medium">{s.title}</span>
                {!s.found ? (
                  <span className="text-muted-foreground">{t("bulk.sheet-missing", lang)}</span>
                ) : (
                  <>
                    <span className="text-emerald-700">+{s.summary.create}</span>
                    <span className="text-sky-700">~{s.summary.update}</span>
                    <span className="text-destructive">-{s.summary.delete}</span>
                    <span className="text-muted-foreground">{s.summary.skip} {t("bulk.nochange", lang)}</span>
                    {s.summary.error > 0 && <span className="font-medium text-destructive">{s.summary.error} {t("bulk.rowerror", lang)}</span>}
                  </>
                )}
              </div>
            ))}
          </div>

          {preview.warnings.length > 0 && (
            <p className="text-xs text-amber-700">{preview.warnings.join(" · ")}</p>
          )}

          {blocking && (
            <p className="flex items-center gap-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> {t("bulk.blocked", lang)}
            </p>
          )}

          <div className="max-h-80 overflow-auto rounded-xl border divide-y text-xs">
            {flagged.slice(0, 200).map((p, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                <span className="w-10 text-muted-foreground tabular-nums">#{p.rowNumber}</span>
                <span className="min-w-[120px] font-medium">{p.key}</span>
                <span
                  className={
                    "rounded px-1.5 py-0.5 " +
                    (p.action === "error"
                      ? "bg-destructive/10 text-destructive"
                      : p.action === "create"
                        ? "bg-emerald-500/10 text-emerald-700"
                        : p.action === "delete"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-sky-500/10 text-sky-700")
                  }
                >
                  {t("bulk." + p.action, lang)}
                </span>
                {p.action === "error" && <span className="text-destructive">{p.errors.join("; ")}</span>}
                {p.changes.map((c) => (
                  <span key={c.field} className="text-muted-foreground">
                    {c.field}: {String(c.from ?? "—")} → <span className="text-foreground">{String(c.to)}</span>
                  </span>
                ))}
              </div>
            ))}
            {flagged.length > 200 && <div className="px-3 py-2 text-muted-foreground">… {flagged.length - 200} more</div>}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={apply} disabled={pending || blocking || !ready}>
              {t("bulk.apply", lang)}
            </Button>
            <span className="text-xs text-muted-foreground">
              {canDelete ? t("bulk.apply-hint", lang) : t("bulk.apply-hint-noDelete", lang)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
