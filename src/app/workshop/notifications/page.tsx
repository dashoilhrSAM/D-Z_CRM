import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { db } from "@/lib/db";
import { markAllNotificationsRead } from "@/actions/notifications";
import { fmtDateTime } from "@/lib/format";
import { MarkReadButton } from "@/components/workshop/mark-read-button";
import { getLang } from "@/lib/get-lang";
import { getSessionUser } from "@/lib/session-user";
import { scopedBranchId } from "@/lib/branch-scope";
import { t, tpl } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ type?: string; all?: string }> }) {
  const lang = await getLang();
  const sp = await searchParams;
  const org = await db.organisation.findFirst();
  const session = await getSessionUser();
  const scopeId = scopedBranchId(session);
  // base scope (branch or system-wide) — branch 级只看本分行 + 系统通知；org 级看全部分行
  const baseWhere: Record<string, unknown> = scopeId
    ? { AND: [{ OR: [{ branchId: { equals: scopeId } }, { branchId: null }] }] }
    : { OR: [{ branch: { organisationId: org!.id } }, { branchId: null }] };
  const where: Record<string, unknown> = { ...baseWhere };
  if (sp.type) where.type = sp.type;
  const [items, unread, typeCounts] = await Promise.all([
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include: { branch: { select: { city: true } } } }),
    db.notification.count({ where: { ...where, readAt: null } }),
    // all-type grouping (no type filter) so every filter button stays visible
    db.notification.groupBy({ by: ["type"], where: baseWhere, _count: true }),
  ]);
  const visible = sp.all ? items : items.filter((n) => n.userId === null || n.userId === undefined);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Bell className="h-5 w-5" /> {t("notif.title", lang)}</h1>
          <p className="text-sm text-muted-foreground">{tpl("notif.subtitle", lang, { unread, total: items.length })}</p>
        </div>
        <form action={markAllNotificationsRead}>
          <button className="rounded-md border px-3 py-2 text-sm font-medium inline-flex items-center gap-1.5"><CheckCheck className="h-4 w-4" /> {t("notif.mark-all", lang)}</button>
        </form>
      </div>

      <div className="flex gap-2 text-sm flex-wrap">
        <a href="/workshop/notifications" className={"rounded-md border px-3 py-2 " + (!sp.type ? "bg-primary text-primary-foreground" : "")}>{t("notif.all", lang)}</a>
        {typeCounts.map((t) => (
          <a key={t.type} href={"/workshop/notifications?type=" + t.type} className={"rounded-md border px-3 py-2 " + (sp.type === t.type ? "bg-primary text-primary-foreground" : "")}>
            {t.type} ({t._count})
          </a>
        ))}
      </div>

      <div className="rounded-xl border bg-card divide-y">
        {visible.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">{t("notif.empty", lang)}</div>}
        {visible.map((n) => (
          <div key={n.id} className={"px-4 py-3 flex items-start gap-3 " + (n.readAt ? "opacity-60" : "")} data-testid="notif-row">
            <span className={"mt-1.5 h-2 w-2 shrink-0 rounded-full " + (n.readAt ? "bg-muted" : "bg-primary")} />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{n.title}</div>
              {n.body && <div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>}
              <div className="text-[11px] text-muted-foreground/70 mt-1">
                {fmtDateTime(n.createdAt)} · {n.type}{n.branch ? " · " + n.branch.city : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {n.link && <Link href={n.link} className="text-xs text-primary hover:underline">{t("notif.open", lang)}</Link>}
              {!n.readAt && <MarkReadButton id={n.id} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}