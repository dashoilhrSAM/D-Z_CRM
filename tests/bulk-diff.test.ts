// 工作簿导入的差异计算（P2）—— **纯函数，所以每条安全规则都能钉死**。
//
// 这个文件存在的理由：导入是"一次改几百条"的操作，出错代价极高，
// 而其中三条规则一旦被"简化"掉，事故是静默的（数据没了、或者价格被清零，没人会发现）。
import { describe, expect, it } from "vitest";
import { planSheet, parseMoney, cellToValue, type IncomingRow } from "@/modules/bulk/diff";
import { PRODUCTS_SHEET, PACKAGES_SHEET } from "@/modules/bulk/sheets";

function row(rowNumber: number, cells: Record<string, unknown>, action?: IncomingRow["action"]): IncomingRow {
  return { rowNumber, cells, action };
}
const existingProducts = [
  { sku: "OIL-4T", name: "Oil 4T", sellPriceSen: 3500, costPriceSen: 2500, unit: "litre", minStock: 5 },
  { sku: "PLUG-1", name: "Spark Plug", sellPriceSen: 1200, costPriceSen: 700, unit: "piece", minStock: 10 },
  { sku: "FILTER-1", name: "Oil Filter", sellPriceSen: 2500, costPriceSen: 1500, unit: "piece", minStock: 4 },
];

describe("**不进则不删**（最重要的一条）", () => {
  it("文件里只有 1 行时，另外 2 条既不被删也不出现在计划里", () => {
    const { plans, summary } = planSheet({
      def: PRODUCTS_SHEET,
      incoming: [row(3, { sku: "OIL-4T", name: "Oil 4T", sellPriceSen: 36, costPriceSen: 25 })],
      existing: existingProducts,
    });
    expect(plans).toHaveLength(1);
    expect(summary.delete).toBe(0);
    expect(plans.every((p) => !["delete"].includes(p.action))).toBe(true);
  });

  it("要删必须在 _action 列显式写 delete；删不存在的键会报错", () => {
    const { plans, summary } = planSheet({
      def: PRODUCTS_SHEET,
      incoming: [row(3, { sku: "PLUG-1" }, "delete"), row(4, { sku: "NOPE" }, "delete")],
      existing: existingProducts,
    });
    expect(summary.delete).toBe(1);
    expect(plans[0].action).toBe("delete");
    expect(plans[1].action).toBe("error");
    expect(plans[1].errors.join(" ")).toContain("nothing to delete");
  });
});

describe("**留空 = 不动**（第二条：空单元格不能把价格清零）", () => {
  it("只填了名称，价格留空 → 价格不进 changes，也不写库", () => {
    const { plans } = planSheet({
      def: PRODUCTS_SHEET,
      incoming: [row(3, { sku: "OIL-4T", name: "Oil 4T (new name)" })],
      existing: existingProducts,
    });
    expect(plans[0].action).toBe("update");
    expect(Object.keys(plans[0].values)).toEqual(["name"]);
    expect(plans[0].values.sellPriceSen).toBeUndefined();
  });

  it("什么都没改 → skip（不是 update），预览里不会出现假的改动", () => {
    const { plans, summary } = planSheet({
      def: PRODUCTS_SHEET,
      incoming: [row(3, { sku: "OIL-4T", name: "Oil 4T", sellPriceSen: 35, costPriceSen: 25, unit: "litre" })],
      existing: existingProducts,
    });
    expect(plans[0].action).toBe("skip");
    expect(summary.skip).toBe(1);
    expect(summary.update).toBe(0);
  });
});

describe("金额与枚举的归一", () => {
  it("金额吃得下 RM 前缀、逗号、整数与小数", () => {
    expect(parseMoney("12.5")).toEqual({ ok: true, value: 1250 });
    expect(parseMoney("RM 1,234.50")).toEqual({ ok: true, value: 123450 });
    expect(parseMoney("35")).toEqual({ ok: true, value: 3500 });
    expect(parseMoney("abc").ok).toBe(false);
    expect(parseMoney("-5").ok).toBe(false);
  });

  it("档位 / 类型 / 是否 都接受中英两种写法（模板里两列并排，老板用中文也认）", () => {
    const tier = PACKAGES_SHEET.columns.find((c) => c.field === "tier")!;
    expect(cellToValue(tier, "Good")).toEqual({ ok: true, value: "GOOD" });
    expect(cellToValue(tier, "最好")).toEqual({ ok: true, value: "BEST" });
    expect(cellToValue(tier, "nonsense").ok).toBe(false);

    const best = PACKAGES_SHEET.columns.find((c) => c.field === "isBestValue")!;
    expect(cellToValue(best, "Yes")).toEqual({ ok: true, value: true });
    expect(cellToValue(best, "否")).toEqual({ ok: true, value: false });
  });

  it("改价：只有真的变了才进 changes，并带上新旧值", () => {
    const { plans } = planSheet({
      def: PRODUCTS_SHEET,
      incoming: [row(3, { sku: "OIL-4T", sellPriceSen: 38, costPriceSen: 25 })],
      existing: existingProducts,
    });
    expect(plans[0].action).toBe("update");
    expect(plans[0].changes).toEqual([{ field: "sellPriceSen", from: 3500, to: 3800 }]);
  });
});

describe("出错就挡下来（第三条：宁可再传一次，也不要半对半错）", () => {
  it("新增缺必填 → error，并指出缺哪一列", () => {
    const { plans, summary } = planSheet({
      def: PRODUCTS_SHEET,
      incoming: [row(3, { sku: "NEW-1", name: "New Part" })],
      existing: existingProducts,
    });
    expect(summary.error).toBe(1);
    expect(plans[0].errors.join(" ")).toContain("required for a new row");
    expect(plans[0].errors.join(" ")).toContain("Sell Price");
  });

  it("同一张表里重复的键 → error（否则会互相覆盖，而且没人知道）", () => {
    const { plans } = planSheet({
      def: PRODUCTS_SHEET,
      incoming: [
        row(3, { sku: "DUP", name: "A", sellPriceSen: 1, costPriceSen: 1 }),
        row(4, { sku: "DUP", name: "B", sellPriceSen: 2, costPriceSen: 1 }),
      ],
      existing: [],
    });
    expect(plans[1].action).toBe("error");
    expect(plans[1].errors.join(" ")).toContain("duplicate");
  });

  it("没有键的行 → error（键是「改哪一条」的唯一依据，不能猜）", () => {
    const { plans } = planSheet({
      def: PRODUCTS_SHEET,
      incoming: [row(3, { name: "No SKU", sellPriceSen: 1, costPriceSen: 1 })],
      existing: existingProducts,
    });
    expect(plans[0].action).toBe("error");
    expect(plans[0].errors.join(" ")).toContain("SKU is required");
  });

  it("金额写成文字 → error，且错误带列名", () => {
    const { plans } = planSheet({
      def: PRODUCTS_SHEET,
      incoming: [row(3, { sku: "OIL-4T", sellPriceSen: "三十块" })],
      existing: existingProducts,
    });
    expect(plans[0].action).toBe("error");
    expect(plans[0].errors.join(" ")).toContain("Sell Price");
  });
});
