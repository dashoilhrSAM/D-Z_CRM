"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MapPin, Save } from "lucide-react";
import { updateAttendancePolicy } from "@/actions/settings";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";

export interface AttendancePolicyValues {
  photoRequired: boolean;
  geoRequired: boolean;
  geofenceM: number;
  accuracyMaxM: number;
}

/**
 * 考勤政策（OWNER 用）。
 *
 * 这几个值决定"一次打卡必须提供什么、多远算越界"——它们影响判断结果，
 * 所以按项目惯例做成界面开关而不是源码常量（先例：促销自动打折 promoAutoApply）。
 */
export function AttendancePolicyPanel({ values }: { values: AttendancePolicyValues }) {
  const router = useRouter();
  const lang = useLang();
  const [form, setForm] = useState({
    photoRequired: values.photoRequired,
    geoRequired: values.geoRequired,
    geofenceM: String(values.geofenceM),
    accuracyMaxM: String(values.accuracyMaxM),
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const res = await updateAttendancePolicy({
      photoRequired: form.photoRequired,
      geoRequired: form.geoRequired,
      geofenceM: Number(form.geofenceM) || values.geofenceM,
      accuracyMaxM: Number(form.accuracyMaxM) || values.accuracyMaxM,
    });
    setSaving(false);
    if (res.ok) {
      toast.success(t("att.policy-saved", lang));
      router.refresh();
    } else {
      toast.error(res.error ?? t("att.policy-save-failed", lang));
    }
  };

  const rowCls = "flex items-center justify-between gap-3 py-2";
  const numCls = "w-24 rounded-md border bg-background px-2 py-1 text-sm tabular-nums";

  return (
    <div className="rounded-xl border bg-card p-4" data-testid="attendance-policy">
      <div className="mb-1 flex items-center gap-2">
        <MapPin className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">{t("att.policy-title", lang)}</h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{t("att.policy-desc", lang)}</p>

      <div className="divide-y">
        <label className={rowCls}>
          <span className="text-sm">{t("att.policy-photo", lang)}</span>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={form.photoRequired}
            onChange={(e) => setForm({ ...form, photoRequired: e.target.checked })}
            data-testid="attendance-policy-photo"
          />
        </label>
        <label className={rowCls}>
          <span className="text-sm">{t("att.policy-geo", lang)}</span>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={form.geoRequired}
            onChange={(e) => setForm({ ...form, geoRequired: e.target.checked })}
            data-testid="attendance-policy-geo"
          />
        </label>
        <div className={rowCls}>
          <span className="text-sm">
            {t("att.policy-geofence", lang)}
            <span className="block text-[11px] text-muted-foreground">{t("att.policy-geofence-desc", lang)}</span>
          </span>
          <input
            type="number"
            min={10}
            max={5000}
            className={numCls}
            value={form.geofenceM}
            onChange={(e) => setForm({ ...form, geofenceM: e.target.value })}
            data-testid="attendance-policy-geofence-m"
          />
        </div>
        <div className={rowCls}>
          <span className="text-sm">
            {t("att.policy-accuracy", lang)}
            <span className="block text-[11px] text-muted-foreground">{t("att.policy-accuracy-desc", lang)}</span>
          </span>
          <input
            type="number"
            min={5}
            max={2000}
            className={numCls}
            value={form.accuracyMaxM}
            onChange={(e) => setForm({ ...form, accuracyMaxM: e.target.value })}
            data-testid="attendance-policy-accuracy-m"
          />
        </div>
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        data-testid="attendance-policy-save"
      >
        <Save className="h-3.5 w-3.5" />
        {t("common.save", lang)}
      </button>
    </div>
  );
}
