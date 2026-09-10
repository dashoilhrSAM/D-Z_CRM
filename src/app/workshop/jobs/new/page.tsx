import { PageHeader } from "@/components/shared/page-header";
import { CreateJobForm } from "@/components/workshop/create-job-form";
import { RepairJobForm } from "@/components/workshop/repair-job-form";
import { db } from "@/lib/db";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session-user";
import { resolveNewJobBranchId, loadAssignableStaff } from "@/lib/job-branch";

export const dynamic = "force-dynamic";

export default async function NewJobPage({ searchParams }: { searchParams: Promise<{ customer?: string; motorcycle?: string; type?: string; bookingId?: string }> }) {
  const { customer, motorcycle, type, bookingId } = await searchParams;
  const lang = await getLang();
  const session = await getSessionUser();
  const isRepair = type === "repair";
  // The mechanic list is scoped to the branch this job will actually be created in, not to
  // every branch the user can see. Those differ for an org-level user, and the wider list
  // offered names that createJob then refused. Same function, so they cannot drift again.
  const branchId = await resolveNewJobBranchId(session);
  const [customers, motorcycles, packages, mechanics] = await Promise.all([
    db.customer.findMany({ select: { id: true, name: true, phone: true }, orderBy: { name: "asc" } }),
    db.motorcycle.findMany({ select: { id: true, customerId: true, brand: true, model: true, plate: true, year: true, type: true, currentMileage: true } }),
    db.servicePackage.findMany({ where: { active: true }, select: { id: true, name: true, tier: true, priceSen: true, isBestValue: true, description: true }, orderBy: { priceSen: "asc" } }),
    loadAssignableStaff(branchId),
  ]);
  const motorcyclesByCustomer = motorcycles.reduce<Record<string, typeof motorcycles>>((acc, m) => {
    (acc[m.customerId] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        title={isRepair ? t("ws.job.repair", lang) : t("ws.job.service", lang)}
        subtitle={isRepair ? t("ws.job.repair-flow", lang) : t("ws.job.service-flow", lang)}
        backHref="/workshop/jobs"
      />
      {isRepair ? (
        <RepairJobForm customers={customers} motorcyclesByCustomer={motorcyclesByCustomer} mechanics={mechanics} preselectCustomer={customer ?? null} preselectMotorcycle={motorcycle ?? null} bookingId={bookingId ?? null} />
      ) : (
        <CreateJobForm customers={customers} motorcyclesByCustomer={motorcyclesByCustomer} packages={packages} mechanics={mechanics} preselectCustomer={customer ?? null} preselectMotorcycle={motorcycle ?? null} />
      )}
    </div>
  );
}
