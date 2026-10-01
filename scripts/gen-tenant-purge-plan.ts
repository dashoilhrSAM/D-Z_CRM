/* eslint-disable no-console */
/**
 * 生成**退租删除计划**（`src/modules/platform/purge-plan.generated.ts`）。
 *
 * 为什么是生成而不是手写：退租要把一家店的**每一行**都删干净（87 个模型里有 60+ 个属于租户），
 * 手写一张清单一定会漂移 —— 漏一张表的表现是"删到一半外键报错"，
 * 更糟的是"看起来删成功了、其实留下一批孤儿行"。
 *
 * 输入有两个，都是项目里已有的**单一事实来源**：
 *   · `TENANT_SCOPE`（`src/lib/tenant/scope-map.ts`）—— "这个模型属于哪家店"，
 *     以及经关系到达租户的路径；
 *   · Prisma DMMF —— 模型之间的外键方向，用来定**删除顺序**（先删子、后删父）。
 *
 * 用法：`pnpm exec tsx scripts/gen-tenant-purge-plan.ts`
 * 守卫在 `tests/platform-tenant-purge.test.ts`：scope map 里每个 column/relation 模型
 * 都必须出现在生成结果里，且顺序必须是合法的拓扑序（否则红了就重新生成）。
 */
import { Prisma } from "@prisma/client";
import { TENANT_SCOPE } from "../src/lib/tenant/scope-map";
import { writeFileSync } from "node:fs";

type Model = (typeof Prisma.dmmf.datamodel.models)[number];

const models = Prisma.dmmf.datamodel.models as readonly Model[];
const byName = new Map(models.map((m) => [m.name, m]));

/** 属于租户的模型（有 organisationId 列，或经关系能到达租户）。 */
const owned = Object.entries(TENANT_SCOPE)
  .filter(([, e]) => e.kind === "column" || e.kind === "relation")
  .map(([name]) => name);

/** 该模型的删除条件：column → { organisationId }；relation → 按路径逐层嵌套。 */
function whereFor(name: string): unknown {
  // 租户本身：按主键删（它是最后一个，此时引用它的行都已经删光了）
  if (name === TENANT_ROOT) return { id: "{{ORG}}" };
  const entry = TENANT_SCOPE[name];
  if (entry.kind === "column") return { organisationId: "{{ORG}}" };
  if (entry.kind === "relation") {
    // path 是"逐跳关系字段名"，例如 Booking → ["branch"] ⇒ { branch: { organisationId } }
    let node: Record<string, unknown> = { organisationId: "{{ORG}}" };
    for (const hop of [...entry.path].reverse()) node = { [hop]: node };
    return node;
  }
  throw new Error("不该到这里：" + name);
}

/**
 * 删除顺序：**先删"引用别人的"（子），再删"被引用的"（父）**。
 *
 * 形式化：一条外键边 A → B（A 上有 relationFromFields，指向 B）意味着 **A 必须先于 B 被删**。
 * 于是用 Kahn：一个模型可以被删，当且仅当**所有引用它的模型都已经删掉了**（入度归零）。
 * `Organisation` 被几乎所有模型引用，所以它必然排在最后 —— 这正是我们要的。
 *
 * （第一版把方向写反了：变成"父先于子"，而大多数外键指向不在集合里的 Organisation，
 *   于是顺序退化成注册顺序、末尾停在 StockMovement。所以这里加了 `assertOrder` 自检。）
 */
const TENANT_ROOT = "Organisation";

function deleteOrder(names: string[]): string[] {
  const nodes = [...new Set([...names, TENANT_ROOT])];
  const set = new Set(nodes);
  /** referrers[B] = 引用了 B 的模型集合（它们必须先被删） */
  const referrers = new Map<string, Set<string>>(nodes.map((n) => [n, new Set()]));
  for (const n of nodes) {
    const m = byName.get(n);
    if (!m) continue;
    for (const f of m.fields) {
      if (f.kind !== "object") continue;
      if (!f.relationFromFields || f.relationFromFields.length === 0) continue; // 外键在对面
      if (!set.has(f.type) || f.type === n) continue;
      referrers.get(f.type)!.add(n);
    }
  }
  const remaining = new Set(nodes);
  const order: string[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter((n) => [...referrers.get(n)!].every((r) => !remaining.has(r)));
    if (!ready.length) throw new Error("检出循环外键，无法确定删除顺序：" + [...remaining].join(", "));
    // 同一批内按名字排序，保证生成结果稳定（可复现 → diff 才有意义）
    ready.sort();
    for (const n of ready) {
      order.push(n);
      remaining.delete(n);
    }
  }
  return order;
}

/** 自检：顺序必须满足每一条外键边（A 有 FK 指向 B ⇒ index(A) < index(B)）。 */
function assertOrder(order: string[]) {
  const idx = new Map(order.map((n, i) => [n, i]));
  for (const n of order) {
    const m = byName.get(n)!;
    for (const f of m.fields) {
      if (f.kind !== "object" || !f.relationFromFields?.length) continue;
      if (!idx.has(f.type)) continue;
      if (idx.get(n)! >= idx.get(f.type)!) {
        throw new Error(`顺序不合法：${n} 必须在 ${f.type} 之前（外键 ${f.name}）`);
      }
    }
  }
}

/** 安全网：有 purge 集合**之外**的模型引用 purge 集合里的模型吗？那样删不掉（外键挡着）。 */
function externalReferences(names: string[]): Array<{ from: string; to: string }> {
  const set = new Set(names);
  const out: Array<{ from: string; to: string }> = [];
  for (const m of models) {
    if (set.has(m.name)) continue;
    for (const f of m.fields) {
      if (f.kind !== "object") continue;
      if (!f.relationFromFields || f.relationFromFields.length === 0) continue;
      if (set.has(f.type)) out.push({ from: m.name, to: f.type });
    }
  }
  return out;
}

const order = deleteOrder(owned);
assertOrder(order);
const external = externalReferences(owned);
if (external.length) {
  console.error("⚠️ 以下 purge 集合之外的模型引用了租户数据，退租会被外键挡住（需要人工判断）：");
  for (const e of external) console.error("   · " + e.from + " → " + e.to);
}

const body = `// ⚠️ **本文件由脚本生成，不要手改**：\`pnpm exec tsx scripts/gen-tenant-purge-plan.ts\`
//
// 退租删除计划：删哪些表（scope map 里属于租户的全部模型）、按什么顺序（先子后父）、
// 用什么条件（column → organisationId；relation → 沿 scope map 的路径嵌套）。
// 完整性由 tests/platform-tenant-purge.test.ts 守着：scope map 里每个 column/relation
// 模型都必须在这里出现，且顺序必须是合法拓扑序 —— 漏一个就红。

/** 删除顺序：数组下标越小越先删。最后一项是 Organisation 本身。 */
export const PURGE_ORDER = ${JSON.stringify(order, null, 2)} as const;

/** 每个模型的删除条件模板；占位符 ORG 会被替换成真实 organisationId。
 *  Organisation 用 id 主键，其余按 scope map 的路径（column → organisationId，relation → 嵌套）。 */
export const PURGE_WHERE: Record<string, unknown> = ${JSON.stringify(Object.fromEntries(order.map((n) => [n, whereFor(n)])), null, 2)};

/** 不在租户范围内的模型（shared/none）——不参与退租删除，列出来是为了让人一眼能核对。 */
export const NON_TENANT_MODELS = ${JSON.stringify(Object.keys(TENANT_SCOPE).filter((n) => !owned.includes(n)), null, 2)} as const;
`;

writeFileSync("src/modules/platform/purge-plan.generated.ts", body);
console.log("已写入 purge-plan.generated.ts");
console.log("  属于租户的模型:", owned.length, "｜删除顺序前 5:", order.slice(0, 5).join(" → "));
console.log("  最后 3 个:", order.slice(-3).join(" → "));
console.log("  非租户模型:", Object.keys(TENANT_SCOPE).length - owned.length);
if (external.length) process.exitCode = 1;
