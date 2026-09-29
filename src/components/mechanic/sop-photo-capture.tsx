"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Camera, Check } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";
import { compressImageForUpload } from "@/lib/image-compress";
import { MAX_PHOTO_UPLOAD_BYTES } from "@/lib/photo-policy";

const ANGLES = ["front", "back", "left", "right", "meter"] as const;
type Angle = (typeof ANGLES)[number];
const ANGLE_KEY: Record<Angle, string> = { front: "mech.sop.front", back: "mech.sop.back", left: "mech.sop.left", right: "mech.sop.right", meter: "mech.sop.meter" };
const ANGLE_CODE: Record<Angle, string> = { front: "FRONT", back: "BACK", left: "LEFT", right: "RIGHT", meter: "METER" };

export interface SopPhotoDto { angle: string; photoUrl: string; capturedAt: string | null }

/** Mechanic pre-service SOP: 5-angle condition photos. Must be complete before Start Service. */
export function SopPhotoCapture({ jobId, photos, canCapture = true }: { jobId: string; photos: SopPhotoDto[]; canCapture?: boolean }) {
  const router = useRouter();
  const lang = useLang();
  const [uploading, setUploading] = useState<Angle | null>(null);
  const byAngle = new Map(photos.map((p) => [p.angle.toLowerCase(), p]));
  const captured = photos.length;

  const onFile = async (angle: Angle, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(angle);
    try {
      // 先压缩再上传：生产实测原图平均 2.65 MB、SOP 每单 5 张，而 Vercel
      // 的请求体上限是 4.5 MB（线上最大一张已 4.3 MB）—— 原图上传既把存储与
      // 流量乘以 8 倍，又随时会被平台以 413 拒掉，而那句报错和"照片太大"无关。
      const prepared = await compressImageForUpload(file);
      if (prepared.bytes > MAX_PHOTO_UPLOAD_BYTES) {
        toast.error(tpl("mech.sop.too-large", lang, { mb: (prepared.bytes / 1024 / 1024).toFixed(1) }));
        return;
      }
      const fd = new FormData();
      fd.append("file", prepared.file);
      fd.append("angle", ANGLE_CODE[angle]);
      const res = await fetch(`/api/jobs/${jobId}/photos`, { method: "POST", body: fd });
      const data = await res.json();
      if (!data.ok) alert(data.error ?? t("ws.ctrl.upload-failed", lang));
      // 拍齐最后一张时后端会直接把工单推进到「进行中」——告诉技师一声，
      // 否则他回到列表才发现状态变了（老板反馈：接单后应当变成 in progress）
      if (data.started) toast.success(t("mech.started", lang));
      router.refresh();
    } catch (err) {
      alert(String((err as Error).message));
    } finally {
      setUploading(null);
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{t("mech.sop.title", lang)}</div>
          <p className="text-[11px] text-muted-foreground">{t("mech.sop.subtitle", lang)}</p>
        </div>
        <span className={captured >= 5 ? "shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" : "shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"}>
          {tpl("mech.sop.progress", lang, { n: captured })}
        </span>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {ANGLES.map((angle) => {
          const p = byAngle.get(angle);
          return (
            <div key={angle} className="relative aspect-square overflow-hidden rounded-xl border bg-muted/40">
              {p?.photoUrl ? (
                <img src={p.photoUrl} alt={t(ANGLE_KEY[angle], lang)} className="h-full w-full object-cover" />
              ) : canCapture ? (
                <label className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1 text-muted-foreground">
                  <Camera className="h-4 w-4" />
                  <span className="text-[9px]">{uploading === angle ? t("mech.sop.uploading", lang) : t("mech.sop.capture", lang)}</span>
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(angle, e)} disabled={uploading !== null} />
                </label>
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground/60">—</span>
              )}
              <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-[10px] font-medium text-white">{t(ANGLE_KEY[angle], lang)}</span>
              {p?.photoUrl && (
                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <Check className="h-3 w-3" />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
