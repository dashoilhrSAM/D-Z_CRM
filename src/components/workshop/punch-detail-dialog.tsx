"use client";

import { useEffect } from "react";
import { ExternalLink, MapPin, X } from "lucide-react";
import { t, tpl, type Lang } from "@/lib/i18n";

export interface PunchDetail {
  id: string;
  kind: string;
  at: string;
  verdict: string;
  distanceM: number | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  source: string;
}

const verdictKey = (v: string) => v.toLowerCase().replace(/_/g, "-");

/** 坐标 → Google Maps 链接（只做跳转，不需要任何 key，也不把坐标发给我们以外的服务）。 */
export function mapsUrl(lat: number, lng: number): string {
  return "https://www.google.com/maps?q=" + lat + "," + lng;
}

/** 一行人话的地点描述：看板的证据条与弹窗共用同一份措辞，避免两处各写一套。 */
export function locationSummary(p: PunchDetail, lang: Lang): string {
  if (p.lat == null || p.lng == null) return t("att.no-location-short", lang);
  if (p.distanceM != null) return tpl("att.distance-short", lang, { m: String(Math.round(p.distanceM)) });
  // 有坐标但没算出距离 = 门店还没配坐标
  return p.lat.toFixed(5) + ", " + p.lng.toFixed(5);
}

/**
 * 打卡详情弹窗：照片 + 时间 + 地点，右上角 X 关闭。
 *
 * 为什么做成弹窗而不是像原来那样直接在新标签页打开照片：照片本身说明不了什么，
 * 要判断「这次打卡可不可信」得同时看**时间、地点、距离、判定**——这四样放在一起才有意义。
 * 照片仍然是私有对象，由鉴权路由 /api/attendance/photo/[id] 提供（不是公开 URL）。
 */
export function PunchDetailDialog({
  punch,
  staffName,
  lang,
  onClose,
}: {
  punch: PunchDetail;
  staffName: string;
  lang: Lang;
  onClose: () => void;
}) {
  // Esc 关闭 + 打开期间锁掉背景滚动（长列表下滑时弹窗跟着走会很难受）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const hasFix = punch.lat != null && punch.lng != null;
  const photoUrl = "/api/attendance/photo/" + punch.id;
  const rowCls = "flex items-start justify-between gap-4 py-2 text-sm";
  const labelCls = "text-muted-foreground";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("att.detail-title", lang)}
      data-testid="punch-detail"
      onClick={(e) => {
        // 点背景关闭，点内容不关
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border bg-card shadow-xl">
        <div className="sticky top-0 flex items-center justify-between gap-3 border-b bg-card px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-semibold">
              {staffName} · {t(punch.kind === "IN" ? "att.in" : "att.out", lang)}
            </div>
            <div className="text-xs text-muted-foreground">{t("att.detail-title", lang)}</div>
          </div>
          <button
            type="button"
            aria-label={t("common.close", lang)}
            onClick={onClose}
            data-testid="punch-detail-close"
            className="shrink-0 rounded-lg p-1.5 hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          {/* 照片：私有对象，走鉴权路由 */}
          <div className="overflow-hidden rounded-xl border bg-black/5" data-testid="punch-detail-photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl}
              alt={t("att.detail-photo", lang)}
              className="max-h-[45vh] w-full object-contain"
            />
          </div>
          <a
            href={photoUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            {t("att.detail-open-photo", lang)}
          </a>

          <div className="mt-3 divide-y">
            <div className={rowCls}>
              <span className={labelCls}>{t("att.detail-time", lang)}</span>
              <span className="text-right tabular-nums" data-testid="punch-detail-time">
                {new Date(punch.at).toLocaleString()}
              </span>
            </div>

            <div className={rowCls}>
              <span className={labelCls}>{t("att.detail-location", lang)}</span>
              <span className="text-right" data-testid="punch-detail-location">
                {hasFix ? (
                  <>
                    <span className="tabular-nums">{punch.lat!.toFixed(5)}, {punch.lng!.toFixed(5)}</span>
                    <a
                      href={mapsUrl(punch.lat!, punch.lng!)}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      {t("att.detail-map", lang)}
                    </a>
                  </>
                ) : (
                  <span className="text-amber-700 dark:text-amber-300">{t("att.no-location-short", lang)}</span>
                )}
              </span>
            </div>

            {punch.distanceM != null && (
              <div className={rowCls}>
                <span className={labelCls}>{t("att.detail-distance", lang)}</span>
                <span className="tabular-nums">{Math.round(punch.distanceM)} m</span>
              </div>
            )}

            {punch.accuracyM != null && (
              <div className={rowCls}>
                <span className={labelCls}>{t("att.detail-accuracy", lang)}</span>
                <span className="tabular-nums">±{Math.round(punch.accuracyM)} m</span>
              </div>
            )}

            <div className={rowCls}>
              <span className={labelCls}>{t("att.detail-source", lang)}</span>
              <span>{t(punch.source === "MOBILE" ? "att.source-mobile" : "att.source-web", lang)}</span>
            </div>

            <div className={rowCls}>
              <span className={labelCls}>{t("att.detail-verdict", lang)}</span>
              <span data-testid="punch-detail-verdict">{t("att.verdict-" + verdictKey(punch.verdict), lang)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
