import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { getSessionUser } from "@/lib/session-user";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { documentAttentionList } from "@/modules/documents/service";
import { expiryDecision } from "@/lib/documents/validate";

export const dynamic = "force-dynamic";

/**
 * 全局文档页（P1）。
 *
 * **默认视图是「要人动手的东西」**（待审核 + 即将到期），不是一张报表 ——
 * 依据是这一期反复出现的那条：一张什么都不做的清单，没人会看第二眼。
 * 筛选走 searchParams（服务端渲染，不需要客户端 JS）。
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; kind?: string }>;
}) {
  const lang = await getLang();
  const session = await getSessionUser();
  const sp = await searchParams;
  const now = new Date();

  const docs = await documentAttentionList({
    organisationId: session.orgId,
    includeExpired: sp.status === "expired",
    now,
  });
  const filtered = sp.kind ? docs.filter((d) => d.kind === sp.kind) : docs;

  // 关联对象的上下文（客户名 / 工单号）—— 一次查两张表，别在循环里查
  const customerIds = [...new Set(filtered.map((d) => d.customerId).filter((v): v is string => !!v))];
  const jobIds = [...new Set(filtered.map((d) => d.jobId).filter((v): v is string => !!v))];
  const [customers, jobs] = await Promise.all([
    customerIds.length ? db.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } }) : [],
    jobIds.length ? db.serviceJob.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobNumber: true } }) : [],
  ]);
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const jobNumber = new Map(jobs.map((j) => [j.id, j.jobNumber]));

  const kinds = [...new Set(docs.map((d) => d.kind))].sort();
  const chip = (label: string, href: string, active: boolean) => (
    <Link
      key={href}
      href={href}
      className={
        "rounded-full border px-3 py-1 text-xs " +
        (active ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground hover:bg-muted")
      }
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t("doc.page-title", lang)} subtitle={t("doc.page-subtitle", lang)} backHref="/workshop/dashboard" />

      <div className="flex flex-wrap items-center gap-2">
        {chip(t("doc.filter-attention", lang) + " (" + docs.length + ")", "/workshop/documents", !sp.status || sp.status === "attention")}
        {chip(t("doc.filter-expired", lang), "/workshop/documents?status=expired", sp.status === "expired")}
        {kinds.map((k) =>
          chip(
            t("doc.kind-" + k, lang),
            "/workshop/documents?kind=" + k + (sp.status ? "&status=" + sp.status : ""),
            sp.kind === k,
          ),
        )}
      </div>

      <div className="rounded-2xl border bg-card divide-y">
        {filtered.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("doc.page-empty", lang)}</p>}
        {filtered.map((d) => {
          const decision = expiryDecision(d, now);
          const linked = d.customerId
            ? customerName.get(d.customerId) ?? t("doc.linked-customer", lang)
            : d.jobId
              ? jobNumber.get(d.jobId) ?? t("doc.linked-job", lang)
              : t("doc.linked-none", lang);
          return (
            <div key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
              <span className="flex-1 min-w-[160px] truncate">{d.fileName}</span>
              <span className="text-[11px] text-muted-foreground">{t("doc.kind-" + d.kind, lang)}</span>
              <span className="min-w-[120px] text-xs text-muted-foreground">{linked}</span>
              <span
                className={
                  "rounded px-1.5 py-0.5 text-[11px] font-medium " +
                  (d.status === "VERIFIED"
                    ? "bg-emerald-500/10 text-emerald-700"
                    : d.status === "EXPIRED" || decision === "EXPIRE"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-amber-500/10 text-amber-700")
                }
              >
                {d.status === "EXPIRED" || decision === "EXPIRE" ? t("doc.status-EXPIRED", lang) : t("doc.status-" + d.status, lang)}
              </span>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {d.retainUntil ? t("doc.expires-on", lang) + " " + fmtDate(d.retainUntil) : "—"}
              </span>
              <span className="text-[11px] text-muted-foreground">{fmtDate(d.uploadedAt)}</span>
              <a className="text-xs text-primary hover:underline" href={"/api/documents/" + d.id + "/file"} target="_blank" rel="noreferrer">
                {t("doc.open", lang)}
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
