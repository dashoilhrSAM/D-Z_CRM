"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser, type SessionUser } from "@/lib/session-user";
import { can } from "@/lib/auth/permissions";

/**
 * 消息模板 / 自动化规则的门禁。
 *
 * 旧版四个函数都没有会话检查：createTemplate / createAutomationRule 用
 * `db.organisation.findFirst()` 取组织（写进"第一个组织"），updateTemplate /
 * toggleAutomation 则按裸 id 更新，可以改别的租户的模板与自动化规则。
 * 两个模型都有 organisationId，直接用会话组织过滤。
 */
async function requireMessagingEditor(): Promise<SessionUser | null> {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return null;
  const allowed = await can({ id: session.user.id, role: session.role as never, organisationId: session.orgId }, "MESSAGING", "view");
  return allowed ? session : null;
}

export async function createTemplate(input: { name: string; channel: string; body: string }) {
  const session = await requireMessagingEditor();
  if (!session) return { ok: false, error: "Not signed in or no permission" };
  await db.messageTemplate.create({ data: { organisationId: session.orgId, name: input.name, channel: input.channel, body: input.body } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateTemplate(id: string, data: { name?: string; channel?: string; body?: string; active?: boolean }) {
  const session = await requireMessagingEditor();
  if (!session) return { ok: false, error: "Not signed in or no permission" };
  // MessageTemplate 有 organisationId：updateMany 是唯一能带 org 过滤的写入口
  //（update 的 where 只接受唯一键）。count=0 即"不存在或不属于本组织"。
  const res = await db.messageTemplate.updateMany({ where: { id, organisationId: session.orgId }, data });
  if (res.count === 0) return { ok: false, error: "Not found" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function createAutomationRule(input: { name: string; trigger: string; actionsJson: string }) {
  const session = await requireMessagingEditor();
  if (!session) return { ok: false, error: "Not signed in or no permission" };
  await db.automationRule.create({ data: { organisationId: session.orgId, name: input.name, triggerType: "EVENT", trigger: input.trigger, actions: input.actionsJson } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function toggleAutomation(id: string, active: boolean) {
  const session = await requireMessagingEditor();
  if (!session) return { ok: false, error: "Not signed in or no permission" };
  const res = await db.automationRule.updateMany({ where: { id, organisationId: session.orgId }, data: { active } });
  if (res.count === 0) return { ok: false, error: "Not found" };
  revalidatePath("/", "layout");
  return { ok: true };
}
