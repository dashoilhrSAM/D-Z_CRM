"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { QrCode } from "lucide-react";
import { QrToggle } from "@/components/shared/qr-toggle";
import { workshopQrUrl } from "@/lib/qr";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";

export interface QrFlags {
  enableMotorcycleQr: boolean;
  enableRiderProfileQr: boolean;
  enableWorkshopQr: boolean;
}

/**
 * QR-001..003 设置区块：三个独立开关 + 门店 QR 展示。
 */
export function QrSettings({ orgId, flags, showToggles = true }: { orgId: string; flags: QrFlags; showToggles?: boolean }) {
  const router = useRouter();
  const lang = useLang();
  const [pending, start] = useTransition();
  const [local, setLocal] = useState(flags);

  const toggle = (key: keyof QrFlags, value: boolean) => {
    const next = { ...local, [key]: value };
    setLocal(next);
    start(async () => {
      const res = await fetch("/api/settings/qr-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (res.ok) {
        toast.success(t("qr-settings.saved", lang));
        router.refresh();
      } else {
        setLocal(flags);
        toast.error(t("qr-settings.failed", lang));
      }
    });
  };

  const rows: { key: keyof QrFlags; label: string; desc: string }[] = [
    { key: "enableMotorcycleQr", label: t("bike.qr-label", lang), desc: t("qr-settings.motorcycle.desc", lang) },
    { key: "enableRiderProfileQr", label: t("qr-settings.rider.label", lang), desc: t("qr-settings.rider.desc", lang) },
    { key: "enableWorkshopQr", label: t("qr-settings.workshop.label", lang), desc: t("qr-settings.workshop.desc", lang) },
  ];

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <QrCode className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">{t("qr-settings.title", lang)}</h2>
      </div>
      {showToggles && (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <label key={r.key} className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <div>
                <div className="text-sm font-medium">{r.label}</div>
                <div className="text-[11px] text-muted-foreground">{r.desc}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={local[r.key]}
                disabled={pending}
                onClick={() => toggle(r.key, !local[r.key])}
                className={"relative h-6 w-11 shrink-0 rounded-full transition-colors " + (local[r.key] ? "bg-primary" : "bg-muted")}
              >
                <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform " + (local[r.key] ? "translate-x-5" : "translate-x-0.5")} />
              </button>
            </label>
          ))}
        </div>
      )}
      {local.enableWorkshopQr && (
        <div className="mt-4 flex justify-center">
          <QrToggle value={workshopQrUrl(orgId)} label={t("qr-settings.workshop.label", lang)} defaultShow={false} size={96} />
        </div>
      )}
    </div>
  );
}