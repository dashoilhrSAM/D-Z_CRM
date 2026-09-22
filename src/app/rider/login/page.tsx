"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoginShell } from "@/components/login/login-shell";
import { signInWithPassword, requestRiderPhoneOtp, verifyRiderPhoneOtp } from "@/actions/auth-supabase";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";
import { COUNTRY_CODES } from "@/lib/phone";

type Tab = "phone" | "sms" | "email";

/** Rider 专属登录页：顾客入口（与 workshop /login 分离）。
 *  三条通道并列：手机+密码、手机短信验证码、邮箱+密码。
 *  短信用途是"忘记密码"之外的独立主路径，不是兜底——所以它是一个 tab，不是藏在链接里。 */
export default function RiderLoginPage() {
  const router = useRouter();
  const lang = useLang();
  const [tab, setTab] = useState<Tab>("phone");
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("+60"); // 手机号区号（默认马来西亚）
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  // 重发倒计时：服务端本来就有 60 秒间隔限制，这里只是别让用户白点一次。
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const switchTab = (next: Tab) => {
    setTab(next);
    setError("");
    setInfo("");
  };

  async function doLogin(identifier: string, cc: string) {
    setBusy(true); setError(""); setInfo("");
    const res = await signInWithPassword({ identifier, countryCode: cc, password });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    router.push(res.hasBike === false ? "/rider/bike-first" : "/rider/home");
    router.refresh();
  }

  async function doSendCode() {
    setBusy(true); setError(""); setInfo("");
    const res = await requestRiderPhoneOtp({ phone, countryCode, purpose: "LOGIN" });
    setBusy(false);
    if (!res.ok) {
      // 发不出去时保持"未发送"状态，用户改完号码可以直接再点
      setCodeSent(false);
      setError(res.error);
      return;
    }
    setCodeSent(true);
    setCooldown(60);
    const shown = countryCode + phone.replace(/[^\d]/g, "");
    setInfo(tpl("login.sms-sent", lang, { phone: shown }));
  }

  async function doVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await verifyRiderPhoneOtp({ phone, countryCode, token: code });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    if (res.needsProfile) {
      // 号码没在任何客户档案里 —— 引导去注册（session 已建立，验证码证明过号码归属）
      setInfo(t("login.new-here", lang));
      router.push("/rider/signup");
      return;
    }
    router.push(res.hasBike === false ? "/rider/bike-first" : "/rider/home");
    router.refresh();
  }

  const inputCls = "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
  const labelCls = "text-xs font-medium text-muted-foreground mb-1 block";
  const tabCls = (active: boolean) => `flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`;
  const phoneField = (disabled = false) => (
    <div>
      <label className={labelCls}>{t("login.phone", lang)}</label>
      <div className="flex gap-2">
        <select value={countryCode} disabled={disabled} onChange={(e) => setCountryCode(e.target.value)} className="w-32 rounded-md border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60">
          {COUNTRY_CODES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
        <input className={inputCls} type="tel" inputMode="tel" autoComplete="tel" required disabled={disabled} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("login.ph-phone", lang)} />
      </div>
    </div>
  );

  return (
    <LoginShell
      app="rider"
      eyebrow={t("login.badge.rider", lang)}
      title={t("login.title.rider", lang)}
      tagline={t("rider.login-sub", lang)}
      footer={
        <>
          <p className="text-xs">{t("login.role_customer", lang)}</p>
          <p className="text-xs">
            <a href="/rider/signup" className="font-medium text-primary hover:underline">{t("login.new-here", lang)}</a>
            {" · "}
            {tpl("login.need", lang, { app: t("login.badge.mechanic", lang) })}{" "}
            <a href="/mechanic-app/login" className="font-medium text-primary hover:underline">{t("login.link_mechanic", lang)}</a>
          </p>
          <p className="text-xs">
            {t("rider.staff-line", lang)}{" "}
            <a href="/login" className="font-medium text-primary hover:underline">{t("rider.workshop-signin", lang)}</a>
          </p>
        </>
      }
    >
      <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
        <button type="button" className={tabCls(tab === "phone")} onClick={() => switchTab("phone")}>{t("login.phone", lang)}</button>
        <button type="button" className={tabCls(tab === "sms")} onClick={() => switchTab("sms")}>{t("login.tab-sms", lang)}</button>
        <button type="button" className={tabCls(tab === "email")} onClick={() => switchTab("email")}>{t("login.email", lang)}</button>
      </div>

      {error && <p className="mb-3 rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">{error}</p>}
      {info && <p className="mb-3 rounded-md bg-primary/10 text-primary text-sm px-3 py-2">{info}</p>}

      {tab === "phone" && (
        <form onSubmit={(e) => { e.preventDefault(); doLogin(phone, countryCode); }} className="space-y-3">
          {phoneField()}
          <div>
            <label className={labelCls}>{t("login.password-tab", lang)}</label>
            <input className={inputCls} type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <button type="submit" disabled={busy} className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-50">
            {busy ? t("login.signing-in", lang) : t("login.signin", lang)}
          </button>
        </form>
      )}

      {tab === "sms" && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{t("login.sms-hint", lang)}</p>
          {phoneField(codeSent)}
          {!codeSent ? (
            <button type="button" disabled={busy || phone.replace(/[^\d]/g, "").length < 7} onClick={doSendCode} className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-50">
              {busy ? t("login.signing-in", lang) : t("login.send-code", lang)}
            </button>
          ) : (
            <form onSubmit={doVerifyCode} className="space-y-3">
              <div>
                <label className={labelCls}>{t("login.otp-code", lang)}</label>
                <input className={inputCls} inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
              </div>
              <button type="submit" disabled={busy || code.trim().length < 4} className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-50">
                {busy ? t("login.signing-in", lang) : t("login.verify-and-signin", lang)}
              </button>
              <button type="button" disabled={busy || cooldown > 0} onClick={doSendCode} className="w-full rounded-md border py-2 text-xs font-medium disabled:opacity-50">
                {cooldown > 0 ? tpl("login.resend-in", lang, { s: cooldown }) : t("login.resend-code", lang)}
              </button>
              <button type="button" onClick={() => { setCodeSent(false); setCode(""); setError(""); setInfo(""); }} className="w-full text-xs text-muted-foreground hover:underline">
                {t("common.cancel", lang)}
              </button>
            </form>
          )}
        </div>
      )}

      {tab === "email" && (
        <form onSubmit={(e) => { e.preventDefault(); doLogin(email, "+60"); }} className="space-y-3">
          <div>
            <label className={labelCls}>{t("common.email", lang)}</label>
            <input className={inputCls} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("login.ph-email", lang)} />
          </div>
          <div>
            <label className={labelCls}>{t("login.password-tab", lang)}</label>
            <input className={inputCls} type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <button type="submit" disabled={busy} className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-50">
            {busy ? t("login.signing-in", lang) : t("login.signin", lang)}
          </button>
        </form>
      )}
    </LoginShell>
  );
}
