"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/auth/audit";
import { getSessionUser } from "@/lib/session-user";
import { claimTierFor, tierPanelFor } from "@/modules/commission/claim";

// 阶梯奖励的领取入口（P3）。薄薄一层：
//   鉴权 → 调模块层 → 写审计 → 刷新页面。
// **userId 一律取自会话**，不接受客户端传入 —— 于是"替别人领取"在这个签名下表达不出来。

/** 我自己的阶梯面板（组合 / 进度 / 可领取 / 历史）。 */
export async function myTierPanel() {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return { ok: false as const, error: "Not signed in" };
  const panel = await tierPanelFor(session.orgId, session.user.id);
  return { ok: true as const, panel };
}

/** 领取一档阶梯奖励（技师自己点）。 */
export async function claimTier(input: { tierSetId: string; tierId: string }) {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return { ok: false as const, error: "Not signed in" };

  const result = await claimTierFor(session.orgId, session.user.id, { tierSetId: input.tierSetId, tierId: input.tierId });
  if (!result.ok) return { ok: false as const, error: result.error ?? "Could not claim" };

  await audit({
    organisationId: session.orgId,
    branchId: session.branchId,
    userId: session.user.id,
    action: "COMMISSION_TIER_CLAIM",
    entity: "CommissionClaim",
    entityId: input.tierId,
    after: { tierSetId: input.tierSetId, tierId: input.tierId, amountSen: result.amountSen },
  });
  revalidatePath("/workshop/commission");
  revalidatePath("/mechanic-app");
  return { ok: true as const, amountSen: result.amountSen, tierSetName: result.tierSetName };
}
