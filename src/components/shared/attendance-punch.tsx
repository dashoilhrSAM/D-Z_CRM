"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, LogIn, LogOut, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t, tpl, type Lang } from "@/lib/i18n";

/**
 * 考勤打卡（拍照 + 定位）—— 三个入口共用这一个组件。
 *
 * 为什么只有这一个组件：技师端、车间页、销售台都用它，"必须拍照/必须定位"这条规则
 * 就不能有两个实现（D&Z 的老毛病是同一规则写两遍然后漂移）。
 *
 * 两条刻意的设计：
 *  1. **只用摄像头实时拍摄**，不提供相册选图的退路。相册意味着可以交一张昨天的照片，
 *     那这套考勤就只是给人添麻烦。没有摄像头/拒绝授权 = 打卡按钮不可用（并说明原因），
 *     而不是悄悄退回选文件。
 *  2. **定位是尽力而为**：室内经常拿不到，拿不到就如实上报"没有定位"，
 *     由服务端记成待确认，而不是在客户端编一个坐标。
 */

export type PunchKind = "IN" | "OUT";
type Phase = "idle" | "warming" | "ready" | "sending";

interface GeoReading {
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  error: string | null;
}

function deviceId(): string {
  try {
    const key = "dz.attendance.device";
    let id = localStorage.getItem(key);
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "";
  }
}

export function AttendancePunch({ kind, lang, compact = false }: { kind: PunchKind; lang: Lang; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeoReading>({ lat: null, lng: null, accuracyM: null, error: null });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  // 组件卸载/关闭时必须把摄像头关掉：灯还亮着是最容易被投诉的那种 bug
  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    let cancelled = false;
    setPhase("warming");
    setCameraError(null);
    setGeo({ lat: null, lng: null, accuracyM: null, error: null });

    // 定位与摄像头并行：定位可能要好几秒，而它不依赖摄像头
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy ?? null, error: null });
        },
        (err) => {
          if (cancelled) return;
          setGeo({ lat: null, lng: null, accuracyM: null, error: err.message || "unavailable" });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    } else {
      setGeo({ lat: null, lng: null, accuracyM: null, error: "unsupported" });
    }

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 720 } }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        setCameraError(e instanceof Error ? e.message : "camera unavailable");
        setPhase("idle");
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, stopCamera]);

  const capture = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const video = videoRef.current;
      if (!video || !video.videoWidth) return resolve(null);
      const scale = Math.min(1, 720 / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85);
    });

  const submit = async () => {
    setPhase("sending");
    try {
      const shot = await capture();
      if (!shot) {
        toast.error(t("att.camera-error", lang));
        setPhase("ready");
        return;
      }
      const form = new FormData();
      form.set("kind", kind);
      form.set("photo", new File([shot], "punch.jpg", { type: "image/jpeg" }));
      if (geo.lat !== null && geo.lng !== null) {
        form.set("lat", String(geo.lat));
        form.set("lng", String(geo.lng));
      }
      if (geo.accuracyM !== null) form.set("accuracyM", String(geo.accuracyM));
      form.set("source", compact ? "MOBILE" : "WEB");
      form.set("deviceId", deviceId());

      const res = await fetch("/api/attendance/punch", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; verdict?: string; error?: string };

      if (!res.ok || !body.ok) {
        const message =
          body.error === "Already checked in" ? t("att.err-already-in", lang)
          : body.error === "Not checked in" ? t("att.err-not-in", lang)
          : body.error === "Photo is required" ? t("att.photo-required", lang)
          : body.error || t("att.err-generic", lang);
        toast.error(message);
        setPhase("ready");
        return;
      }

      // 结论不是"成功/失败"，而是"这次打卡可不可信"——如实告诉本人
      const verdict = body.verdict ?? "OK";
      if (verdict === "OK") toast.success(tpl(kind === "IN" ? "att.done-in" : "att.done-out", lang, { time: new Date().toLocaleTimeString() }));
      else toast.warning(t("att.verdict-" + verdictKey(verdict), lang));

      stopCamera();
      setOpen(false);
      setPhase("idle");
      router.refresh();
    } catch {
      toast.error(t("att.err-generic", lang));
      setPhase("ready");
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={kind === "IN" ? "default" : "outline"}
        className={compact ? "w-full" : ""}
        onClick={() => setOpen(true)}
        data-testid={kind === "IN" ? "attendance-check-in" : "attendance-check-out"}
      >
        {kind === "IN" ? <LogIn className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}
        <span className="ml-2">{t(kind === "IN" ? "att.check-in" : "att.check-out", lang)}</span>
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border bg-card p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-semibold">{t(kind === "IN" ? "att.title-in" : "att.title-out", lang)}</div>
              <button type="button" aria-label="close" onClick={() => { stopCamera(); setOpen(false); }} className="rounded p-1 hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 实时画面 —— 拍的就是它，不是相册 */}
            <div className="relative overflow-hidden rounded-xl bg-black" data-testid="attendance-camera">
              <video ref={videoRef} playsInline muted className="h-56 w-full object-cover" />
              {phase !== "ready" && (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-white/80">
                  {cameraError ? t("att.camera-error", lang) : t("att.camera-starting", lang)}
                </div>
              )}
            </div>

            <div className="mt-3 flex items-start gap-2 text-xs" data-testid="attendance-geo">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">
                {geo.lat !== null
                  ? tpl("att.geo-ok", lang, { m: String(Math.round(geo.accuracyM ?? 0)) })
                  : geo.error
                    ? t("att.geo-missing", lang)
                    : t("att.locating", lang)}
              </span>
            </div>

            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                className="flex-1"
                disabled={phase !== "ready"}
                onClick={submit}
                data-testid="attendance-submit"
              >
                <Camera className="h-4 w-4" />
                <span className="ml-2">{phase === "sending" ? t("att.submitting", lang) : t("att.capture", lang)}</span>
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">{t("att.privacy-note", lang)}</p>
          </div>
        </div>
      )}
    </>
  );
}

/** 服务端 verdict 常量 → i18n 键后缀（kebab-case）。 */
function verdictKey(verdict: string): string {
  return verdict.toLowerCase().replace(/_/g, "-");
}
