"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppBrandIcon } from "@/components/shared/app-brand-icon";
import {
  signUpRider,
  requestRiderPhoneOtp,
  verifyRiderPhoneOtp,
  completeRiderPhoneSignup,
} from "@/actions/auth-supabase";
import { LanguageSwitcher } from "@/components/rider/language-switcher";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";
import { COUNTRY_CODES } from "@/lib/phone";

type Method = "password" | "sms";

/** Rider 顾客自助注册页。
 *  两种注册方式：① 密码（原有）② 手机短信验证码。
 *  验证码方式**不需要密码**——手机号被真实验证过，这比"密码 + 由后台代勾 phone_confirm"更可信，
 *  也让历史老客（档案里 authId 为空、过去没有任何登录方式）第一次能自己认领账号。 */
export default function RiderSignupPage() {
  const router = useRouter();
  const lang = useLang();
  const [method, setMethod] = useState<Method>("sms");
  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState("+60"); // 默认马来西亚
  const [phone, setPhone] = useState(""); // 必填
  const [email, setEmail] = useState(""); // 选填
  const [gender, setGender] = useState(""); // "" | "M" | "F"
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const inputCls = "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
  const labelCls = "text-xs font-medium text-muted-foreground mb-1 block";
  const methodCls = (active: boolean) => `flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`;

  function resetCode() {
    setCodeSent(false);
    setCode("");
    setCooldown(0);
    setError("");
    setInfo("");
  }

  async function doPasswordSignup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setInfo("");
    if (password !== confirmPassword) { setBusy(false); setError(t("signup.password-mismatch", lang)); return; }
    const res = await signUpRider({ name, phone, countryCode, email: email.trim() || undefined, gender, password });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    if (res.signInFailed) {
      // 账号已建，但自动登录失败（如 phone-only 需 Supabase Phone provider）——引导手动登录
      setInfo(tpl("signup.created-signin", lang, { id: res.signInFailed.includes("phone") || res.signInFailed.includes("Phone") ? t("signup.phone-number", lang) : t("common.email", lang) }));
      return;
    }
    if (res.emailConfirm) {
      setInfo(t("signup.created-email", lang));
    } else {
      // 新注册必无摩托 → 引导注册第一辆
      router.push("/rider/bike-first");
      router.refresh();
    }
  }

  async function doSendCode() {
    setBusy(true); setError(""); setInfo("");
    const res = await requestRiderPhoneOtp({ phone, countryCode, purpose: "SIGNUP" });
    setBusy(false);
    if (!res.ok) { setCodeSent(false); setError(res.error); return; }
    setCodeSent(true);
    setCooldown(60);
    setInfo(tpl("login.sms-sent", lang, { phone: countryCode + phone.replace(/[^\d]/g, "") }));
  }

  async function doSmsSignup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    // 两步：先验码（建 session + 证明号码归属），再补档案（姓名/性别/邮箱）。
    const verified = await verifyRiderPhoneOtp({ phone, countryCode, token: code });
    if (!verified.ok) { setBusy(false); setError(verified.error); return; }
    const done = await completeRiderPhoneSignup({ name, gender, email: email.trim() || undefined });
    setBusy(false);
    if (!done.ok) { setError(done.error); return; }
    router.push("/rider/bike-first");
    router.refresh();
  }

  return (
    <div className="flex justify-center px-4 py-4 relative overflow-hidden">
      <div className="w-full max-w-sm relative">
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher current={lang} />
        </div>
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="h-14 w-14 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/25">
            <AppBrandIcon app="rider" className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">{t("signup.title", lang)}</h1>
          <p className="text-sm text-muted-foreground">{t("signup.sub", lang)}</p>
        </div>
        <div className="rounded-2xl border bg-card/95 backdrop-blur p-6 shadow-xl shadow-black/5">
          {error && <p className="mb-3 rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">{error}</p>}
          {info && <p className="mb-3 rounded-md bg-primary/10 text-primary text-sm px-3 py-2">{info}</p>}

          <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
            <button type="button" className={methodCls(method === "sms")} onClick={() => { setMethod("sms"); resetCode(); }}>{t("signup.method-sms", lang)}</button>
            <button type="button" className={methodCls(method === "password")} onClick={() => { setMethod("password"); resetCode(); }}>{t("signup.method-password", lang)}</button>
          </div>

          <form onSubmit={method === "sms" ? doSmsSignup : doPasswordSignup} className="space-y-3">
            <div>
              <label className={labelCls}>{t("signup.full-name", lang)}</label>
              <input className={inputCls} required value={name} onChange={(e) => setName(e.target.value)} placeholder={t("signup.ph-name", lang)} />
            </div>
            <div>
              <label className={labelCls}>{t("common.phone", lang)}</label>
              <div className="flex gap-2">
                <select value={countryCode} disabled={codeSent} onChange={(e) => setCountryCode(e.target.value)} className="w-32 rounded-md border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60">
                  {COUNTRY_CODES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
                <input className={inputCls} type="tel" inputMode="tel" autoComplete="tel" required disabled={codeSent} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("signup.ph-phone", lang)} />
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">{t("signup.country-hint", lang)}</p>
            </div>
            <div>
              <label className={labelCls}>{t("signup.email-optional", lang)}</label>
              <input className={inputCls} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("signup.ph-email", lang)} />
            </div>
            <div>
              <label className={labelCls}>{t("form.gender", lang)}</label>
              <select value={gender} onChange={(e) => setGender(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                <option value="">{t("form.prefer-not", lang)}</option>
                <option value="M">{t("signup.gender-male", lang)}</option>
                <option value="F">{t("signup.gender-female", lang)}</option>
              </select>
            </div>

            {method === "password" ? (
              <>
                <div>
                  <label className={labelCls}>{t("signup.password-min", lang)}</label>
                  <input className={inputCls} type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <div>
                  <label className={labelCls}>{t("signup.confirm-password", lang)}</label>
                  <input className={inputCls} type="password" required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <button type="submit" disabled={busy} className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-50">
                  {busy ? t("signup.creating", lang) : t("signup.create", lang)}
                </button>
              </>
            ) : (
              <>
                {codeSent && (
                  <div>
                    <label className={labelCls}>{t("login.otp-code", lang)}</label>
                    <input className={inputCls} inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">{t("signup.otp-hint", lang)}</p>
                {!codeSent ? (
                  <button type="button" disabled={busy || phone.replace(/[^\d]/g, "").length < 7} onClick={doSendCode} className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-50">
                    {busy ? t("signup.creating", lang) : t("signup.send-code", lang)}
                  </button>
                ) : (
                  <>
                    <button type="submit" disabled={busy || code.trim().length < 4} className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-50">
                      {busy ? t("signup.creating", lang) : t("signup.otp-finish", lang)}
                    </button>
                    <button type="button" disabled={busy || cooldown > 0} onClick={doSendCode} className="w-full rounded-md border py-2 text-xs font-medium disabled:opacity-50">
                      {cooldown > 0 ? tpl("login.resend-in", lang, { s: cooldown }) : t("login.resend-code", lang)}
                    </button>
                  </>
                )}
              </>
            )}
          </form>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          <a href="/rider/login" className="text-primary hover:underline">{t("signup.has-account", lang)}</a>
        </p>
      </div>
    </div>
  );
}
