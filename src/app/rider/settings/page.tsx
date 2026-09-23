import Link from "next/link";
import { ChevronLeft, User, Shield, Languages, Bell, ShieldCheck } from "lucide-react";
import { getRiderCustomer } from "@/lib/rider-customer";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";
import { PageTransition } from "@/components/shared/page-transition";
import { ProfileForm } from "@/components/rider/profile-form";
import { LanguageSwitcher } from "@/components/rider/language-switcher";
import { NotificationPrefsForm } from "@/components/rider/notification-prefs-form";
import { ChangePasswordForm } from "@/components/rider/change-password-form";
import { PhoneChangeForm } from "@/components/rider/phone-change-form";
import { parsePrefs } from "@/lib/rider-prefs";

export const dynamic = "force-dynamic";

/**
 * Rider Settings：个人资料 / 语言 / 通知偏好 / 安全（更换密码）+ 账号信息。
 */
export default async function RiderSettingsPage() {
  const lang = await getLang();
  const customer = await getRiderCustomer();
  if (!customer) return null;

  return (
    <PageTransition>
    <div className="space-y-5">
      <Link href="/rider/profile" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ChevronLeft className="h-4 w-4" /> {t("rider.back-profile", lang)}
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("settings.title", lang)}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("settings.subtitle", lang)}</p>
      </div>

      {/* 个人资料编辑 */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <User className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">{t("settings.profile", lang)}</h2>
        </div>
        <ProfileForm
          customerId={customer.id}
          initial={{
            name: customer.name,
            phone: customer.phone ?? "",
            email: customer.email ?? "",
            gender: customer.gender ?? "",
            address: customer.address ?? "",
          }}
        />
      </div>

      {/* 手机号（登录标识：改号必须验证新号码，所以单独一张卡） */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">{t("settings.phone-section", lang)}</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {customer.phone ? customer.phone + " · " : t("settings.phone-none", lang) + " · "}
          {t("settings.phone-desc", lang)}
        </p>
        <PhoneChangeForm lang={lang} verified={!!customer.authProfile?.phoneVerified} />
      </div>

      {/* 语言切换 */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Languages className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">{t("settings.language", lang)}</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">{t("settings.language-desc", lang)}</p>
        <LanguageSwitcher current={lang} />
      </div>

      {/* 通知偏好 */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Bell className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">{t("settings.notifications", lang)}</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">{t("settings.notifications-desc", lang)}</p>
        <NotificationPrefsForm initial={parsePrefs(customer.notificationPrefs)} lang={lang} />
      </div>

      {/* 安全：更换密码 */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">{t("settings.security", lang)}</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">{t("settings.security-desc", lang)}</p>
        <ChangePasswordForm lang={lang} />
      </div>

      {/* 账号信息 */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">{t("settings.account", lang)}</h2>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2.5">
            <span className="text-muted-foreground">{t("settings.member-since", lang)}</span>
            <span className="font-medium">{customer.joinedAt.getFullYear()}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2.5">
            <span className="text-muted-foreground">{t("settings.rider-id", lang)}</span>
            <span className="font-mono text-xs">{customer.qrToken ?? customer.id.slice(-6)}</span>
          </div>
        </div>
      </div>

      <p className="text-center text-[11px] text-muted-foreground">D&Z Rider · {t("settings.title", lang)}</p>
    </div>
    </PageTransition>
  );
}
