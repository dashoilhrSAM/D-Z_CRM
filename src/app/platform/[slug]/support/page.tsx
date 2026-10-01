import Link from "next/link";
import { notFound } from "next/navigation";
import { platformService, MIN_SUPPORT_MINUTES, MAX_SUPPORT_MINUTES } from "@/modules/platform/service";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { grantSupportAccessAction, revokeSupportAccessAction } from "@/app/platform/actions";

export const dynamic = "force-dynamic";

/**
 * 限时支持访问（P4 第三块）—— 平台人员看租户数据的**唯一**正当路径。
 *
 * 四条约束都写在这里或者它调用的服务里：
 *  ① 必须先授权（带原因 + 期限，服务端判过期与撤销）；
 *  ② 授权**按人**（只有被授权的那个人能用）；
 *  ③ 看到的东西是**白名单只读快照**（不是"把租户端搬过来"），这个文件里**没有任何写路径**；
 *  ④ **每次查看都双向留痕**：平台侧 + 租户自己的审计页。
 */
export default async function SupportAccessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guard = await requirePlatformAdmin();
  if (!guard.ok) notFound();

  const detail = await platformService.tenantDetail(slug);
  if (!detail) notFound();
  const { tenant } = detail;
  const actor = { authId: guard.admin.authId, email: guard.admin.email };

  const grant = await platformService.activeSupportAccess(tenant.id, actor.authId);
  const snapshot = grant ? await platformService.supportSnapshot(tenant.id) : null;
  // **先记后读**：有有效授权才记"查看"（没授权时这一页只是授权入口，不算访问租户数据），
  // 而且要在读审计**之前**记 —— 否则"我这次访问"不会出现在下面的列表里，
  // 看的人会以为"没记上"（审计页的第一要求是可信，不是好看）。
  if (grant && snapshot) await platformService.logSupportView({ organisationId: tenant.id, actor });
  const [grants, platformAudit] = await Promise.all([
    platformService.listSupportGrants(tenant.id, 10),
    platformService.listAudit({ organisationId: tenant.id, limit: 20 }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={"/platform/" + slug} className="text-sm text-muted-foreground hover:text-foreground">← {tenant.name}</Link>
        <h1 className="text-lg font-semibold">限时支持访问</h1>
      </div>

      {!grant ? (
        <form action={grantSupportAccessAction} className="max-w-xl space-y-3 rounded-lg border p-4">
          <input type="hidden" name="organisationId" value={tenant.id} />
          <input type="hidden" name="slug" value={slug} />
          <p className="text-sm">
            这家店的数据默认对平台**不可见**。要排查问题，先给自己一段**限时**的只读访问权 ——
            原因与时长都会写进**租户自己的审计日志**（他们看得见你来过）。
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="reason">原因 *（记进双方审计）</label>
            <input id="reason" name="reason" required minLength={4} className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="例：店主反馈工单状态卡住，需要核对数据" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="minutes">时长（分钟，{MIN_SUPPORT_MINUTES}–{MAX_SUPPORT_MINUTES}）</label>
            <input id="minutes" name="minutes" type="number" min={MIN_SUPPORT_MINUTES} max={MAX_SUPPORT_MINUTES} defaultValue={60} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </div>
          <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">开始支持会话</button>
        </form>
      ) : (
        <>
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <p className="font-medium text-amber-700">
              支持会话进行中 · 到期 {grant.expiresAt.toISOString().slice(0, 16).replace("T", " ")}（UTC）
            </p>
            <p className="mt-1 text-xs text-amber-700">原因：{grant.reason}｜本次访问已记入双方审计。到期后自动失效。</p>
            <form action={revokeSupportAccessAction} className="mt-2">
              <input type="hidden" name="organisationId" value={tenant.id} />
              <input type="hidden" name="slug" value={slug} />
              <button type="submit" className="rounded-md border px-3 py-1.5 text-xs">立刻结束会话</button>
            </form>
          </div>

          {snapshot && (
            <div className="space-y-4">
              <dl className="grid grid-cols-3 gap-3 text-sm sm:grid-cols-5">
                {([["员工", snapshot.counts.staff], ["客户", snapshot.counts.customers], ["工单", snapshot.counts.jobs], ["发票", snapshot.counts.invoices], ["预约", snapshot.counts.bookings]] as const).map(([k, v]) => (
                  <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="tabular-nums">{v}</dd></div>
                ))}
              </dl>

              <section>
                <h2 className="text-sm font-semibold">最近工单（只读）</h2>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {snapshot.recentJobs.map((j) => (
                    <li key={j.jobNumber} className="flex gap-3 border-b py-1">
                      <span className="font-mono">{j.jobNumber}</span><span>{j.status}</span>
                      <span className="text-muted-foreground">{j.customer ?? "—"}</span>
                      <span className="ml-auto text-muted-foreground">{j.createdAt.toISOString().slice(0, 10)}</span>
                    </li>
                  ))}
                  {snapshot.recentJobs.length === 0 && <li className="text-muted-foreground">没有工单</li>}
                </ul>
              </section>

              <section>
                <h2 className="text-sm font-semibold">员工（只读）</h2>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {snapshot.staff.map((s) => (
                    <li key={s.name} className="flex gap-3 border-b py-1"><span>{s.name}</span><span className="text-muted-foreground">{s.role}</span><span className="ml-auto text-muted-foreground">{s.email ?? "—"}</span></li>
                  ))}
                </ul>
              </section>

              <section>
                <h2 className="text-sm font-semibold">租户自己的审计（含我们进来的记录）</h2>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {snapshot.tenantAudit.map((a, i) => (
                    <li key={i} className="flex gap-3 border-b py-1">
                      <span className="font-mono text-muted-foreground">{a.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                      <span>{a.action}</span><span className="text-muted-foreground">{a.entity}</span>
                      {a.detail && <span className="text-muted-foreground">— {a.detail}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </>
      )}

      <section className="space-y-1">
        <h2 className="text-sm font-semibold">授权历史（平台侧）</h2>
        <ul className="space-y-0.5 text-xs">
          {grants.map((g) => (
            <li key={g.id} className="flex flex-wrap gap-2 border-b py-1">
              <span className="font-mono text-muted-foreground">{g.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
              <span>{g.grantedByEmail ?? g.grantedByAuthId.slice(0, 8)}</span>
              <span className="text-muted-foreground">至 {g.expiresAt.toISOString().slice(0, 16).replace("T", " ")}</span>
              <span className={g.revokedAt ? "text-destructive" : "text-emerald-600"}>{g.revokedAt ? "已撤销" : "有效/已过期"}</span>
              <span className="text-muted-foreground">— {g.reason}</span>
            </li>
          ))}
          {grants.length === 0 && <li className="text-muted-foreground">还没有授权记录</li>}
        </ul>
      </section>

      <section className="space-y-1">
        <h2 className="text-sm font-semibold">平台侧动作</h2>
        <ul className="space-y-0.5 text-xs">
          {platformAudit.filter((a) => a.action.startsWith("SUPPORT")).map((a) => (
            <li key={a.id} className="flex gap-2 border-b py-1">
              <span className="font-mono text-muted-foreground">{a.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
              <span>{a.action}</span><span className="text-muted-foreground">{a.actorEmail ?? a.actorAuthId.slice(0, 8)}</span>
              {a.detail && <span className="text-muted-foreground">— {a.detail}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
