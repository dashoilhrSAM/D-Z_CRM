// 规则冲突检测（**纯函数**）。
//
// 为什么单独成文件："use server" 文件（src/actions/*.ts）里导出的**每个函数都会变成
// 客户端可调用的 server action** —— 把这种纯判定放在那里既没必要（它不是 action），
// 也会白白扩大攻击面（本项目在骑手改号那轮踩过同样的坑）。
//
// 冲突的定义：同一 (scope, targetKey) 下有两条**生效区间重叠**且都 active 的规则。
// 解析器能确定性地择一（取 effectiveFrom 最新），但那不是业务想要的 —— 所以既要在写入时挡，
// 也要能对**已有数据**报出来（可能是别处写入的、或规则被改出来的）。

export interface RuleWindow {
  id: string;
  scope: string;
  targetKey: string | null;
  active: boolean;
  effectiveFrom: string | Date;
  effectiveTo: string | Date | null;
}

export interface RuleConflict {
  scope: string;
  targetKey: string | null;
  ids: string[];
}

const ms = (v: string | Date) => (typeof v === "string" ? new Date(v).getTime() : v.getTime());

export function detectConflicts(rules: readonly RuleWindow[]): RuleConflict[] {
  const byKey = new Map<string, RuleWindow[]>();
  for (const r of rules) {
    if (!r.active) continue; // 停用的规则不参与（它不生效，也就不冲突）
    const k = r.scope + "|" + (r.targetKey ?? "");
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const out: RuleConflict[] = [];
  for (const group of byKey.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const aFrom = ms(a.effectiveFrom);
        const aTo = a.effectiveTo ? ms(a.effectiveTo) : Infinity;
        const bFrom = ms(b.effectiveFrom);
        const bTo = b.effectiveTo ? ms(b.effectiveTo) : Infinity;
        // 半开区间 [from, to)：a 在前且 b 还没结束时重叠；反之亦然
        if (aFrom < bTo && bFrom < aTo) out.push({ scope: a.scope, targetKey: a.targetKey, ids: [a.id, b.id] });
      }
    }
  }
  return out;
}
