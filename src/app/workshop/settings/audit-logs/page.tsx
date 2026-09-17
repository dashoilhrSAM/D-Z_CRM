import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { getSessionUser } from "@/lib/session-user";
import { scopedBranchId } from "@/lib/branch-scope";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * 审计日志。
 *
 * 2026-09-17：把 MANAGER 放进后台功能之后补的一道**分行收窄**——他之前只能靠侧边栏藏起来
 * 才看不到这一页，页面本身**没有任何自店校验**（URL 直接打开就能读到全组织的审计）。
 * 这跟"数据仍限本店"冲突，所以这里按 branchId 收窄：org 级看全部，其余只看本店。
 * 顺带把"任何登录员工都能开 URL 看全组织审计"这个既有缺口一起堵上。
 */
export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<{ action?: string; entity?: string }> }) {
  const lang = await getLang();
  const sp = await searchParams;
  const session = await getSessionUser();
  const org = await db.organisation.findFirst();
  const branchScope = scopedBranchId(session);
  // 作用域（组织 + 分行）与筛选条件分开：上面的 action 计数条要统计**未按 action 过滤时**的分布，
  // 否则点进某个 action 之后所有其它 action 的计数都会变成 0。
  const scopeWhere: Record<string, unknown> = { organisationId: org!.id, ...(branchScope ? { branchId: branchScope } : {}) };
  const where: Record<string, unknown> = { ...scopeWhere };
  if (sp.action) where.action = { contains: sp.action };
  if (sp.entity) where.entity = sp.entity;
  const [rows, actionGroups] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }),
    db.auditLog.groupBy({ by: ["action"], where: scopeWhere, _count: true, orderBy: { _count: { action: "desc" } }, take: 15 }),
  ]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t("audit.title", lang)}</h1>
        <p className="text-sm text-muted-foreground">{t("audit.subtitle", lang)}</p>
      </div>
      <div className="flex gap-2 flex-wrap text-sm">
        <a href="/workshop/settings/audit-logs" className={"rounded-md border px-3 py-2 " + (!sp.action && !sp.entity ? "bg-primary text-primary-foreground" : "")}>{t("audit.all", lang)}</a>
        {actionGroups.map((a) => (
          <a key={a.action} href={"/workshop/settings/audit-logs?action=" + encodeURIComponent(a.action)} className={"rounded-md border px-3 py-2 " + (sp.action === a.action ? "bg-primary text-primary-foreground" : "")}>
            {a.action} ({a._count})
          </a>
        ))}
      </div>
      <div className="rounded-xl border bg-card overflow-x-auto">
        <div className="overflow-x-auto">
          <table className="dz-table">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">{t("audit.col-time", lang)}</th><th className="px-3 py-2.5 font-medium">{t("audit.col-action", lang)}</th><th className="px-3 py-2.5 font-medium">{t("audit.col-entity", lang)}</th>
                <th className="px-3 py-2.5 font-medium">{t("audit.col-branch", lang)}</th><th className="px-3 py-2.5 font-medium">{t("audit.col-after", lang)}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-3 py-2 text-xs">{r.entity}{r.entityId ? " · " + r.entityId.slice(-8) : ""}</td>
                  <td className="px-3 py-2 text-xs">{r.branchId?.slice(-4) ?? "—"}</td>
                  <td className="px-3 py-2 text-[11px] text-muted-foreground max-w-xs truncate">{r.after ?? ""}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">{t("audit.empty", lang)}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
