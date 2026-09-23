"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestRiderPhoneChange, verifyRiderPhoneChange } from "@/actions/rider-settings";
import { t, tpl, type Lang } from "@/lib/i18n";

/**
 * Rider 更换/绑定手机号（Settings → 手机号）。
 *
 * 两步：① 向**新号码**发验证码（证明新号码归他）；② 输码确认 → 服务端把号码挂到他本人的账号上。
 * 为什么必须两步：手机号是登录标识，能随手改就等于"谁拿到会话谁就能把账号挪走"。
 * 真正的判定与挂载逻辑在服务端（lib/auth/phone-identity.ts），这里只管交互。
 */
export function PhoneChangeForm({ lang, verified }: { lang: Lang; verified: boolean }) {
  const [pending, start] = useTransition();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);

  const send = () =>
    start(async () => {
      const r = await requestRiderPhoneChange({ phone });
      if (r.ok) {
        setSent(true);
        toast.success(tpl("settings.phone-code-sent", lang, { phone: r.masked }));
      } else {
        toast.error(r.error);
      }
    });

  const confirm = () =>
    start(async () => {
      const r = await verifyRiderPhoneChange({ phone, token: code });
      if (r.ok) {
        toast.success(t("settings.phone-changed", lang));
        setPhone("");
        setCode("");
        setSent(false);
      } else {
        toast.error(r.error);
      }
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{t("settings.phone-current", lang)}</span>
        {verified ? (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600">{t("settings.phone-verified", lang)}</span>
        ) : (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600">{t("settings.phone-unverified", lang)}</span>
        )}
      </div>

      {!sent ? (
        <>
          <div>
            <Label>{t("settings.phone-new", lang)}</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1.5"
              placeholder="01X-XXX XXXX"
              inputMode="tel"
              autoComplete="tel"
            />
          </div>
          <Button className="w-full" disabled={pending || phone.trim().length < 8} onClick={send}>
            {pending ? t("common.loading", lang) : t("settings.phone-send-code", lang)}
          </Button>
        </>
      ) : (
        <>
          <div>
            <Label>{t("settings.phone-code", lang)}</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-1.5"
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          </div>
          <Button className="w-full" disabled={pending || code.trim().length < 4} onClick={confirm}>
            {pending ? t("common.loading", lang) : t("settings.phone-confirm", lang)}
          </Button>
          <button type="button" className="w-full text-xs text-muted-foreground underline" onClick={() => { setSent(false); setCode(""); }}>
            {t("settings.phone-new", lang)}
          </button>
        </>
      )}
    </div>
  );
}
