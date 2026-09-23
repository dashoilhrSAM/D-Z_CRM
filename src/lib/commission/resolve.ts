// 佣金规则的解析与计算（**纯函数，无 IO**）。
//
// 这是整个佣金引擎最该被钉住的一块：钱算错是会计事故，而"哪条规则生效"必须有唯一、
// 可解释、可复现的答案。所以规则消费方只有这一个入口 —— 页面、计提、模拟器都调它。
//
// 三条铁律（设计稿 §2）：
//  ① **最具体者胜，命中即终止、不叠加**：SKU → 服务 → 套餐 → 分类 → 默认。
//     叠加会让"为什么是这个数"无法解释，而佣金是会被拿计算器核对的数字。
//  ② **同一层里不会"百分比和固定额同时生效"**：basis 是枚举（PERCENT | FIXED | COMBO），
//     数据层就做不到两个都填。真要组合就显式用 COMBO。
//  ③ 同层有多条**同时生效**的规则 = 冲突：取 effectiveFrom 最新 → priority 最大 → id 稳定排序，
//     并置 ambiguous 标记（调用方要把它显示出来，不允许静默择一）。

export type RuleScope = "PRODUCT" | "SERVICE" | "PACKAGE" | "CATEGORY" | "DEFAULT";
export type CommissionBasis = "PERCENT" | "FIXED" | "COMBO";

/** 解析器需要的最小规则形状（与 Prisma 模型同构，但只取用到的字段，便于单测）。 */
export interface CommissionRuleLike {
  id: string;
  scope: string;
  targetKey: string | null;
  basis: string;
  value: number;
  valuePercent: number | null;
  valueFixedSen: number | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  priority: number;
  active: boolean;
}

/** 一行工单（只需目录身份 + 佣金基数）。 */
export interface CommissionLineLike {
  productId?: string | null;
  serviceTypeId?: string | null;
  packageId?: string | null;
  category?: string | null;
  /** 佣金基数（成交额，sen）。折后净额的分摊在调用方算好再传进来。 */
  baseSen: number;
  /** 数量（FIXED / COMBO 的固定部分按件计）。 */
  qty: number;
}

export interface ResolvedCommission {
  ok: true;
  rule: CommissionRuleLike;
  /** 命中的层级 —— UI 上要显示"这条来自 SKU 级规则" */
  matchedBy: RuleScope;
  amountSen: number;
  baseSen: number;
  qty: number;
  /** 同层有 >1 条同时生效的规则（冲突，应显示告警） */
  ambiguous: boolean;
  candidates: CommissionRuleLike[];
}

export type CommissionResolution = ResolvedCommission | { ok: false; reason: "no-rule"; candidates: [] };

/** 从最具体到最兜底的匹配链。 */
const CHAIN: RuleScope[] = ["PRODUCT", "SERVICE", "PACKAGE", "CATEGORY", "DEFAULT"];

function inEffect(rule: CommissionRuleLike, at: Date): boolean {
  if (!rule.active) return false;
  if (rule.effectiveFrom.getTime() > at.getTime()) return false;
  if (rule.effectiveTo && rule.effectiveTo.getTime() <= at.getTime()) return false;
  return true;
}

/** 该行在这一层要匹配的 key（null = 这一层不适用）。 */
function keyForScope(line: CommissionLineLike, scope: RuleScope): string | null {
  switch (scope) {
    case "PRODUCT":
      return line.productId ?? null;
    case "SERVICE":
      return line.serviceTypeId ?? null;
    case "PACKAGE":
      return line.packageId ?? null;
    case "CATEGORY":
      return line.category ?? null;
    case "DEFAULT":
      return null;
  }
}

/**
 * 按金额算佣金。
 * · PERCENT：value 是百分点×100（5.25% → 525），四舍五入到分；
 * · FIXED：value 是每件 sen，× 数量；
 * · COMBO：百分比部分 + 每件固定部分（显式组合，不是"两个字段都填"）。
 */
export function commissionAmount(rule: CommissionRuleLike, baseSen: number, qty: number): number {
  const base = Math.max(0, Math.round(baseSen));
  const n = Math.max(0, Math.round(qty));
  switch (rule.basis as CommissionBasis) {
    case "FIXED":
      return Math.round(rule.value) * n;
    case "COMBO":
      return Math.round((base * Math.round(rule.valuePercent ?? 0)) / 10000) + Math.round(rule.valueFixedSen ?? 0) * n;
    case "PERCENT":
    default:
      return Math.round((base * Math.round(rule.value)) / 10000);
  }
}

/** 解析出这条工单行该用哪条规则、算出多少佣金。 */
export function resolveCommissionRule(
  line: CommissionLineLike,
  rules: readonly CommissionRuleLike[],
  at: Date = new Date(),
): CommissionResolution {
  for (const scope of CHAIN) {
    const key = keyForScope(line, scope);
    // PRODUCT/SERVICE/PACKAGE/CATEGORY 都需要 key 才能匹配；DEFAULT 没有 key（targetKey 必须为 null）
    if (scope !== "DEFAULT" && !key) continue;
    const candidates = rules.filter(
      (r) =>
        r.scope === scope &&
        (scope === "DEFAULT" ? r.targetKey == null : r.targetKey === key) &&
        inEffect(r, at),
    );
    if (candidates.length === 0) continue;

    const sorted = [...candidates].sort((a, b) => {
      const byFrom = b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
      if (byFrom !== 0) return byFrom;
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const winner = sorted[0];
    const baseSen = Math.max(0, Math.round(line.baseSen));
    const qty = Math.max(0, Math.round(line.qty));
    return {
      ok: true,
      rule: winner,
      matchedBy: scope,
      amountSen: commissionAmount(winner, baseSen, qty),
      baseSen,
      qty,
      ambiguous: candidates.length > 1,
      candidates: sorted,
    };
  }
  return { ok: false, reason: "no-rule", candidates: [] };
}

const SCOPE_LABEL: Record<RuleScope, string> = {
  PRODUCT: "SKU",
  SERVICE: "service",
  PACKAGE: "package",
  CATEGORY: "category",
  DEFAULT: "default",
};

/** 规则的短语描述（用于日志/审计；界面上的多语言文案由 UI 自己组）。 */
export function describeRule(rule: CommissionRuleLike): string {
  const pct = (v: number) => (v / 100).toFixed(2).replace(/\.00$/, "") + "%";
  const rm = (v: number) => "RM " + (v / 100).toFixed(2);
  switch (rule.basis as CommissionBasis) {
    case "FIXED":
      return rm(rule.value) + "/unit";
    case "COMBO":
      return pct(rule.valuePercent ?? 0) + " + " + rm(rule.valueFixedSen ?? 0) + "/unit";
    case "PERCENT":
    default:
      return pct(rule.value);
  }
}

/** 一行话解释"为什么是这个数"（争议时靠它，别靠翻数据库）。 */
export function explainResolution(res: CommissionResolution, ruleName?: string): string {
  if (!res.ok) return "No commission rule matched — this line falls back to the legacy per-staff rule.";
  const name = ruleName ? ruleName + " " : "";
  const base = "RM " + (res.baseSen / 100).toFixed(2);
  const amount = "RM " + (res.amountSen / 100).toFixed(2);
  const parts = [
    name + "matched " + SCOPE_LABEL[res.matchedBy] + " rule (" + describeRule(res.rule) + ")",
    res.rule.basis === "FIXED" || res.rule.basis === "COMBO"
      ? "base " + base + " x " + res.qty + " unit(s)"
      : "base " + base,
    "→ " + amount,
  ];
  return parts.join(": ").replace(/: base/, " — base").replace(/ x (\d+) unit\(s\)$/, " x $1 unit(s)");
}
