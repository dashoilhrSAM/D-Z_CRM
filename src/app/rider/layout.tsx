import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/rider/bottom-nav";
import { getSessionUser } from "@/lib/session-user";
import { getRiderCustomer } from "@/lib/rider-customer";
import { getLang } from "@/lib/get-lang";
import { FeatureTutorialRider } from "@/components/rider/feature-tutorial-rider";

export default async function RiderLayout({ children }: { children: React.ReactNode }) {
  const [session, lang] = await Promise.all([getSessionUser(), getLang()]);
  // 顾客教程：拿 customerId + 是否有车（无车交由 bike-first 注册引导，先不弹教程）
  const rider = session.kind === "customer" ? await getRiderCustomer() : null;

  const h = await headers();
  const pathname = h.get("x-pathname") ?? "";
  const isAuthPage = pathname === "/rider/login" || pathname === "/rider/signup";

  // 未登录访问 rider 非认证页：直接跳登录表单页（不再显示中间引导页）
  if (!isAuthPage && session.kind === "none" && !session.authenticated) {
    redirect("/rider/login");
  }

  // 多家店都有身份却没选店 → 先选（**不能**替他挑一家；P3b 第 4 步）
  if (!isAuthPage && session.needsWorkshopChoice) {
    redirect("/select-workshop");
  }

  // 已登录员工/技师：rider 端仅顾客可用 → 重定向各自入口
  if (!isAuthPage && session.authenticated && session.kind === "staff") {
    redirect(session.role === "MECHANIC" ? "/mechanic-app" : "/workshop/dashboard");
  }

  return (
    <div className="flex min-h-dvh flex-col bg-muted/40 bg-[radial-gradient(110%_55%_at_50%_-12%,oklch(0.62_0.19_45/0.06),transparent_65%)]">
      {/* 认证页（login/signup）无底部导航；其他页保留（内容底部预留 nav 空间） */}
      <main className={"flex-1 w-full max-w-md mx-auto px-4 py-6 " + (isAuthPage ? "pb-10" : "pb-28")}>
        {children}
      </main>
      {!isAuthPage && <BottomNav lang={lang} />}
      {!isAuthPage && rider && <FeatureTutorialRider customerId={rider.id} hasBike={(rider.motorcycles?.length ?? 0) > 0} />}
    </div>
  );
}