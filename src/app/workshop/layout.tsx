import { CommandPalette } from "@/components/shared/command-palette";
import { ThemeControls } from "@/components/shared/theme-controls";
import { LanguageToggle } from "@/components/shared/language-toggle";
import { ScanQrButton } from "@/components/workshop/scan-qr-button";
import { RefreshControls } from "@/components/workshop/refresh-controls";
import { Sidebar } from "@/components/workshop/sidebar";
import { MobileNav, type MobileNavItem } from "@/components/workshop/mobile-nav";
import { FeatureTutorial } from "@/components/workshop/feature-tutorial";
import { TutorialHelpMenu } from "@/components/workshop/tutorial-help-menu";
import { WorkshopAIAssistant } from "@/components/workshop/ai-assistant";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { navForRoleWithPerms, navItemForPath } from "@/lib/nav-perms";
import { getSessionUser, personaForRole } from "@/lib/session-user";
import { getLang } from "@/lib/get-lang";

export default async function WorkshopLayout({ children }: { children: React.ReactNode }) {
  const [session, lang] = await Promise.all([getSessionUser(), getLang()]);

  // —— Workshop OS 访问守卫：仅员工且非 MECHANIC ——
  if (!session.authenticated) redirect("/login");
  if (session.kind === "customer") redirect("/rider/home"); // rider 不能进 workshop OS（电脑版也不行）
  if (session.role === "MECHANIC") redirect("/mechanic-app"); // mechanic 只能 app

  // —— URL 级模块守卫：当前页归属 module 无 view 权限 → 拦回 dashboard（Developer Settings 开关即时生效） ——
  const h = await headers();
  const pathname = h.get("x-pathname") ?? "";
  const navItem = navItemForPath(pathname);
  if (navItem?.module) {
    const allowed = await can({ id: session.user!.id, role: session.role as never, organisationId: session.orgId }, navItem.module, "view");
    if (!allowed) redirect("/workshop/dashboard");
  }

  // Sidebar 需要 persona（nav-registry 按角色导航分组过滤）+ 用户信息
  const persona = personaForRole(session.role);

  const sidebarUser = session.authenticated
    ? { id: session.user?.id ?? "", name: session.name, roleLabel: session.role, initials: session.initials }
    : undefined;
  // 侧边栏品牌区显示登录用户所在分行（branch 级=其分行；org 级=主店）
  const sidebarBranch = session.branchId
    ? await db.branch.findUnique({ where: { id: session.branchId }, select: { name: true, city: true } })
    : await db.branch.findFirst({ where: { isMain: true }, select: { name: true, city: true } });
  const branchLabel = sidebarBranch ? `${sidebarBranch.name} · ${sidebarBranch.city}` : undefined;

  // 导航：DB Permission 覆盖感知（Developer Settings 开关即时反映）；sidebar/mobile 共用
  const filteredNav = session.authenticated ? await navForRoleWithPerms(session.orgId, session.role, persona) : [];
  const MOBILE_KEYS = new Set(["dashboard", "customers", "bookings", "jobs", "mechanic"]);
  const mobileItems: MobileNavItem[] = filteredNav
    .flatMap((g) => g.items)
    .filter((i) => MOBILE_KEYS.has(i.key))
    .slice(0, 5)
    .map((i) => ({ key: i.key, href: i.href, label: i.label }));

  return (
    <div className="flex min-h-screen bg-muted/30 bg-[radial-gradient(90%_70%_at_88%_-12%,oklch(0.62_0.19_45/0.07),transparent_60%)]">
      <Sidebar persona={persona} sections={filteredNav} role={session.authenticated ? session.role : undefined} user={sidebarUser} branchLabel={branchLabel} lang={lang} />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="hidden lg:flex items-center gap-4 border-b bg-background px-6 h-16">
          <CommandPalette />
          <div className="flex-1" />
          <RefreshControls />
          <ScanQrButton />
          <TutorialHelpMenu userId={sidebarUser?.id ?? ""} />
          <LanguageToggle lang={lang} compact />
          <ThemeControls />
        </div>
        {/* 移动端：顶部 sticky 刷新条（自动刷新 + 手动按钮常驻） */}
        <div className="lg:hidden sticky top-0 z-20 border-b bg-background/95 backdrop-blur px-4 py-2 flex items-center justify-between">
          <RefreshControls compact />
          <LanguageToggle lang={lang} compact />
        </div>
        <main className="flex-1 px-4 md:px-6 py-6 pb-24 lg:pb-8 max-w-7xl w-full mx-auto">{children}</main>
        <MobileNav items={mobileItems.length ? mobileItems : [{ key: "dashboard", href: "/workshop/dashboard", label: "Dashboard" }]} />
      </div>
      {/* In-app feature tutorial: 首次进入某功能页触发该页引导 */}
      <FeatureTutorial userId={sidebarUser?.id ?? ""} />
      {/* Workshop AI assistant — 左下角浮动助手（可调大小 / 可最小化） */}
      <WorkshopAIAssistant userId={sidebarUser?.id ?? ""} />
    </div>
  );
}