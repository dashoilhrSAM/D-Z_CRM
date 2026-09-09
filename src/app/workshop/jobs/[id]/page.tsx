import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, BadgeCheck, CheckCircle2, XCircle, Clock } from "lucide-react";
import { jobService } from "@/modules/service-jobs/service";
import { aiService } from "@/modules/ai/service";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Money } from "@/components/shared/money";
import { JobActions } from "@/components/workshop/job-actions";
import { RecommendationActions } from "@/components/workshop/recommendation-actions";
import { AiRecommendationActions } from "@/components/workshop/ai-recommendation-actions";
import { EditJobForm, type EditJobData } from "@/components/workshop/edit-job-form";
import { MileageCorrector } from "@/components/workshop/mileage-corrector";
import { JobPhotosView } from "@/components/workshop/job-photos-view";
import { QuotationPanel } from "@/components/workshop/quotation-panel";
import { InvoicePaymentPanel } from "@/components/workshop/invoice-payment-panel";
import { fmtDate, fmtDateTime, fmtKM } from "@/lib/format";
import { formatRM } from "@/lib/money";
import { db } from "@/lib/db";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session-user";
import { scopedStaffWhere } from "@/lib/branch-scope";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang = await getLang();
  const session = await getSessionUser();
  const detail = await jobService.getDetail(id);
  if (!detail) notFound();
  const recs = await aiService.salesRecommendations(id);
  const checklist = detail.checklist;
  const pendingApprovals = detail.approvals.filter((a) => a.status === "PENDING");
  const rawMechanics = await db.user.findMany({ where: scopedStaffWhere(session, ["MECHANIC", "MANAGER"]), select: { id: true, name: true, branch: { select: { name: true } } }, orderBy: { name: "asc" } });
  const mechanics = rawMechanics.map((m) => ({ id: m.id, name: m.name, branchName: m.branch?.name ?? null }));
  const statusHistory = await db.jobStatusHistory.findMany({ where: { jobId: id }, orderBy: { changedAt: "desc" } });
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

  return (
    <div>
      <PageHeader
        title={<span className="font-mono">{detail.jobNumber}</span>}
        subtitle={t("ws.job.created", lang) + " " + fmtDateTime(detail.createdAt)}
        backHref="/workshop/jobs"
      />
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <StatusBadge kind="job" value={detail.status} />
        {detail.type === "REPAIR" && <span className="rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-bold text-rose-600 dark:text-rose-300">{t("job-type.repair", lang)}</span>}
        {pendingApprovals.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900">
            <AlertTriangle className="h-3.5 w-3.5" /> {pendingApprovals.length} {t(pendingApprovals.length > 1 ? "ws.job.pending-approvals" : "ws.job.pending-approval", lang)}
          </span>
        )}
        <div className="flex-1" />
        <EditJobForm data={editData} mechanics={mechanics} />
        <JobActions jobId={detail.id} status={detail.status} sopComplete={(detail.photos ?? []).length >= 5} />
      </div>

      {/* JOB-016 / rider lifecycle: customer-facing progress + ETA (linked to rider service-status) */}
      <div className="dz-panel p-4 mb-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">{t("ws.job.rider-lifecycle", lang)}</h3>
          <Link href={"/rider/service-status"} className="text-[11px] text-primary hover:underline">{t("ws.job.customer-view", lang)}</Link>
        </div>
        {(() => {
          const order = ["WAITING", "IN_PROGRESS", "AWAITING_APPROVAL", "QC_CHECK", "WAITING_PARTS", "ON_HOLD", "READY", "COMPLETED"];
          const idx = order.indexOf(detail.status);
          const pct = detail.status === "COMPLETED" ? 100 : detail.status === "READY" ? 85 : idx >= 0 ? Math.round(((idx + 1) / 7) * 100) : 0;
          const eta = detail.estimatedCompletionAt;
          return (
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">{t("ws.job.booking-to-ready", lang)}</span>
                <span className="font-bold tabular-nums text-primary">{pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary" style={{ width: pct + "%" }} />
              </div>
              {eta && detail.status !== "COMPLETED" && (
                <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> {t("ws.job.estimated-ready", lang)} <strong>{fmtDateTime(eta)}</strong></p>
              )}
            </div>
          );
        })()}
      </div>

      {statusHistory.length > 0 && (
        <div className="dz-panel p-4 mb-5">
          <h3 className="font-semibold text-sm mb-2">{t("ws.job.status-history", lang)}</h3>
          <ol className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            {statusHistory.map((h, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary/50" />
                <span className="font-mono">{h.fromStatus ?? "—"} → <strong>{h.toStatus}</strong></span>
                <span>{fmtDateTime(h.changedAt)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* customer & bike */}
          <section className="dz-panel p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Link href={"/workshop/customers/" + detail.customerId} className="font-semibold hover:text-primary">{detail.customer.name}</Link>
                <div className="text-xs text-muted-foreground">{detail.customer.phone ?? "—"}</div>
              </div>
              <div className="text-right">
                <div className="font-semibold">{detail.motorcycle.brand} {detail.motorcycle.model}</div>
                <div className="text-xs text-muted-foreground">
                  {detail.motorcycle.plate} · {detail.motorcycle.year} · <strong>{fmtKM(detail.mileage)}</strong>
                  <MileageCorrector jobId={detail.id} currentMileage={detail.mileage} bikeMileage={detail.motorcycle.currentMileage} />
                </div>
              </div>
            </div>
            <div className="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-muted/40 p-3">
                <div className="text-xs text-muted-foreground">{t("ws.jobs.col-service", lang)}</div>
                <div className="font-medium mt-0.5">{detail.packageName ?? "—"}</div>
              </div>
              <div className="rounded-xl bg-muted/40 p-3">
                <div className="text-xs text-muted-foreground">{t("ws.jobs.col-mechanic", lang)}</div>
                <div className="font-medium mt-0.5">{detail.mechanic?.name ?? t("ws.job.unassigned", lang)}</div>
              </div>
              {detail.customerRequest && (
                <div className="rounded-xl bg-muted/40 p-3 sm:col-span-2">
                  <div className="text-xs text-muted-foreground">{t("ws.job.customer-request", lang)}</div>
                  <div className="font-medium mt-0.5">“{detail.customerRequest}”</div>
                </div>
              )}
            </div>
          </section>

          {/* SOP pre-service photos (counter view) */}
          <section className="dz-panel p-5">
            <h3 className="font-semibold mb-1">{t("ws.job.sop-title", lang)}</h3>
            <p className="text-xs text-muted-foreground mb-3">{t("ws.job.sop-sub", lang)}</p>
            {(detail.photos ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("ws.job.sop-empty", lang)}</p>
            ) : (
              <JobPhotosView photos={(detail.photos ?? []).map((p) => ({ angle: p.angle, photoUrl: p.photoUrl }))} />
            )}
          </section>

          {/* items & parts */}
          <section className="dz-panel">
            <div className="px-5 pt-4 pb-2 font-semibold">{t("ws.job.lines-title", lang)}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2 font-medium">{t("ws.job.col-description", lang)}</th><th className="px-3 py-2 font-medium">{t("common.qty", lang)}</th>
                  <th className="px-3 py-2 font-medium">{t("common.price", lang)}</th><th className="px-3 py-2 font-medium">{t("common.status", lang)}</th><th className="px-3 py-2" />
                </tr></thead>
                <tbody>
                  {detail.items.map((i) => (
                    <tr key={i.id} className="border-b last:border-0">
                      <td className="px-5 py-2.5">{i.description}</td>
                      <td className="px-3 py-2.5 tabular-nums">{i.quantity}</td>
                      <td className="px-3 py-2.5 tabular-nums">{formatRM(i.unitPriceSen)}</td>
                      <td className="px-3 py-2.5"><span className={"text-[11px] font-semibold uppercase " + (i.status === "INCLUDED" ? "text-slate-500 dark:text-slate-400" : i.status === "ACCEPTED" ? "text-emerald-600 dark:text-emerald-400" : i.status === "DECLINED" ? "text-red-500 line-through dark:text-red-400" : "text-amber-600 dark:text-amber-400")}>{i.status}</span></td>
                      <td className="px-3 py-2.5"><RecommendationActions jobId={detail.id} kind="item" id={i.id} status={i.status} /></td>
                    </tr>
                  ))}
                  {detail.parts.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="px-5 py-2.5">{p.product.name}<div className="text-xs text-muted-foreground">{t("ws.job.part", lang)} · SKU {p.product.sku}</div></td>
                      <td className="px-3 py-2.5 tabular-nums">{p.quantity}</td>
                      <td className="px-3 py-2.5 tabular-nums">{formatRM(p.unitPriceSen)}</td>
                      <td className="px-3 py-2.5"><span className={"text-[11px] font-semibold uppercase " + (p.status === "INCLUDED" ? "text-slate-500 dark:text-slate-400" : p.status === "ACCEPTED" ? "text-emerald-600 dark:text-emerald-400" : p.status === "DECLINED" ? "text-red-500 line-through dark:text-red-400" : "text-amber-600 dark:text-amber-400")}>{p.status}</span></td>
                      <td className="px-3 py-2.5"><RecommendationActions jobId={detail.id} kind="part" id={p.id} status={p.status} /></td>
                    </tr>
                  ))}
                  {detail.items.length === 0 && detail.parts.length === 0 && (
                    <tr><td className="px-5 py-4 text-sm text-muted-foreground">{t("ws.job.no-lines", lang)}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between border-t px-5 py-3 text-sm">
              <span className="text-muted-foreground">{t("ws.job.estimated-total", lang)}</span>
              <span className="font-bold tabular-nums">{formatRM(detail.summary.totalSen)}</span>
            </div>
          </section>

          {/* AI recommendations */}
          {recs.length > 0 && (
            <section className="dz-panel p-5">
              <h3 className="font-semibold mb-3">{t("ws.job.ai-recs", lang)}</h3>
              <div className="space-y-3">
                {recs.map((r) => (
                  <div key={r.description} className="rounded-xl border p-3.5">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-sm font-semibold">{r.description}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{r.reason}</div>
                      </div>
                      <div className="text-sm font-bold tabular-nums">{formatRM(r.priceSen)}</div>
                    </div>
                    <p className="mt-2 rounded-lg bg-primary/5 p-2.5 text-xs italic text-muted-foreground">“{r.script}”</p>
                    <div className="mt-2"><AiRecommendationActions jobId={detail.id} rec={r} /></div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* checklist */}
          {checklist && (
            <section className="dz-panel">
              <div className="px-5 pt-4 pb-2 font-semibold flex items-center justify-between">
                <span>{t("ws.checklist.title", lang)}</span>
                {checklist.completedAt ? <span className="text-xs text-emerald-600 font-medium flex items-center gap-1"><BadgeCheck className="h-3.5 w-3.5" /> {t("common.completed", lang)} {fmtDate(checklist.completedAt)}</span> : <span className="text-xs text-muted-foreground">{t("ws.checklist.in-progress", lang)}</span>}
              </div>
              <div className="px-5 pb-4 grid sm:grid-cols-2 gap-2">
                {checklist.items.map((i) => (
                  <div key={i.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                    <span>{i.name}</span>
                    <span className={"text-[11px] font-bold uppercase " + (i.result === "PASS" ? "text-emerald-600 dark:text-emerald-400" : i.result === "WARNING" ? "text-amber-600 dark:text-amber-400" : i.result === "FAIL" ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{i.result}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-5">
          {/* quotation (customer confirmation before start) */}
          <QuotationPanel
            jobId={detail.id}
            quotation={detail.quotation ? { status: detail.quotation.status, revision: detail.quotation.revision, totalSen: detail.quotation.totalSen } : null}
          />

          {/* invoice + payment (completed job; customer pays here) */}
          {detail.invoice && (
            <InvoicePaymentPanel
              invoice={{
                id: detail.invoice.id,
                invoiceNumber: detail.invoice.invoiceNumber,
                status: detail.invoice.status,
                totalSen: detail.invoice.totalSen,
                paidSen: (detail.invoice.payments ?? []).filter((p) => p.status === "PAID" && p.method !== "PAY_LATER").reduce((s, p) => s + p.amountSen, 0),
              }}
            />
          )}

          {/* approvals */}
          <section className="dz-panel p-5">
            <h3 className="font-semibold mb-3">{t("ws.job.customer-approvals", lang)}</h3>
            {detail.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("ws.job.no-findings", lang)}</p>
            ) : (
              <div className="space-y-3">
                {detail.findings.map((f) => (
                  <div key={f.id} className="rounded-xl border p-3.5">
                    <div className="flex items-center justify-between">
                      <span className={"text-[11px] font-bold uppercase " + (f.severity === "WARNING" ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400")}>{f.severity}</span>
                      {f.approval && (
                        <span className={"inline-flex items-center gap-1 text-[11px] font-semibold " + (f.approval.status === "PENDING" ? "text-amber-600 dark:text-amber-300" : f.approval.status === "APPROVED" ? "text-emerald-600 dark:text-emerald-300" : "text-red-500")}>
                          {f.approval.status === "PENDING" ? t("ws.job.waiting-customer", lang) : f.approval.status === "APPROVED" ? <><CheckCircle2 className="h-3.5 w-3.5" /> {t("ws.job.customer-approved", lang)}</> : <><XCircle className="h-3.5 w-3.5" /> {t("ws.job.customer-declined", lang)}</>}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 font-semibold text-sm">{f.title}</div>
                    {f.note && <p className="text-xs text-muted-foreground mt-0.5">{f.note}</p>}
                    {f.recommendedRepair && (
                      <div className="mt-2 rounded-lg bg-primary/5 p-2 text-xs">
                        <span className="font-semibold">{f.recommendedRepair}</span> · <span className="font-bold tabular-nums">{formatRM(f.priceSen ?? 0)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* invoice */}
          {detail.invoice && (
            <section className="dz-panel p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">{t("ws.job.invoice", lang)}</h3>
                <span className={"rounded-full px-2.5 py-0.5 text-[11px] font-bold " + (detail.invoice.status === "PAID" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300")}>{detail.invoice.status}</span>
              </div>
              <div className="font-mono text-sm">{detail.invoice.invoiceNumber}</div>
              <div className="mt-3 space-y-1.5 text-sm">
                {detail.invoice.items.map((it) => (
                  <div key={it.id} className="flex justify-between text-xs"><span>{it.description} ×{it.quantity}</span><span className="tabular-nums">{formatRM(it.lineTotalSen)}</span></div>
                ))}
                <div className="border-t pt-2 mt-2 flex justify-between font-bold"><span>{t("common.total", lang)}</span><span className="tabular-nums">{formatRM(detail.invoice.totalSen)}</span></div>
                {detail.invoice.paidAt && <div className="text-xs text-muted-foreground pt-1">{t("ws.job.paid", lang)} {fmtDate(detail.invoice.paidAt)}</div>}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
