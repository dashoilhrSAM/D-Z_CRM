"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { can } from "@/lib/auth/permissions";
import { scopedBranchId } from "@/lib/branch-scope";
import { audit } from "@/lib/auth/audit";

/**
 * 车辆转移。
 *
 * 旧版没有任何会话检查：车与目标顾客都按裸 id 读，`newCustomerId` 可以指向**任意组织**的顾客
 * —— 一次调用就能把别的租户的客户资料接管过来。现在：
 *  · 必须是本组织员工且有 MOTORCYCLES:edit；
 *  · 车辆与目标顾客都必须属于本组织（跨租户一律 "Not found"）；
 *  · 分行级用户的目标顾客必须与本车同分行（否则等于把本店的车挪到别的店）。
 */
export async function transferMotorcycle(bikeId: string, newCustomerId: string) {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return { ok: false, error: "Not signed in" };
  if (!(await can({ id: session.user.id, role: session.role as never, organisationId: session.orgId }, "MOTORCYCLES", "view"))) {
    return { ok: false, error: "No permission to transfer motorcycles" };
  }

  // 车辆归属经 customer.organisationId 判定（Motorcycle 没有 organisationId）
  const bike = await db.motorcycle.findFirst({
    where: { id: bikeId, customer: { organisationId: session.orgId } },
    include: { customer: true },
  });
  if (!bike) return { ok: false, error: "Motorcycle not found" };
  // 目标顾客同样限本组织
  const target = await db.customer.findFirst({ where: { id: newCustomerId, organisationId: session.orgId } });
  if (!target) return { ok: false, error: "Target customer not found" };

  // 分行隔离：分行级用户只能把车转给本分行的顾客
  const scope = scopedBranchId(session);
  if (scope && target.branchId !== scope) return { ok: false, error: "Target customer belongs to another branch." };

  await db.motorcycle.update({ where: { id: bikeId }, data: { customerId: newCustomerId } });
  await audit({
    organisationId: bike.customer.organisationId,
    branchId: null,
    action: "VEHICLE_TRANSFERRED",
    entity: "MOTORCYCLE",
    entityId: bikeId,
    before: { owner: bike.customer.name },
    after: { owner: target.name },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
