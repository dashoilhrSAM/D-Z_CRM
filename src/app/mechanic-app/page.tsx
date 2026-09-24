import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { MechanicOrdersView } from "@/components/mechanic/mechanic-orders-view";
import type { OrderCard } from "@/components/mechanic/job-card";

export const dynamic = "force-dynamic";

const include = {
  customer: { select: { name: true } },
  motorcycle: { select: { brand: true, model: true, plate: true } },
  booking: { select: { date: true, timeSlot: true, branch: { select: { city: true } } } },
  items: { where: { status: { not: "DECLINED" } }, select: { lineTotalSen: true } },
  parts: { where: { status: { not: "DECLINED" } }, select: { lineTotalSen: true } },
  // 接单按钮要说清楚「还差什么才开工」，所以卡片需要知道照片张数与报价状态
  photos: { select: { id: true } },
  quotation: { select: { status: true } },
} satisfies Prisma.ServiceJobInclude;

type JobRow = Prisma.ServiceJobGetPayload<{ include: typeof include }>;

function toOrder(j: JobRow): OrderCard {
  return {
    id: j.id, jobNumber: j.jobNumber, status: j.status, customer: j.customer.name,
    brand: j.motorcycle.brand, model: j.motorcycle.model, plate: j.motorcycle.plate,
    city: j.booking?.branch.city ?? "",
    bookingDate: j.booking ? new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short" }).format(j.booking.date) : null,
    bookingTime: j.booking?.timeSlot ?? null,
    amountSen: j.items.reduce((s, i) => s + i.lineTotalSen, 0) + j.parts.reduce((s, p) => s + p.lineTotalSen, 0),
    packageName: j.packageName,
    photoCount: j.photos.length,
    // 没有报价历史的工单不受报价门禁限制（与 service 里的 QUOT-001 判定一致）
    quotationApproved: j.quotation ? j.quotation.status === "APPROVED" : null,
  };
}

/** Mechanic App 首页：Grab 风格订单列表（进行中 / 已完成 筛选 + 自动/手动刷新）。 */
export default async function MechanicAppHome() {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) redirect("/workshop/dashboard");

  const [currentJobs, completedJobs] = await Promise.all([
    db.serviceJob.findMany({
      where: { mechanicId: session.user.id, status: { notIn: ["COMPLETED", "CANCELLED"] } },
      include,
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    }),
    db.serviceJob.findMany({
      where: { mechanicId: session.user.id, status: "COMPLETED" },
      include,
      orderBy: { completedAt: "desc" },
      take: 50,
    }),
  ]);

  const current = currentJobs.map(toOrder);
  const completed = completedJobs.map(toOrder);

  return <MechanicOrdersView current={current} completed={completed} name={session.user.name} />;
}
