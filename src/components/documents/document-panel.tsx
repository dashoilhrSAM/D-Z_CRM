"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, FileText, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";
import { deleteDocumentAction, decideDocumentAction, uploadDocumentAction } from "@/actions/documents";
import { ALLOWED_DOCUMENT_MIME, DOCUMENT_KINDS, type DocumentKind } from "@/lib/documents/validate";

/**
 * 文档面板（P0）。
 *
 * 两件事刻意做在一起：**上传**与**审核状态**。因为"上传 ≠ 有效"是这一期的核心设计 ——
 * 柜台传了客户身份证，那只是 UPLOADED；有人看过并确认，才是 VERIFIED。
 * 面板上直接显示状态、并给能审核的人一键操作，这件事才真的会发生。
 *
 * 下载一律走 /api/documents/[id]/file（服务端鉴权）—— 面板里**没有**、也不该有任何直链。
 */

export interface DocumentPanelRow {
  id: string;
  kind: string;
  status: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  verifyNote: string | null;
}

export interface DocumentPanelLink {
  customerId?: string | null;
  motorcycleId?: string | null;
  jobId?: string | null;
  invoiceId?: string | null;
  leadId?: string | null;
  bookingId?: string | null;
  purchaseOrderId?: string | null;
  supplierId?: string | null;
}

const STATUS_TONE: Record<string, string> = {
  UPLOADED: "bg-amber-500/10 text-amber-700",
  VERIFIED: "bg-emerald-500/10 text-emerald-700",
  REJECTED: "bg-destructive/10 text-destructive",
  ARCHIVED: "bg-muted text-muted-foreground",
  EXPIRED: "bg-muted text-muted-foreground",
  DELETED: "bg-muted text-muted-foreground",
};

function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

export function DocumentPanel({
  link,
  rows,
  canWrite,
  canVerify,
  canDelete,
}: {
  link: DocumentPanelLink;
  rows: DocumentPanelRow[];
  canWrite: boolean;
  canVerify: boolean;
  canDelete: boolean;
}) {
  const lang = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<DocumentKind>("CUSTOMER_ID");
  const [file, setFile] = useState<File | null>(null);

  const upload = () => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("kind", kind);
    for (const [k, v] of Object.entries(link)) if (v) fd.set(k, String(v));
    start(async () => {
      const res = await uploadDocumentAction(fd);
      if (res.ok) {
        toast.success(t("doc.uploaded", lang));
        setFile(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const decide = (id: string, approve: boolean) =>
    start(async () => {
      const res = await decideDocumentAction({ id, approve });
      if (res.ok) {
        toast.success(t("doc.saved", lang));
        router.refresh();
      } else toast.error(res.error);
    });

  const remove = (id: string) =>
    start(async () => {
      const res = await deleteDocumentAction({ id });
      if (res.ok) {
        toast.success(t("doc.saved", lang));
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm">{t("doc.title", lang)}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("doc.hint", lang)}</p>
      </div>

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as DocumentKind)}
            disabled={pending}
            className="h-9 rounded-lg border bg-background px-2 text-sm"
          >
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>{t("doc.kind-" + k, lang)}</option>
            ))}
          </select>
          <input
            type="file"
            accept={ALLOWED_DOCUMENT_MIME.join(",")}
            disabled={pending}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-xs"
          />
          <Button size="sm" onClick={upload} disabled={pending || !file}>
            <Upload className="h-4 w-4" /> {t("doc.upload", lang)}
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("doc.none", lang)}</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {rows.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 min-w-[140px] text-sm truncate">{d.fileName}</span>
              <span className="text-[11px] text-muted-foreground">{t("doc.kind-" + d.kind, lang)}</span>
              <span className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + (STATUS_TONE[d.status] ?? "")}>
                {t("doc.status-" + d.status, lang)}
              </span>
              <span className="text-[11px] text-muted-foreground tabular-nums">{humanSize(d.sizeBytes)}</span>
              <a className="text-xs text-primary hover:underline" href={"/api/documents/" + d.id + "/file"} target="_blank" rel="noreferrer">
                {t("doc.open", lang)}
              </a>
              {canVerify && d.status === "UPLOADED" && (
                <>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide(d.id, true)} title={t("doc.verify", lang)}>
                    <Check className="h-4 w-4 text-emerald-600" />
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide(d.id, false)} title={t("doc.reject", lang)}>
                    <X className="h-4 w-4 text-destructive" />
                  </Button>
                </>
              )}
              {canDelete && (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(d.id)} title={t("doc.delete", lang)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
