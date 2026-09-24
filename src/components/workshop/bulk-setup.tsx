"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";
import { exportSetupWorkbook, previewSetupImport, type PreviewResult } from "@/actions/bulk";
import { BulkReview } from "@/components/workshop/bulk-review";

/**
 * 批量配置（P1 选择性下载 + P2 审核台）。
 *
 * 流程：**挑要下哪几张 → 改 → 传回来 → 逐条 批准/拒绝/修改 → 应用**。
 *
 * 两个刻意的设计：
 *  ① 下载可以只挑几张，而且**这份清单会写进文件** —— 导入时只处理文件里有的部分，
 *     不会把没勾的表当成「空的」；
 *  ② 上传只解析与校验，**审核台**才决定写什么（只有你批准的行会落库）。
 */

export function BulkSetup({
  canDelete,
  branches,
  sheets,
}: {
  canDelete: boolean;
  branches: { id: string; name: string }[];
  sheets: { key: string; title: string }[];
}) {
  const lang = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [downloading, setDownloading] = useState(false);
  // 套餐与促销按分店存，所以必须明确「这一份文件属于哪个分店」——文件里也会写明
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  // 要下载哪几张（默认全选）
  const [selected, setSelected] = useState<string[]>(sheets.map((s) => s.key));
  const [templateOnly, setTemplateOnly] = useState(false);

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
          <input type="checkbox" checked={templateOnly} disabled={pending || downloading} onChange={(e) => setTemplateOnly(e.target.checked)} />
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
          <Button size="sm" variant="outline" onClick={download} disabled={downloading || pending || !branchId || selected.length === 0}>
            <Download className="h-4 w-4" /> {t("bulk.download", lang) + " (" + selected.length + ")"}
          </Button>
          {branches.length === 1 && <span className="text-xs text-muted-foreground">{branches[0].name}</span>}
        </div>
      </div>

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

      {/* 3. 审核台：逐条 批准 / 拒绝 / 修改 */}
      {preview && (
        <BulkReview
          preview={preview}
          onDone={() => {
            setFile(null);
            router.refresh();
          }}
        />
      )}

      {preview && (
        <p className="text-xs text-muted-foreground">
          {canDelete ? t("bulk.apply-hint", lang) : t("bulk.apply-hint-noDelete", lang)}
        </p>
      )}
    </div>
  );
}
