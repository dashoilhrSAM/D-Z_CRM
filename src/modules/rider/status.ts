// Rider service status — full booking+job lifecycle timeline per motorcycle.
import { db } from "@/lib/db";
import { promoDiscountForBill, readPromoSnapshot } from "@/modules/marketing/promo-resolve";

export type LifecycleStep =
  | "book_requested" | "book_confirmed" | "checked_in" | "in_service"
  | "qc_check" | "ready" | "completed";

export const LIFECYCLE_STEPS: LifecycleStep[] = [
  "book_requested", "book_confirmed", "checked_in", "in_service", "qc_check", "ready", "completed",
];

export interface BikeStatus {
  bike: { id: string; brand: string; model: string; plate: string; year: number; currentMileage: number };
  booking: { id: string; serviceType: string; date: Date; timeSlot: string; status: string; source: string } | null;
  job: { id: string; jobNumber: string; status: string; packageName: string | null; readyAt: Date | null; completedAt: Date | null; mileage: number; estimatedCompletionAt: Date | null } | null;
  /** 0-based index into LIFECYCLE_STEPS; null when cancelled/no-show/completed-outside */
  stepIndex: number | null;
  /** terminal flag: cancelled / no-show / completed */
  outcome: "active" | "completed" | "cancelled" | "no_show" | "none";
  /** sub-status badge, e.g. waiting parts / on hold / approval needed / quotation */
  sub: { kind: "waiting_parts" | "on_hold" | "approval" | "quotation" | "none"; text?: string } | null;
  /** pre-service quotation awaiting/confirmed (customer confirmation) */
  quotation: {
    id: string; status: string; revision: number; totalSen: number; itemsJson: string | null;
    /**
     * The promotion promised on these lines, so the price the customer approves is the price they
     * pay. The amount comes from the same rule the invoice charges with, never a second one.
     */
    promo: { name: string; discountSen: number } | null;
  } | null;
}

/** Resolve lifecycle step from booking + job statuses. */
export function resolveStep(bookingStatus: string | null, jobStatus: string | null): { stepIndex: number | null; outcome: BikeStatus["outcome"] } {
  if (bookingStatus === "CANCELLED") return { stepIndex: null, outcome: "cancelled" };
  if (bookingStatus === "NO_SHOW") return { stepIndex: null, outcome: "no_show" };
  if (jobStatus === "COMPLETED" || bookingStatus === "COMPLETED") return { stepIndex: 6, outcome: "completed" };
  if (jobStatus === "CANCELLED") return { stepIndex: null, outcome: "cancelled" };
  switch (jobStatus ?? null) {
    case "WAITING": return { stepIndex: 2, outcome: "active" }; // checked in
    case "IN_PROGRESS":
    case "AWAITING_APPROVAL": return { stepIndex: 3, outcome: "active" };
    case "QC_CHECK": return { stepIndex: 4, outcome: "active" };
    case "WAITING_PARTS":
    case "ON_HOLD": return { stepIndex: 3, outcome: "active" }; // still in service, sub-badge
    case "READY": return { stepIndex: 5, outcome: "active" };
    case null: break;
  }
  // no job yet — derive from booking
  switch (bookingStatus ?? null) {
    case "REQUESTED": return { stepIndex: 0, outcome: "active" };
    case "CONFIRMED":
    case "RESCHEDULED": return { stepIndex: 1, outcome: "active" };
    case "CHECKED_IN": return { stepIndex: 2, outcome: "active" };
    default: return { stepIndex: null, outcome: "none" };
  }
}

/** Sub-status for badges (waiting parts / on hold / approval needed). */
export function subStatusOf(jobStatus: string | null, pendingApprovals: number): BikeStatus["sub"] {
  if (jobStatus === "WAITING_PARTS") return { kind: "waiting_parts" };
  if (jobStatus === "ON_HOLD") return { kind: "on_hold" };
  if (pendingApprovals > 0) return { kind: "approval", text: String(pendingApprovals) };
  return { kind: "none" };
}

/** Full per-motorcycle status feed for the rider. */
export async function getRiderStatus(customerId: string): Promise<BikeStatus[]> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: {
      motorcycles: { orderBy: { currentMileage: "desc" } },
      bookings: { include: { job: true }, orderBy: { date: "desc" } },
    },
  });
  if (!customer) return [];

  const ACTIVE_JOB = ["WAITING", "IN_PROGRESS", "AWAITING_APPROVAL", "QC_CHECK", "WAITING_PARTS", "ON_HOLD", "READY"] as const;
  type BookingT = (typeof customer.bookings)[number];
  type JobT = Awaited<ReturnType<typeof db.serviceJob.findMany>>[number];

  const out: BikeStatus[] = [];
  for (const bike of customer.motorcycles) {
    const openBookings = customer.bookings.filter(
      (b) => b.motorcycleId === bike.id && b.status !== "COMPLETED" && b.status !== "CANCELLED" && b.status !== "NO_SHOW",
    );
    const activeBooking = [...openBookings].sort((a, b) => b.date.getTime() - a.date.getTime())[0] ?? null;
    // Each job is paired with ITS OWN booking. Picking only the newest open booking attached the
    // booking — and with it the promo promise and the lifecycle step — to the wrong job as soon as
    // a rider had two jobs on the same bike, leaving every other job's row without its context.
    const bookingByJobId = new Map(
      openBookings.filter((b) => b.jobId).map((b) => [b.jobId as string, b] as const),
    );
    // 该 bike 的全部 active job（service + repair …）。每个 job 单独一行，携带各自的 status/quotation，
    // 避免「有 booking 关联的 service job」把「无 booking 的维修单」挤掉 —— rider 看不到 repair status。
    const activeJobs = await db.serviceJob.findMany({
      where: { motorcycleId: bike.id, status: { in: [...ACTIVE_JOB] } },
      orderBy: { createdAt: "desc" },
    });

    const makeRow = async (job: JobT | null, booking: BookingT | null): Promise<BikeStatus> => {
      const quotation = job ? await db.quotation.findUnique({ where: { jobId: job.id } }) : null;
      const pendingApprovals = job ? await db.customerApproval.count({ where: { jobId: job.id, status: "PENDING" } }) : 0;
      // The quotation is the customer's second look at money (the first is the booking summary);
      // the promise itself lives on the booking, so show it here rather than letting the rider
      // approve a full price and only discover the discount on the invoice.
      const snapshot = readPromoSnapshot(booking?.promoSnapshot);
      const promisedSen = quotation ? promoDiscountForBill(snapshot, quotation.totalSen) : 0;
      const promo = snapshot && promisedSen > 0 ? { name: snapshot.campaignName, discountSen: promisedSen } : null;
      const { stepIndex, outcome } = resolveStep(booking?.status ?? null, job?.status ?? null);
      // quotation awaiting → show the quotation badge/card (pre-service step)
      const sub = quotation?.status === "PENDING" ? { kind: "quotation" as const } : subStatusOf(job?.status ?? null, pendingApprovals);
      return {
        bike: { id: bike.id, brand: bike.brand, model: bike.model, plate: bike.plate, year: bike.year, currentMileage: bike.currentMileage },
        booking: booking ? { id: booking.id, serviceType: booking.serviceType, date: booking.date, timeSlot: booking.timeSlot, status: booking.status, source: booking.source } : null,
        job: job ? { id: job.id, jobNumber: job.jobNumber, status: job.status, packageName: job.packageName, readyAt: job.readyAt, completedAt: job.completedAt, mileage: job.mileage, estimatedCompletionAt: job.estimatedCompletionAt } : null,
        stepIndex,
        outcome,
        sub,
        quotation: quotation ? { id: quotation.id, status: quotation.status, revision: quotation.revision, totalSen: quotation.totalSen, itemsJson: quotation.itemsJson, promo } : null,
      };
    };

    if (activeJobs.length > 0) {
      // 每个 active job 一行；把与它关联的 booking 附给它（无 booking 的维修单 booking=null）
      for (const job of activeJobs) {
        out.push(await makeRow(job, bookingByJobId.get(job.id) ?? null));
      }
    } else if (activeBooking) {
      // booking active 但尚无 job（如 repair check-in 后待 createJob）
      out.push(await makeRow(null, activeBooking));
    } else {
      // 无 active job/booking → 用最近一条 booking 归纳 terminal 结果（completed/cancelled/no_show/none）
      const term = customer.bookings.filter((b) => b.motorcycleId === bike.id).sort((a, b) => b.date.getTime() - a.date.getTime())[0] ?? null;
      out.push(await makeRow(null, term));
    }
  }
  return out;
}
