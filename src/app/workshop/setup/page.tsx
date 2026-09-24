import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { BulkSetup } from "@/components/workshop/bulk-setup";
import { getSessionUser } from "@/lib/session-user";
import { can } from "@/lib/auth/permissions";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";
import { resumeSetupImport, setupBranches } from "@/actions/bulk";
import { SHEETS } from "@/modules/bulk/sheets";

export const dynamic = "force-dynamic";

/** 批量配置（P2）：一张 Excel 配完全店的零件。 */
export default async function SetupPage() {
  const lang = await getLang();
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) redirect("/login");
  const allowed = await can(
    { id: session.user.id, role: session.role as never, organisationId: session.orgId },
    "PARTS",
    "edit",
  );
  if (!allowed) redirect("/workshop/dashboard");
  const canDelete = ["OWNER", "SUPER_ADMIN"].includes(session.role as string);
  // **在服务端读出「上次没审完的那一份」** —— 客户端就不必用 effect 去拉，
  // 也不会先闪一下空页面再填上内容。
  const resume = await resumeSetupImport();
  const draft = resume.ok ? resume.session : null;

  return (
    <div className="space-y-4">
      <PageHeader title={t("bulk.title", lang)} subtitle={t("bulk.subtitle", lang)} backHref="/workshop/inventory/products" />
      <BulkSetup
        canDelete={canDelete}
        branches={await setupBranches()}
        sheets={SHEETS.map((s) => ({ key: s.key, title: s.title }))}
        initialSession={
          draft
            ? {
                id: draft.id,
                fileName: draft.fileName,
                uploadedAt: draft.uploadedAt,
                status: draft.status,
                plans: draft.plans,
                decisions: draft.decisions,
                declaredSheets: draft.declaredSheets,
              }
            : null
        }
        initialColumns={resume.ok ? resume.columns : {}}
        initialCounts={resume.ok ? resume.existingCounts : {}}
      />
    </div>
  );
}
