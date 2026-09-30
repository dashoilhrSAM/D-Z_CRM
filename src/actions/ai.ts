"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { can } from "@/lib/auth/permissions";
import { generateDraft, type DraftKind } from "@/modules/ai/draft";
import { crmService } from "@/modules/crm/service";

/**
 * AI 助手（写消息草稿 / 发消息 / 搜客户）的门禁。
 *
 * 旧版这三个函数**没有任何会话检查**，且 searchCustomersForDraft 的查询里没有 organisationId
 * —— 于是它是一台跨租户的"姓名+电话"搜索器；draftMessage/sendDraft 也能拿任意 customerId
 * 去读资料、发消息。这里统一：必须是本组织员工，且目标客户必须属于本组织。
 */
async function requireAiUser() {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return null;
  if (!(await can({ id: session.user.id, role: session.role as never, organisationId: session.orgId }, "AI", "view"))) return null;
  return session;
}

/** 客户归属校验：跨租户的 id 一律当作"不存在"。 */
async function customerInOrg(customerId: string, organisationId: string) {
  const customer = await db.customer.findFirst({ where: { id: customerId, organisationId }, select: { id: true } });
  return customer ? customer.id : null;
}

export async function draftMessage(input: { customerId: string; kind: DraftKind; tone?: string }) {
  const session = await requireAiUser();
  if (!session) return { ok: false as const, error: "Not signed in or no permission" };
  const customerId = await customerInOrg(input.customerId, session.orgId);
  if (!customerId) return { ok: false as const, error: "Customer not found" };
  const draft = await generateDraft({ ...input, customerId });
  return { ok: true as const, ...draft };
}

export async function sendDraft(input: { customerId: string; body: string; isMarketing?: boolean }) {
  const session = await requireAiUser();
  if (!session) return { ok: false as const, error: "Not signed in or no permission" };
  const customerId = await customerInOrg(input.customerId, session.orgId);
  if (!customerId) return { ok: false as const, error: "Customer not found" };
  await crmService.sendMessage({ customerId, body: input.body, isMarketing: input.isMarketing });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function searchCustomersForDraft(q: string) {
  const session = await requireAiUser();
  if (!session) return [];
  // organisationId 是这条查询的要害：少了它就是跨租户的客户检索。
  const customers = await db.customer.findMany({
    where: { organisationId: session.orgId, OR: [{ name: { contains: q } }, { phone: { contains: q } }] },
    take: 8,
    select: { id: true, name: true, phone: true },
  });
  return customers;
}
