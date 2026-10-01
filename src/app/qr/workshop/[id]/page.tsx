import { notFound } from "next/navigation";
import { Store, MapPin, Phone, Clock, Wrench } from "lucide-react";
import { db } from "@/lib/db";
import { getRiderCustomer } from "@/lib/rider-customer";
import { chooseWorkshop } from "@/actions/tenant-context";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * QR 落地页 C（QR-003 门店码）：Rider 扫码 → 门店资料 + 「确认进入」把这家店设为当前门店。
 * 「确认进入」走 `chooseWorkshop`（与多店选择器同一个入口）：**只能从他 AuthLink 的候选里选** ——
 * 表单里的 organisationId 只表示「他点了哪家店」，不代表「他有哪家店的权限」。
 * Deep link：/qr/workshop/<Organisation.id>
 */
export default async function QrWorkshopPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ branch?: string }> }) {
  const { id } = await params;
  const { branch: branchParam } = await searchParams;
  const lang = await getLang();
  // QR 编码 qrToken（不可枚举）；兼容旧 id 直查；?branch= 指定某分行（per-branch 门店码）
  const org = await db.organisation.findFirst({ where: { OR: [{ qrToken: id }, { id }] }, include: { branches: true } });
  if (!org) notFound();
  const customer = await getRiderCustomer();
  const mainBranch = (branchParam ? org.branches.find((b) => b.id === branchParam) : undefined) ?? org.branches.find((b) => b.isMain) ?? org.branches[0];

  let hours: Record<string, string> = {};
  try { hours = org.operatingHours ? JSON.parse(org.operatingHours) : {}; } catch {}

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-4 py-8">
      <div className="w-full rounded-3xl border bg-card p-6 text-center">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center"><Store className="h-7 w-7" /></div>
        <h1 className="mt-3 text-xl font-bold">{org.name}</h1>
        <p className="text-sm text-muted-foreground">{t("qr.workshop-welcome", lang)}</p>

        <div className="mt-5 space-y-2 text-left text-sm">
          {mainBranch && (
            <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="h-4 w-4 shrink-0" /> <span>{mainBranch.address ?? t("qr.main-branch", lang)}</span></div>
          )}
          {org.contactPhone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-4 w-4 shrink-0" /> <span>{org.contactPhone}</span></div>}
          {org.contactEmail && <div className="flex items-center gap-2 text-muted-foreground"><MailIcon /> <span>{org.contactEmail}</span></div>}
          {Object.keys(hours).length > 0 && (
            <div className="flex items-start gap-2 text-muted-foreground"><Clock className="h-4 w-4 shrink-0 mt-0.5" /> <span>{Object.entries(hours).slice(0, 3).map(([d, h]) => d + ": " + h).join(" · ")}</span></div>
          )}
          {mainBranch && <div className="flex items-center gap-2 text-muted-foreground"><Wrench className="h-4 w-4 shrink-0" /> <span>{t("qr.service-repair", lang)}</span></div>}
        </div>

        <form action={chooseWorkshop} className="mt-6">
          <input type="hidden" name="organisationId" value={org.id} />
          {/* 未登录时回跳到本页。过去这一步写的是既不签名、也没人读的 dz_org（P3b 第 5 步已删） */}
          <input type="hidden" name="next" value={"/qr/workshop/" + org.id} />
          <button type="submit" className="w-full rounded-2xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground">
            {customer ? t("qr.confirm-start", lang) : t("qr.signin-start", lang)}
          </button>
        </form>
        {!customer && (
          <p className="mt-3 text-xs text-muted-foreground">
            <Link href={"/rider/login?next=" + encodeURIComponent("/qr/workshop/" + org.id)} className="text-primary hover:underline">{t("qr.signin", lang)}</Link> {t("qr.signin-hint", lang)}
          </p>
        )}
        <p className="mt-4 text-[10px] text-muted-foreground">{t("qr.scan-workshop", lang)}</p>
      </div>
    </main>
  );
}

function MailIcon() {
  return <span className="h-4 w-4 shrink-0 text-muted-foreground">✉</span>;
}
