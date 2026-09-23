"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth/audit";
import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/session-user";
import { resolveCommissionRule, describeRule, type CommissionRuleLike } from "@/lib/commission/resolve";
import { detectConflicts } from "@/lib/commission/conflicts";

// 佣金规则的管理入口（P1）。
//
// 三道自己把的门（Server Action 不受路由级中间件覆盖，这是项目既有教训）：
//  ① 身份 + **矩阵权限**（TECHNICIANS/edit —— 与结算同属「人和钱」这块，OWNER/MANAGER 走通配）；
//  ② 入参校验：scope 与 targetKey 必须匹配（DEFAULT 不能带 key；PRODUCT/SERVICE/PACKAGE 必须是真实存在的目录行），
//     basis 与数值必须自洽（PERCENT 不能超过 100%）；
//  ③ **写入时挡重叠**：同一 (scope, targetKey) 的两条规则生效区间不能重叠 —— 重叠会产生
//     「哪条生效」的歧义（解析器能确定性选一条，但那不是业务想要的）。要改就先把旧规则设 effectiveTo。
//
// 资金类写入必须有审计：每次规则变更都留一条 AuditLog（谁、改成什么）。
// 注意：本文件只导出 async action —— 纯函数（如冲突检测）放在 src/lib/commission/*。

const SCOPES = ["PRODUCT", "SERVICE", "PACKAGE", "CATEGORY", "DEFAULT"] as const;
const BASES = ["PERCENT", "FIXED", "COMBO"] as const;
type Scope = (typeof SCOPES)[number];
type Basis = (typeof BASES)[number];

async function requireCommissionManager() {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return { error: "Not signed in" as const };
  const allowed = await can(
    { id: session.user.id, role: session.role as never, organisationId: session.orgId },
    "TECHNICIANS",
    "edit",
  );
  if (!allowed) return { error: "No permission to edit commission rules" as const };
  return { session };
}

export interface CommissionRuleRow {
  id: string;
  scope: string;
  targetKey: string | null;
  basis: string;
  value: number;
  valuePercent: number | null;
  valueFixedSen: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  priority: number;
  active: boolean;
  note: string | null;
}

export interface CommissionConfigItem {
  /** 目录行的稳定键（商品 id / 服务 id / 套餐 id / 分类名 / DEFAULT） */
  key: string;
  scope: Scope;
  name: string;
  /** 次要信息（SKU、code、价格、是否停用） */
  meta: string;
  active: boolean;
  /** 这一层**自己**配了的规则（null = 没配，会继承上层） */
  rule: CommissionRuleRow | null;
  /** 规则短语（如 5% / RM 2.00/unit / 5% + RM 2.00/unit） */
  ruleLabel: string | null;
  /** 实际生效的层级（可能来自上层 —— 界面要能看出「没配，继承自分类」） */
  matchedBy: string | null;
  /** 同层冲突（>1 条同时生效） */
  ambiguous: boolean;
}

function toRow(r: { id: string; scope: string; targetKey: string | null; basis: string; value: number; valuePercent: number | null; valueFixedSen: number | null; effectiveFrom: Date; effectiveTo: Date | null; priority: number; active: boolean; note: string | null }): CommissionRuleRow {
  return {
    id: r.id, scope: r.scope, targetKey: r.targetKey, basis: r.basis, value: r.value,
    valuePercent: r.valuePercent, valueFixedSen: r.valueFixedSen,
    effectiveFrom: r.effectiveFrom.toISOString(),
    effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString() : null,
    priority: r.priority, active: r.active, note: r.note,
  };
}

const asLike = (r: CommissionRuleRow): CommissionRuleLike => ({
  id: r.id, scope: r.scope, targetKey: r.targetKey, basis: r.basis, value: r.value,
  valuePercent: r.valuePercent, valueFixedSen: r.valueFixedSen,
  effectiveFrom: new Date(r.effectiveFrom), effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null,
  priority: r.priority, active: r.active,
});

/** 管理页数据：目录（SKU / 服务 / 套餐 / 分类 / 默认）+ 当前生效规则 + 冲突。 */
export async function listCommissionConfig() {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return { ok: false as const, error: "Not signed in" };

  const [products, serviceTypes, packages, rulesRaw] = await Promise.all([
    db.product.findMany({ where: { organisationId: session.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true, sku: true, category: true, active: true } }),
    db.serviceType.findMany({ where: { organisationId: session.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, category: true, active: true } }),
    // ServicePackage 模型上**没有** organisationId（只有 branchId，且是裸字段）——按现状只能全局取。
    db.servicePackage.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, priceSen: true, active: true } }),
    db.commissionRule.findMany({ where: { organisationId: session.orgId }, orderBy: [{ scope: "asc" }, { effectiveFrom: "desc" }] }),
  ]);
  const rules = rulesRaw.map(toRow);
  const likes = rules.map(asLike);
  const now = new Date();

  /** 这一层自己配了没有？命中的若是上层则视为「未配置（继承）」。 */
  const look = (scope: Scope, line: { productId?: string | null; serviceTypeId?: string | null; packageId?: string | null; category?: string | null }) => {
    const res = resolveCommissionRule({ ...line, baseSen: 0, qty: 1 }, likes, now);
    if (!res.ok) return { rule: null, ruleLabel: null, matchedBy: null, ambiguous: false };
    const own = res.matchedBy === scope;
    const row = own ? rules.find((r) => r.id === res.rule.id) ?? null : null;
    return {
      rule: row,
      ruleLabel: row ? describeRule(asLike(row)) : null,
      matchedBy: res.matchedBy,
      ambiguous: own && res.ambiguous,
    };
  };

  const items: CommissionConfigItem[] = [];
  for (const p of products) {
    items.push({ key: p.id, scope: "PRODUCT", name: p.name, meta: p.sku + (p.active ? "" : " · inactive"), active: p.active, ...look("PRODUCT", { productId: p.id, category: p.category }) });
  }
  for (const s of serviceTypes) {
    items.push({ key: s.id, scope: "SERVICE", name: s.name, meta: (s.code ?? "no code") + (s.active ? "" : " · inactive"), active: s.active, ...look("SERVICE", { serviceTypeId: s.id, category: s.category }) });
  }
  for (const p of packages) {
    items.push({ key: p.id, scope: "PACKAGE", name: p.name, meta: "RM " + (p.priceSen / 100).toFixed(2) + (p.active ? "" : " · inactive"), active: p.active, ...look("PACKAGE", { packageId: p.id }) });
  }
  const categories = [...new Set([...products.map((p) => p.category), ...serviceTypes.map((s) => s.category)].filter((c): c is string => !!c))].sort();
  for (const c of categories) {
    items.push({ key: c, scope: "CATEGORY", name: c, meta: "", active: true, ...look("CATEGORY", { category: c }) });
  }
  items.push({ key: "DEFAULT", scope: "DEFAULT", name: "Default (fallback for everything)", meta: "", active: true, ...look("DEFAULT", {}) });

  return { ok: true as const, items, rules, conflicts: detectConflicts(rules) };
}

export type UpsertRuleInput = {
  id?: string;
  scope: Scope;
  targetKey: string | null;
  basis: Basis;
  /** PERCENT → 百分点×100；FIXED → sen；COMBO → 忽略 */
  value?: number;
  valuePercent?: number;
  valueFixedSen?: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  priority?: number;
  note?: string | null;
  active?: boolean;
};

/** 新建/更新一条规则（校验 + 挡重叠 + 审计）。 */
export async function upsertCommissionRule(input: UpsertRuleInput) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return { ok: false as const, error: guard.error };
  const { session } = guard;

  if (!SCOPES.includes(input.scope)) return { ok: false as const, error: "Unknown scope" };
  if (!BASES.includes(input.basis)) return { ok: false as const, error: "Unknown basis" };

  const key = input.targetKey?.trim() || null;
  if (input.scope === "DEFAULT" && key) return { ok: false as const, error: "The default rule cannot target a specific item." };
  if (input.scope === "CATEGORY" && !key) return { ok: false as const, error: "Pick a category." };
  if ((input.scope === "PRODUCT" || input.scope === "SERVICE" || input.scope === "PACKAGE") && !key) {
    return { ok: false as const, error: "Pick an item." };
  }
  if (input.scope === "PRODUCT" && key) {
    if (!(await db.product.findFirst({ where: { id: key, organisationId: session.orgId }, select: { id: true } }))) {
      return { ok: false as const, error: "That product no longer exists." };
    }
  }
  if (input.scope === "SERVICE" && key) {
    if (!(await db.serviceType.findFirst({ where: { id: key, organisationId: session.orgId }, select: { id: true } }))) {
      return { ok: false as const, error: "That service no longer exists." };
    }
  }
  if (input.scope === "PACKAGE" && key) {
    if (!(await db.servicePackage.findFirst({ where: { id: key }, select: { id: true } }))) {
      return { ok: false as const, error: "That package no longer exists." };
    }
  }

  const value = Math.max(0, Math.round(input.value ?? 0));
  const pct = input.valuePercent == null ? null : Math.max(0, Math.round(input.valuePercent));
  const fixed = input.valueFixedSen == null ? null : Math.max(0, Math.round(input.valueFixedSen));
  if (input.basis === "PERCENT" && (value <= 0 || value > 10000)) {
    return { ok: false as const, error: "Percentage must be greater than 0 and at most 100%." };
  }
  if (input.basis === "FIXED" && value <= 0) return { ok: false as const, error: "Fixed amount must be greater than 0." };
  if (input.basis === "COMBO" && (pct ?? 0) <= 0 && (fixed ?? 0) <= 0) {
    return { ok: false as const, error: "A combo needs at least a percentage or a per-unit amount." };
  }
  if (input.basis === "COMBO" && (pct ?? 0) > 10000) return { ok: false as const, error: "Percentage must be at most 100%." };

  const from = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
  const to = input.effectiveTo ? new Date(input.effectiveTo) : null;
  if (Number.isNaN(from.getTime())) return { ok: false as const, error: "Invalid start date." };
  if (to && Number.isNaN(to.getTime())) return { ok: false as const, error: "Invalid end date." };
  if (to && to.getTime() <= from.getTime()) return { ok: false as const, error: "The end date must be after the start date." };

  // 挡重叠（不含自己；只比生效中的）
  const siblings = await db.commissionRule.findMany({
    where: { organisationId: session.orgId, scope: input.scope, targetKey: key, active: true, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { id: true, effectiveFrom: true, effectiveTo: true, basis: true, value: true, valuePercent: true, valueFixedSen: true },
  });
  for (const s of siblings) {
    const sTo = s.effectiveTo ? s.effectiveTo.getTime() : Infinity;
    if (from.getTime() < sTo && s.effectiveFrom.getTime() < (to ? to.getTime() : Infinity)) {
      const label = describeRule({ ...s, scope: input.scope, targetKey: key, priority: 0, active: true } as CommissionRuleLike);
      return {
        ok: false as const,
        error:
          "Another rule for this item is already active in that period (" + label + "). Give it an end date first — overlapping rules make it ambiguous which one applies.",
      };
    }
  }

  const data = {
    scope: input.scope,
    targetKey: key,
    basis: input.basis,
    value: input.basis === "COMBO" ? 0 : value,
    valuePercent: input.basis === "COMBO" ? pct : null,
    valueFixedSen: input.basis === "COMBO" ? fixed : null,
    effectiveFrom: from,
    effectiveTo: to,
    priority: Math.round(input.priority ?? 0),
    note: input.note?.trim() || null,
    active: input.active ?? true,
  };

  const saved = input.id
    ? await db.commissionRule.update({ where: { id: input.id }, data })
    : await db.commissionRule.create({ data: { ...data, organisationId: session.orgId, createdBy: session.user!.id } });

  await audit({
    organisationId: session.orgId, branchId: session.branchId, userId: session.user!.id,
    action: input.id ? "COMMISSION_RULE_UPDATE" : "COMMISSION_RULE_CREATE",
    entity: "CommissionRule", entityId: saved.id,
    after: {
      scope: saved.scope, targetKey: saved.targetKey, basis: saved.basis, value: saved.value,
      valuePercent: saved.valuePercent, valueFixedSen: saved.valueFixedSen,
      effectiveFrom: saved.effectiveFrom, effectiveTo: saved.effectiveTo,
    },
  });
  revalidatePath("/workshop/commission");
  return { ok: true as const, id: saved.id };
}

/** 停用/启用一条规则（不删历史 —— 「当时为什么是这个数」还要能解释）。 */
export async function setCommissionRuleActive(id: string, active: boolean) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return { ok: false as const, error: guard.error };
  const { session } = guard;
  const before = await db.commissionRule.findFirst({ where: { id, organisationId: session.orgId } });
  if (!before) return { ok: false as const, error: "Rule not found" };
  await db.commissionRule.update({ where: { id }, data: { active } });
  await audit({
    organisationId: session.orgId, branchId: session.branchId, userId: session.user!.id,
    action: "COMMISSION_RULE_TOGGLE", entity: "CommissionRule", entityId: id,
    before: { active: before.active }, after: { active },
  });
  revalidatePath("/workshop/commission");
  return { ok: true as const };
}

/** 模拟器：给几行明细，算出每行的佣金与「为什么是这个数」。 */
export async function simulateCommission(lines: { productId?: string | null; serviceTypeId?: string | null; packageId?: string | null; category?: string | null; baseSen: number; qty: number }[]) {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return { ok: false as const, error: "Not signed in" };
  const rules = await db.commissionRule.findMany({ where: { organisationId: session.orgId } });
  const likes: CommissionRuleLike[] = rules.map((r) => ({
    id: r.id, scope: r.scope, targetKey: r.targetKey, basis: r.basis, value: r.value,
    valuePercent: r.valuePercent, valueFixedSen: r.valueFixedSen,
    effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, priority: r.priority, active: r.active,
  }));
  const now = new Date();
  const out = lines.map((l) => {
    const res = resolveCommissionRule(l, likes, now);
    const base = "RM " + (l.baseSen / 100).toFixed(2);
    return {
      baseSen: l.baseSen,
      qty: l.qty,
      matchedBy: res.ok ? res.matchedBy : null,
      ruleLabel: res.ok ? describeRule(res.rule) : null,
      amountSen: res.ok ? res.amountSen : 0,
      ambiguous: res.ok ? res.ambiguous : false,
      explanation: res.ok
        ? "matched " + res.matchedBy + " rule (" + describeRule(res.rule) + ") — base " + base + (l.qty > 1 ? " x " + l.qty : "") + " → RM " + (res.amountSen / 100).toFixed(2)
        : "No rule matched — falls back to the legacy per-staff rule",
    };
  });
  return { ok: true as const, lines: out, totalSen: out.reduce((s, x) => s + x.amountSen, 0) };
}
