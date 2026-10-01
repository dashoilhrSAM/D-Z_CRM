import Link from "next/link";
import { notFound } from "next/navigation";
import { platformService } from "@/modules/platform/service";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { purgeTenantAction, setTenantStatusAction } from "@/app/platform/actions";

export const dynamic = "force-dynamic";

/** 租户详情（P4 第三块）：状态、用量、以及**平台侧审计轨迹**（谁在什么时候停/恢复了它）。 */
export default async function PlatformTenantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ err?: string; ok?: string }>;
}) {
  const { slug } = await params;
  const { err, ok } = await searchParams;
  // 纵深防御：layout 已经判过，这里再判一次并**真的用返回值** ——
  // 忽略返回值的守卫只是装饰，起不到任何作用。
  const guard = await requirePlatformAdmin();
  if (!guard.ok) notFound();
  const detail = await platformService.tenantDetail(slug);
  if (!detail) notFound();
  const { tenant, audit, usage } = detail;
  // 退租预演：先把"要删多少行、删在哪几张表"摆出来，再让人打字确认
  const preview = tenant.status === "SUSPENDED" ? await platformService.purgePreview(tenant.id) : null;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://d-z-crm.vercel.app";
  const suspended = tenant.status === "SUSPENDED";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/platform" className="text-sm text-muted-foreground hover:text-foreground">← 租户</Link>
        <h1 className="text-lg font-semibold">{tenant.name}</h1>
        <span className={"text-sm " + (suspended ? "text-destructive" : "text-emerald-600")}>{tenant.status}</span>
      </div>

      {err && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          操作未生效：{err}
        </p>
      )}
      {ok && <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">{ok}</p>}

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">slug</dt><dd className="font-mono text-xs">{tenant.slug}</dd></div>
        <div><dt className="text-xs text-muted-foreground">员工</dt><dd className="tabular-nums">{usage.staff}</dd></div>
        <div><dt className="text-xs text-muted-foreground">客户</dt><dd className="tabular-nums">{usage.customers}</dd></div>
        <div><dt className="text-xs text-muted-foreground">开通于</dt><dd className="text-xs">{tenant.createdAt.toISOString().slice(0, 10)}</dd></div>
      </dl>

      <div className="rounded-lg border border-dashed p-3 text-sm">
        <Link href={"/platform/" + (tenant.slug ?? "") + "/support"} className="text-primary hover:underline">限时支持访问</Link>
        <span className="ml-2 text-xs text-muted-foreground">
          这家店的数据默认对平台不可见；要看先给自己一段限时的只读访问权（会记进**租户自己的审计日志**）。
        </span>
      </div>

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

      <section className="space-y-2 rounded-lg border border-destructive/40 p-4">
        <h2 className="text-sm font-semibold text-destructive">退租删除（不可逆）</h2>
        {tenant.status !== "SUSPENDED" ? (
          <p className="text-xs text-muted-foreground">先在上面把这家店**停用**，再回来退租 —— 两步走，避免顺手删掉一家还在营业的店。</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              将永久删除 <span className="font-medium tabular-nums">{preview?.total ?? 0}</span> 行
              {preview && preview.rows.length > 0 && (
                <>（{preview.rows.slice(0, 6).map((r) => r.model + " " + r.rows).join(" · ")}{preview.rows.length > 6 ? " …" : ""}）</>
              )}
              。删除后会在平台留一条**墓碑**：句柄 <span className="font-mono">{tenant.slug}</span> 永久不可再用（旧的门口二维码、打印链接不会指向下一家店）。
            </p>
            <form action={purgeTenantAction} className="space-y-2">
              <input type="hidden" name="organisationId" value={tenant.id} />
              {/* slug 是失败重定向回本页用的（少了它就会跳到租户列表，报错也没人看见） */}
              <input type="hidden" name="slug" value={tenant.slug ?? ""} />
              <input
                name="confirmSlug"
                required
                placeholder={"原样输入 " + (tenant.slug ?? "")}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <button type="submit" className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground">
                永久删除这家店
              </button>
            </form>
          </>
        )}
      </section>

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
