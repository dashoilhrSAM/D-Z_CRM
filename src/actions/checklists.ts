"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";

/** Editing templates is for management staff; mechanics run checklists, not manage the library. */
async function requireEditor() {
  const s = await getSessionUser();
  if (!s.authenticated || s.kind !== "staff") return null;
  if (s.role === "MECHANIC") return null;
  return s;
}

/**
 * 模板归属判定（P1b 收口）。
 *
 * 2026-09-30 之前这里的写法是"能改任意模板"：
 *   · `updateMany({ data: { isDefault: false } })` **没有 where** —— 一个人设默认模板，
 *     会把**所有租户**的默认模板清掉；
 *   · `update/delete({ where: { id } })`、`checklistItem.update({ where: { id } })` 按裸 id 写，
 *     跨租户可改可删；
 *   · `deleteChecklistTemplate` 的"最后一个模板不许删"也用的是**全库** count。
 *
 * ChecklistTemplate 现在有 organisationId（P1a 加的列 + 回填），所以归属可以真判了。
 * ChecklistItem 自己没有租户列 —— 经 `template` 关系收窄，链只有一跳，精确且不需要冗余列。
 */
async function templateInOrg(id: string, organisationId: string) {
  return db.checklistTemplate.findFirst({ where: { id, organisationId }, select: { id: true } });
}

export type MutResult = { ok: boolean; id?: string; error?: string };

export async function createChecklistTemplate(input: { name: string }): Promise<MutResult> {
  const s = await requireEditor();
  if (!s) return { ok: false, error: "unauthorized" };
  const name = input?.name?.trim();
  if (!name) return { ok: false, error: "name_required" };
  // 模板按组织归属：不写这一列，模板就还是"全局单例"（谁都能用、谁都能改）
  const created = await db.checklistTemplate.create({ data: { organisationId: s.orgId, name } });
  revalidatePath("/", "layout");
  return { ok: true, id: created.id };
}

export async function updateChecklistTemplate(id: string, input: { name?: string; isDefault?: boolean }): Promise<MutResult> {
  const s = await requireEditor();
  if (!s) return { ok: false, error: "unauthorized" };
  if (!(await templateInOrg(id, s.orgId))) return { ok: false, error: "not_found" };
  const data: { name?: string; isDefault?: boolean } = {};
  if (typeof input?.name === "string") data.name = input.name.trim() || undefined;
  if (typeof input?.isDefault === "boolean") data.isDefault = input.isDefault;
  // "设默认"要先把**本组织**其它模板的默认清掉 —— 原来没有 where，清的是全库
  if (input?.isDefault) await db.checklistTemplate.updateMany({ where: { organisationId: s.orgId }, data: { isDefault: false } });
  await db.checklistTemplate.update({ where: { id }, data });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteChecklistTemplate(id: string): Promise<MutResult> {
  const s = await requireEditor();
  if (!s) return { ok: false, error: "unauthorized" };
  if (!(await templateInOrg(id, s.orgId))) return { ok: false, error: "not_found" };
  // "最后一个模板不许删"必须按**本组织**计数：全库 count 会让一家店多到用不完的模板
  // 变成另一家店删不掉自己最后一份模板的理由。
  const count = await db.checklistTemplate.count({ where: { organisationId: s.orgId } });
  if (count <= 1) return { ok: false, error: "last_template" };
  await db.checklistTemplate.delete({ where: { id } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setDefaultChecklistTemplate(id: string): Promise<MutResult> {
  const s = await requireEditor();
  if (!s) return { ok: false, error: "unauthorized" };
  if (!(await templateInOrg(id, s.orgId))) return { ok: false, error: "not_found" };
  await db.checklistTemplate.updateMany({ where: { organisationId: s.orgId }, data: { isDefault: false } });
  await db.checklistTemplate.update({ where: { id }, data: { isDefault: true } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function addChecklistItem(templateId: string, input: { name: string; category?: string; order?: number }): Promise<MutResult> {
  const s = await requireEditor();
  if (!s) return { ok: false, error: "unauthorized" };
  if (!(await templateInOrg(templateId, s.orgId))) return { ok: false, error: "not_found" };
  const name = input?.name?.trim();
  if (!name) return { ok: false, error: "name_required" };
  const last = await db.checklistItem.findFirst({ where: { templateId }, orderBy: { order: "desc" } });
  const order = input?.order ?? (last?.order ?? 0) + 1;
  const created = await db.checklistItem.create({ data: { templateId, name, category: input?.category || null, order } });
  revalidatePath("/", "layout");
  return { ok: true, id: created.id };
}

export async function updateChecklistItem(id: string, input: { name?: string; category?: string; order?: number }): Promise<MutResult> {
  const s = await requireEditor();
  if (!s) return { ok: false, error: "unauthorized" };
  const data: { name?: string; category?: string | null; order?: number } = {};
  if (typeof input?.name === "string") data.name = input.name.trim();
  if (typeof input?.category === "string") data.category = input.category.trim() || null;
  if (typeof input?.order === "number") data.order = input.order;
  // ChecklistItem 没有租户列 —— 经 template 关系收窄；update 的 where 只吃唯一键，所以用 updateMany
  const res = await db.checklistItem.updateMany({ where: { id, template: { organisationId: s.orgId } }, data });
  if (res.count === 0) return { ok: false, error: "not_found" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteChecklistItem(id: string): Promise<MutResult> {
  const s = await requireEditor();
  if (!s) return { ok: false, error: "unauthorized" };
  const res = await db.checklistItem.deleteMany({ where: { id, template: { organisationId: s.orgId } } });
  if (res.count === 0) return { ok: false, error: "not_found" };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Reorder a template's items: orderedIds is the full list of item ids in new order. */
export async function reorderChecklistItems(templateId: string, orderedIds: string[]): Promise<MutResult> {
  const s = await requireEditor();
  if (!s) return { ok: false, error: "unauthorized" };
  // 先证明这份模板属于本组织 —— 否则下面"这些 id 属于该模板"的检查只是在证明
  // "它们属于**一份**模板"，跨租户照样能重排。
  if (!(await templateInOrg(templateId, s.orgId))) return { ok: false, error: "not_found" };
  if (orderedIds.length > 0) {
    const owned = await db.checklistItem.count({ where: { id: { in: orderedIds }, templateId } });
    if (owned !== new Set(orderedIds).size) return { ok: false, error: "not_found" };
  }
  await db.$transaction(
    orderedIds.map((id, i) => db.checklistItem.updateMany({ where: { id, templateId }, data: { order: i + 1 } }))
  );
  revalidatePath("/", "layout");
  return { ok: true };
}
