import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform/guard";

export const dynamic = "force-dynamic";

/**
 * 平台台外壳（P4）。**所有 `/platform/*` 都从这里过一遍守卫**。
 *
 * 未登录 → 去登录（带 `next` 回得来）；已登录但不是平台管理员 → 404
 * （不确认这个路由存在，见 lib/platform/guard.ts 的说明）。
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok && guard.reason === "anonymous") redirect("/login?next=" + encodeURIComponent("/platform"));
  if (!guard.ok) notFound();

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-4 py-3">
          <span className="text-sm font-semibold">D&amp;Z 平台台</span>
          <nav className="flex items-center gap-3 text-sm text-muted-foreground">
            <Link href="/platform" className="hover:text-foreground">租户</Link>
            <Link href="/platform/new" className="hover:text-foreground">开新店</Link>
            <Link href="/platform/templates" className="hover:text-foreground">模板</Link>
          </nav>
          <span className="ml-auto text-xs text-muted-foreground">{guard.admin.email ?? guard.admin.authId.slice(0, 8)}</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
