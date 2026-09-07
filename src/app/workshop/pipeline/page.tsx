import Link from "next/link";
import { Plus, Filter } from "lucide-react";
import { db } from "@/lib/db";
import { pipelineStats } from "@/modules/leads/pipeline";
import { tasksModule } from "@/modules/tasks/service";
import { PipelineBoard } from "@/components/workshop/pipeline-board";
import { formatRM } from "@/lib/money";
import { PendingForm } from "@/components/shared/search-form";
import { getLang } from "@/lib/get-lang";
import { getSessionUser } from "@/lib/session-user";
import { applyBranchScope } from "@/lib/branch-scope";
import { t, tpl } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ owner?: string; source?: string; q?: string }> }) {
  const lang = await getLang();
  const sp = await searchParams;
  const org = await db.organisation.findFirst();
  const session = await getSessionUser();
  const leadWhere: Record<string, unknown> = { organisationId: org!.id, status: "OPEN", assignedUserId: sp.owner || undefined, sourceId: sp.source || undefined, ...(sp.q ? { customerName: { contains: sp.q } } : {}) };
  applyBranchScope(leadWhere, session, null); // 严格隔离：branch 级只看本分行 leads
  const [stats, leads, sources, salespeople, stale] = await Promise.all([
    pipelineStats(org!.id, { assignedUserId: sp.owner, sourceId: sp.source }),
    db.lead.findMany({
      where: leadWhere,
      include: { source: true, stage: true, assignedUser: { select: { id: true, name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    db.leadSource.findMany({ where: { organisationId: org!.id, active: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { organisationId: org!.id, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    tasksModule.staleLeads(org!.id),
  ]);
  const staleIds = new Set(stale.map((l) => l.id));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("pipeline.title", lang)}</h1>
          <p className="text-sm text-muted-foreground">
            {tpl("pipeline.subtitle", lang, { open: stats.total, value: formatRM(stats.totalValueSen * 100), rate: stats.conversionRate, days: stats.avgDaysInStage })}
          </p>
        </div>
        <Link href="/workshop/leads/new" className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium">
          <Plus className="h-4 w-4" /> {t("pipeline.new-lead", lang)}
        </Link>
      </div>

      <PendingForm className="flex flex-wrap gap-2 text-sm">
        <select name="owner" defaultValue={sp.owner} className="rounded-md border bg-background px-3 py-2">
          <option value="">{t("pipeline.all-salespeople", lang)}</option>
          {salespeople.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select name="source" defaultValue={sp.source} className="rounded-md border bg-background px-3 py-2">
          <option value="">{t("pipeline.all-sources", lang)}</option>
          {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input name="q" defaultValue={sp.q} placeholder={t("pipeline.search-name", lang)} className="rounded-md border bg-background px-3 py-2" />
        <button className="rounded-md border px-3 py-2 font-medium"><Filter className="inline h-3.5 w-3.5 mr-1" />{t("pipeline.filter", lang)}</button>
      </PendingForm>

      <PipelineBoard
        stages={stats.stages}
        leads={leads.map((l) => ({
          id: l.id, customerName: l.customerName, phone: l.phone, valueSen: l.estimatedValueSen ?? 0,
          source: l.source?.name ?? "—", owner: l.assignedUser?.name ?? t("pipeline.unassigned", lang),
          stageId: l.stageId, isStale: staleIds.has(l.id), updatedAt: l.updatedAt,
        }))}
      />
    </div>
  );
}