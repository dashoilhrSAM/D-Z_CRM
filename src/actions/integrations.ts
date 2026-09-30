"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { can } from "@/lib/auth/permissions";
import { audit } from "@/lib/auth/audit";

/**
 * 集成开关。
 *
 * 旧版只按裸 id update：没有会话检查、没有组织检查、审计里的 organisationId 还是**被改那行**的
 * （于是越权成功时审计记的是受害组织的名字，等于给攻击者留了个假脚印）。
 * IntegrationConfig 有 organisationId，先查归属再改，并且只审计本组织自己的配置。
 */
export async function toggleIntegration(id: string, enabled: boolean) {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return { ok: false, error: "Not signed in" };
  if (!(await can({ id: session.user.id, role: session.role as never, organisationId: session.orgId }, "INTEGRATIONS", "view"))) {
    return { ok: false, error: "No permission to manage integrations" };
  }
  const target = await db.integrationConfig.findFirst({ where: { id, organisationId: session.orgId }, select: { id: true } });
  if (!target) return { ok: false, error: "Not found" };
  const cfg = await db.integrationConfig.update({ where: { id }, data: { enabled } });
  await audit({ organisationId: cfg.organisationId, action: "INTEGRATION_" + (enabled ? "ENABLED" : "DISABLED"), entity: "INTEGRATION_CONFIG", entityId: id, after: { provider: cfg.provider, enabled } });
  revalidatePath("/", "layout");
  return { ok: true };
}
