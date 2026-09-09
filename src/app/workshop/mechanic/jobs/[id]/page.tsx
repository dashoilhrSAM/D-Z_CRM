import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { jobService } from "@/modules/service-jobs/service";
import { ChecklistRunner } from "@/components/workshop/checklist-runner";
import { StatusBadge } from "@/components/shared/status-badge";
import { EditJobForm, type EditJobData } from "@/components/workshop/edit-job-form";
import { db } from "@/lib/db";
import { fmtKM } from "@/lib/format";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session-user";
import { scopedStaffWhere } from "@/lib/branch-scope";

export const dynamic = "force-dynamic";

export default async function MechanicJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang = await getLang();
  const session = await getSessionUser();
  const detail = await jobService.getDetail(id);
  if (!detail) notFound();

  const rawMechanics = await db.user.findMany({ where: scopedStaffWhere(session, ["MECHANIC", "MANAGER"]), select: { id: true, name: true, branch: { select: { name: true } } }, orderBy: { name: "asc" } });
  const mechanics = rawMechanics.map((m) => ({ id: m.id, name: m.name, branchName: m.branch?.name ?? null }));
  const editData: EditJobData = {
    jobId: detail.id,
    mileage: detail.mileage,
    customerRequest: detail.customerRequest ?? null,
    mechanicId: detail.mechanicId ?? null,
    motorcycleType: detail.motorcycle.type,
    items: [
      ...detail.items.map((i) => ({ id: i.id, description: i.description, kind: "item" as const, unitPriceSen: i.unitPriceSen, status: i.status })),
      ...detail.parts.map((p) => ({ id: p.id, description: p.product?.name ?? t("ws.job.part", lang), kind: "part" as const, unitPriceSen: p.unitPriceSen, status: p.status })),
    ],
  };

  const checklistItems = detail.checklist?.items.map((i) => ({ id: i.id, name: i.name, result: i.result, note: i.note })) ?? [];
  const findings = detail.findings.map((f) => ({
    id: f.id, title: f.title, severity: f.severity, note: f.note, recommendedRepair: f.recommendedRepair, priceSen: f.priceSen,
    status: f.status, approvalStatus: f.approval?.status,
  }));

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/workshop/mechanic" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
        <ChevronLeft className="h-4 w-4" /> {t("nav.mechanic", lang)}
      </Link>
      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-2xl font-bold font-mono tracking-tight">#{detail.jobNumber}</h1>
        <StatusBadge kind="job" value={detail.status} />
        <div className="flex-1" />
        <EditJobForm data={editData} mechanics={mechanics} />
      </div>
      <div className="rounded-2xl border bg-card p-4 mb-5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">{detail.motorcycle.brand} {detail.motorcycle.model}</div>
          <div className="text-xs text-muted-foreground">{detail.motorcycle.plate} · {detail.customer.name}</div>
        </div>
        <div className="text-right text-sm">
          <div className="text-xs text-muted-foreground">{t("ws.jobs.col-mileage", lang)}</div>
          <div className="font-bold">{fmtKM(detail.mileage)}</div>
        </div>
      </div>

      <ChecklistRunner jobId={detail.id} jobNumber={detail.jobNumber} items={checklistItems} findings={findings} hasChecklist={!!detail.checklist} status={detail.status} />
    </div>
  );
}
