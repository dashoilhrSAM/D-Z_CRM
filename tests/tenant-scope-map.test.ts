// 租户作用域地图的**对账测试**：这张地图是 P2 强制层的唯一依据，写错了就是隔离漏洞。
//
// 三条断言，每条都能独立失败：
//   ① **完整性** —— schema.prisma 里的每一个模型都必须在地图里登记。
//      新增模型却忘了登记 → 测试红（这正是"忘掉一张表"最容易发生的形态）。
//   ② **路径有效性** —— 每个 relation 条目的逐跳字段名必须真的存在于 schema 的对应模型上，
//      且**最后一跳落的模型必须真的有 organisationId**。写错字段名、指错父表都会在这里现形。
//   ③ **column 条目属实** —— 声明 column 的模型必须真的带 organisationId
//      （否则强制层会去 where 一个不存在的列，Prisma 直接报错）。
//
// 为什么用"读 schema 文本"而不是 BFS 自动推导：自动推导会选错父表
// （ServiceJobPart 能经 job 也能经 product 到达租户，BFS 可能选 product，
// 于是"这行属于哪家店"变成"这个零件属于哪家店"）。路径必须是人核对过的，
// 自动化的部分只用来**验证**，不用来生成。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TENANT_SCOPE, tenantWhere, tenantScopedModels } from "@/lib/tenant/scope-map";

interface ModelShape {
  hasOrgColumn: boolean;
  /** 对象关系字段名 → 目标模型名（只取带 @relation 的一对一/多对一那侧） */
  relations: Record<string, string>;
}

function parseSchema(): Map<string, ModelShape> {
  const src = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const out = new Map<string, ModelShape>();
  for (const m of src.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const [, name, body] = m;
    const relations: Record<string, string> = {};
    for (const line of body.split("\n")) {
      const r = line.match(/^\s*(\w+)\s+(\w+)(\[\])?\??\s+@relation\(/);
      if (r && !r[3]) relations[r[1]] = r[2];
    }
    out.set(name, { hasOrgColumn: /^\s*organisationId\s/m.test(body), relations });
  }
  return out;
}

const schema = parseSchema();

describe("租户作用域地图：完整性", () => {
  it("schema 里的每个模型都登记了（新增模型忘登记 → 这里红）", () => {
    const missing = [...schema.keys()].filter((m) => !(m in TENANT_SCOPE)).sort();
    expect(missing, "这些模型没有租户作用域登记 —— 强制层遇到它们只能放行或全拒，两种都错：\n" + missing.join(", ")).toEqual([]);
  });

  it("地图里没有 schema 里不存在的模型（改名/删模型后的残留）", () => {
    const stale = Object.keys(TENANT_SCOPE).filter((m) => !schema.has(m)).sort();
    expect(stale, "地图里有已不存在的模型：\n" + stale.join(", ")).toEqual([]);
  });

  it("每个 none/shared 条目都写了理由（空理由等于没解释）", () => {
    for (const [model, entry] of Object.entries(TENANT_SCOPE)) {
      if (entry.kind === "none") expect(entry.reason.length, model + " 的 reason 太短").toBeGreaterThan(8);
      if (entry.kind === "shared") expect(entry.note.length, model + " 的 note 太短").toBeGreaterThan(4);
    }
  });
});

describe("租户作用域地图：路径与 schema 对账", () => {
  it("column 条目：模型确实有 organisationId 列", () => {
    const bad = Object.entries(TENANT_SCOPE)
      .filter(([m, e]) => e.kind === "column" && !schema.get(m)?.hasOrgColumn)
      .map(([m]) => m);
    expect(bad, "声明了 column 但 schema 里没有 organisationId：\n" + bad.join(", ")).toEqual([]);
  });

  it("relation 条目：每一跳都存在，且最后一跳落的模型真的有 organisationId", () => {
    const problems: string[] = [];
    for (const [model, entry] of Object.entries(TENANT_SCOPE)) {
      if (entry.kind !== "relation") continue;
      let current = model;
      for (const hop of entry.path) {
        const shape = schema.get(current);
        if (!shape) {
          problems.push(model + ": " + current + " 不存在于 schema");
          current = "";
          break;
        }
        const target = shape.relations[hop];
        if (!target) {
          problems.push(model + ": " + current + " 上没有名为 " + hop + " 的关系字段");
          current = "";
          break;
        }
        current = target;
      }
      if (current && !schema.get(current)?.hasOrgColumn) {
        problems.push(model + ": 路径 " + entry.path.join(".") + " 落在 " + current + "，但它没有 organisationId");
      }
    }
    expect(problems, "作用域路径与 schema 不符：\n" + problems.join("\n")).toEqual([]);
  });

  it("relation 条目不得指向 shared 模型（共享参考数据不是租户边界）", () => {
    const shared = new Set(Object.entries(TENANT_SCOPE).filter(([, e]) => e.kind === "shared").map(([m]) => m));
    const problems: string[] = [];
    for (const [model, entry] of Object.entries(TENANT_SCOPE)) {
      if (entry.kind !== "relation") continue;
      let current: string | undefined = model;
      for (const hop of entry.path) {
        current = current ? schema.get(current)?.relations[hop] : undefined;
        if (!current) break;
      }
      if (current && shared.has(current)) problems.push(model + " 的路径终点是共享模型 " + current);
    }
    expect(problems).toEqual([]);
  });
});

describe("租户作用域地图：tenantWhere 的形状", () => {
  it("column → 直接过滤 organisationId", () => {
    expect(tenantWhere("Customer", "org1")).toEqual({ organisationId: "org1" });
  });

  it("一跳 relation → 嵌套过滤", () => {
    expect(tenantWhere("Booking", "org1")).toEqual({ branch: { organisationId: "org1" } });
  });

  it("两跳 relation → 双层嵌套", () => {
    expect(tenantWhere("PurchaseOrderItem", "org1")).toEqual({ purchaseOrder: { branch: { organisationId: "org1" } } });
  });

  it("none/shared → null（调用方必须显式决定，不允许默认放行）", () => {
    expect(tenantWhere("OtpAttempt", "org1")).toBeNull();
    expect(tenantWhere("Occasion", "org1")).toBeNull();
  });

  it("未登记的模型 → 抛错（fail-closed，而不是静默放行）", () => {
    expect(() => tenantWhere("NoSuchModel", "org1")).toThrow(/未登记/);
  });

  it("需要收窄的模型数量合理（防止地图被清空后测试空跑）", () => {
    const n = tenantScopedModels().length;
    expect(n, "收窄模型数异常：当前 " + n).toBeGreaterThan(60);
  });
});
