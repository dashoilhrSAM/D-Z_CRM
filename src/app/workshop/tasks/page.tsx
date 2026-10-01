import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { tasksModule } from "@/modules/tasks/service";
import { TaskList } from "@/components/workshop/task-list";
import { NewTaskForm } from "@/components/workshop/new-task-form";
import { PageTransition } from "@/components/shared/page-transition";
import { getLang } from "@/lib/get-lang";
import { t, tpl } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ status?: string; owner?: string }> }) {
  const lang = await getLang();
  const sp = await searchParams;
  const org = await db.organisation.findFirst();
  const { items, total, rawTotal } = await tasksModule.list({ organisationId: org!.id, ownerId: sp.owner || undefined, status: sp.status });
  const users = await db.user.findMany({ where: { organisationId: org!.id, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const leads = await db.lead.findMany({ where: { organisationId: org!.id, status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, customerName: true } });

  return (
    <PageTransition>
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("tasks.title", lang)}</h1>
          <p className="text-sm text-muted-foreground">{tpl("tasks.subtitle", lang, { n: rawTotal })}</p>
        </div>
        <details className="relative">
          <summary className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium cursor-pointer list-none">
            <Plus className="h-4 w-4" /> {t("tasks.new", lang)}
          </summary>
          <div className="absolute right-0 mt-2 w-80 z-20 rounded-xl border bg-card p-4 shadow-lg">
            <NewTaskForm users={users} leads={leads} />
          </div>
        </details>
      </div>

      <form method="get" className="flex gap-2 text-sm">
        <a href={"/workshop/tasks" + (sp.owner ? "?owner=" + sp.owner : "")} className={"rounded-md px-3 py-2 border " + (!sp.status ? "bg-primary text-primary-foreground border-primary" : "")}>{t("tasks.all", lang)}</a>
        <a href={"/workshop/tasks?status=OPEN" + (sp.owner ? "&owner=" + sp.owner : "")} className={"rounded-md px-3 py-2 border " + (sp.status === "OPEN" ? "bg-primary text-primary-foreground border-primary" : "")}>{t("tasks.open", lang)}</a>
        <a href={"/workshop/tasks?status=OVERDUE" + (sp.owner ? "&owner=" + sp.owner : "")} className={"rounded-md px-3 py-2 border " + (sp.status === "OVERDUE" ? "bg-primary text-primary-foreground border-primary" : "")}>{t("tasks.overdue", lang)}</a>
        <a href={"/workshop/tasks?status=COMPLETED" + (sp.owner ? "&owner=" + sp.owner : "")} className={"rounded-md px-3 py-2 border " + (sp.status === "COMPLETED" ? "bg-primary text-primary-foreground border-primary" : "")}>{t("tasks.completed", lang)}</a>
        <div className="flex-1" />
        <select name="owner" defaultValue={sp.owner} className="rounded-md border bg-background px-3 py-2">
          <option value="">{t("tasks.everyone", lang)}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </form>

      <TaskList items={items} />
    </div>
    </PageTransition>
  );
}
