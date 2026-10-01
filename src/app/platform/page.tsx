import Link from "next/link";
import { platformService } from "@/modules/platform/service";
import { requirePlatformAdmin } from "@/lib/platform/guard";

export const dynamic = "force-dynamic";

/** 租户目录（P4）：**以 slug 为键** —— 它是门店链接、备份命名、日志的公共句柄。 */
export default async function PlatformTenantsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { ok, err } = await searchParams;
  const guard = await requirePlatformAdmin();
  if (guard.ok) await platformService.touchAdmin(guard.admin.authId);

  const tenants = await platformService.listTenants();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://d-z-crm.vercel.app";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">租户（{tenants.length}）</h1>
        <Link href="/platform/new" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">开新店</Link>
      </div>

      {err && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">操作未生效：{err}</p>
      )}
      {ok && <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">{ok}</p>}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">店名</th>
              <th className="px-3 py-2">slug</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2 text-right">员工</th>
              <th className="px-3 py-2 text-right">客户</th>
              <th className="px-3 py-2">开通于</th>
              <th className="px-3 py-2">链接</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="px-3 py-2 font-medium">
                  {t.slug ? <Link href={"/platform/" + t.slug} className="hover:underline">{t.name}</Link> : t.name}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{t.slug ?? <span className="text-muted-foreground">（无）</span>}</td>
                <td className="px-3 py-2">
                  <span className={t.status === "ACTIVE" ? "text-emerald-600" : t.status === "TRIAL" ? "text-amber-600" : "text-muted-foreground"}>
                    {t.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{t.staff}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.customers}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{t.createdAt.toISOString().slice(0, 10)}</td>
                <td className="px-3 py-2 text-xs">
                  {t.slug ? (
                    <>
                      <a href={appUrl + "/t/" + t.slug} className="text-primary hover:underline">门店链接</a>
                      <span className="text-muted-foreground"> · </span>
                      <a href={appUrl + "/t/" + t.slug + "/signup"} className="text-primary hover:underline">注册链接</a>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
            {tenants.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">还没有租户</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        门店二维码在「开新店」成功后一次性给出；门店链接即 <span className="font-mono">/t/&lt;slug&gt;</span>，可直接发给店主或打印成二维码。
      </p>
    </div>
  );
}
