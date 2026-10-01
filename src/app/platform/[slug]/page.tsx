import Link from "next/link";
import { notFound } from "next/navigation";
import { platformService } from "@/modules/platform/service";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { setTenantStatusAction } from "@/app/platform/actions";

export const dynamic = "force-dynamic";

/** 租户详情（P4 第三块）：状态、用量、以及**平台侧审计轨迹**（谁在什么时候停/恢复了它）。 */
export default async function PlatformTenantDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // 纵深防御：layout 已经判过，这里再判一次并**真的用返回值** ——
  // 忽略返回值的守卫只是装饰，起不到任何作用。
  const guard = await requirePlatformAdmin();
  if (!guard.ok) notFound();
  const detail = await platformService.tenantDetail(slug);
  if (!detail) notFound();
  const { tenant, audit, usage } = detail;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://d-z-crm.vercel.app";
  const suspended = tenant.status === "SUSPENDED";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/platform" className="text-sm text-muted-foreground hover:text-foreground">← 租户</Link>
        <h1 className="text-lg font-semibold">{tenant.name}</h1>
        <span className={"text-sm " + (suspended ? "text-destructive" : "text-emerald-600")}>{tenant.status}</span>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">slug</dt><dd className="font-mono text-xs">{tenant.slug}</dd></div>
        <div><dt className="text-xs text-muted-foreground">员工</dt><dd className="tabular-nums">{usage.staff}</dd></div>
        <div><dt className="text-xs text-muted-foreground">客户</dt><dd className="tabular-nums">{usage.customers}</dd></div>
        <div><dt className="text-xs text-muted-foreground">开通于</dt><dd className="text-xs">{tenant.createdAt.toISOString().slice(0, 10)}</dd></div>
      </dl>

      <div className="flex flex-wrap gap-3 text-sm">
        {tenant.slug && <a href={appUrl + "/t/" + tenant.slug} className="text-primary hover:underline">门店链接</a>}
        {tenant.qrToken && <a href={appUrl + "/qr/workshop/" + tenant.qrToken} className="text-primary hover:underline">门店码</a>}
      </div>

      <form action={setTenantStatusAction} className="space-y-2 rounded-lg border p-4">
        <input type="hidden" name="organisationId" value={tenant.id} />
        <input type="hidden" name="slug" value={tenant.slug ?? ""} />
        <input type="hidden" name="status" value={suspended ? "ACTIVE" : "SUSPENDED"} />
        <p className="text-sm font-medium">{suspended ? "恢复这家店" : "停用这家店"}</p>
        <p className="text-xs text-muted-foreground">
          {suspended
            ? "恢复后它的员工/顾客可以重新登录进店（被停用期间拿不到新的业务身份）。"
            : "停用会**立刻**生效：入口不再认这家店，已登录的人下一次请求就失去业务身份（不必等他们登出）。"}
        </p>
        <input name="reason" placeholder={suspended ? "恢复原因（可选）" : "停用原因（会写进审计，建议写清楚）"}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
        <button type="submit" className={"rounded-md px-3 py-1.5 text-sm font-medium " + (suspended ? "bg-primary text-primary-foreground" : "border border-destructive text-destructive")}>
          {suspended ? "恢复" : "停用"}
        </button>
      </form>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">平台侧审计（谁在什么时候动过这家店）</h2>
        <ul className="space-y-1 text-xs">
          {audit.map((a) => (
            <li key={a.id} className="flex flex-wrap gap-2 border-b py-1">
              <span className="font-mono text-muted-foreground">{a.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
              <span className="font-medium">{a.action}</span>
              <span className="text-muted-foreground">{a.actorEmail ?? a.actorAuthId.slice(0, 8)}</span>
              {a.detail && <span className="text-muted-foreground">— {a.detail}</span>}
            </li>
          ))}
          {audit.length === 0 && <li className="text-muted-foreground">还没有平台侧动作</li>}
        </ul>
      </div>
    </div>
  );
}
