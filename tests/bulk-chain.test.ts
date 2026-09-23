// 批量配置的**闭环**（P2）：导出 → 解析 → 差异 → 应用。
//
// 这个文件里最有价值的一条是「**往返一致**」：把导出的文件原样再导入，必须**一条改动都没有**。
// 它一次性证明了几件很容易各自出错的事：金额 RM↔sen 的转换、枚举大小写、表头定位、
// 以及"导出漏了某个字段导致导入时被当成清空"。任何一处不一致，这条测试都会红。
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const saved = { databaseUrl: process.env.DATABASE_URL };
const tag = "blk" + Date.now().toString(36);

let db: typeof import("@/lib/db")["db"];
let bulk: {
  build: typeof import("@/modules/bulk/export")["buildSetupWorkbook"];
  parse: typeof import("@/modules/bulk/parse")["parseSetupWorkbook"];
};

let orgId = "";

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  ({ db } = await import("@/lib/db"));
  const exp = await import("@/modules/bulk/export");
  const par = await import("@/modules/bulk/parse");
  bulk = { build: exp.buildSetupWorkbook, parse: par.parseSetupWorkbook };

  const org = await db.organisation.create({ data: { name: "BULK-" + tag } });
  orgId = org.id;
  await db.product.createMany({
    data: [
      { organisationId: org.id, sku: "OIL-" + tag, name: "Oil 4T", category: "ENGINE_OIL", brand: "Motul", unit: "litre", sellPriceSen: 3500, costPriceSen: 2500, minStock: 5, safetyStock: 2, leadTimeDays: 3 },
      { organisationId: org.id, sku: "PLUG-" + tag, name: "Spark Plug", category: "ELECTRICAL", brand: "NGK", unit: "piece", sellPriceSen: 1200, costPriceSen: 700, minStock: 10 },
    ],
  });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { organisationId: orgId } });
  await db.product.deleteMany({ where: { organisationId: orgId } });
  await db.organisation.delete({ where: { id: orgId } });
});

async function currentProducts() {
  return db.product.findMany({
    where: { organisationId: orgId },
    select: { sku: true, name: true, category: true, brand: true, unit: true, sellPriceSen: true, costPriceSen: true, minStock: true, safetyStock: true, leadTimeDays: true, barcode: true, manufacturerPartNo: true, compatibleModels: true, active: true },
  });
}

describe("往返一致：导出的文件原样导入 = 零改动", () => {
  it("**一条 update 都不该出现**（金额/枚举/表头的任何不一致都会在这里现形）", async () => {
    const { planSheet } = await import("@/modules/bulk/diff");
    const { PRODUCTS_SHEET } = await import("@/modules/bulk/sheets");

    const bytes = await bulk.build(orgId);
    const parsed = await bulk.parse(bytes);
    const sheet = parsed.sheets.find((s) => s.key === "products")!;
    expect(sheet.found).toBe(true);
    expect(sheet.rows.length).toBe(2);

    const existing = await currentProducts();
    const { plans, summary } = planSheet({ def: PRODUCTS_SHEET, incoming: sheet.rows, existing });
    expect(summary).toEqual({ create: 0, update: 0, delete: 0, skip: 2, error: 0 });
    expect(plans.every((p) => p.action === "skip")).toBe(true);
  });
});

describe("改一条、加一条、删一条", () => {
  it("只改过的进 update，新 SKU 进 create，带 delete 标记的才进 delete", async () => {
    const { planSheet } = await import("@/modules/bulk/diff");
    const { PRODUCTS_SHEET } = await import("@/modules/bulk/sheets");
    const { applyProductPlans } = await import("@/modules/bulk/apply");

    const bytes = await bulk.build(orgId);
    const parsed = await bulk.parse(bytes);
    const sheet = parsed.sheets.find((s) => s.key === "products")!;

    // 在"文件"里动手：改价、新增、标记删除
    const rows = sheet.rows.map((r) => ({ ...r, cells: { ...r.cells } }));
    const oil = rows.find((r) => String(r.cells.sku) === "OIL-" + tag)!;
    oil.cells.sellPriceSen = 38; // RM 38
    const plug = rows.find((r) => String(r.cells.sku) === "PLUG-" + tag)!;
    plug.action = "delete";
    rows.push({
      rowNumber: 99,
      cells: { sku: "NEW-" + tag, name: "New Filter", sellPriceSen: 25, costPriceSen: 15, unit: "piece", minStock: 3 },
      action: "upsert",
    });

    const existing = await currentProducts();
    const { plans, summary } = planSheet({ def: PRODUCTS_SHEET, incoming: rows, existing });
    expect(summary).toMatchObject({ create: 1, update: 1, delete: 1, error: 0 });

    const res = await applyProductPlans({ organisationId: orgId, userId: "test-user", branchId: null, plans });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary).toMatchObject({ created: 1, updated: 1, deleted: 1 });

    const after = await currentProducts();
    expect(after.map((p) => p.sku).sort()).toEqual(["NEW-" + tag, "OIL-" + tag].sort());
    expect(after.find((p) => p.sku === "OIL-" + tag)!.sellPriceSen).toBe(3800);
    expect(after.find((p) => p.sku === "NEW-" + tag)!.name).toBe("New Filter");
  });

  it("有错的 sheet **一条都不写**（半对半错比不写更糟）", async () => {
    const { applyProductPlans } = await import("@/modules/bulk/apply");
    const before = await currentProducts();
    const res = await applyProductPlans({
      organisationId: orgId,
      userId: "test-user",
      branchId: null,
      plans: [
        { sheet: "products", rowNumber: 2, key: "OIL-" + tag, action: "update", values: { sellPriceSen: 9999 }, changes: [], errors: [] },
        { sheet: "products", rowNumber: 3, key: "BAD", action: "error", values: {}, changes: [], errors: ["Sell Price: not a number"] },
      ],
    });
    expect(res.ok).toBe(false);
    const after = await currentProducts();
    expect(after.find((p) => p.sku === "OIL-" + tag)!.sellPriceSen).toBe(before.find((p) => p.sku === "OIL-" + tag)!.sellPriceSen);
  });

  it("未知供应商 → 报错且不写（不悄悄建一条供应商）", async () => {
    const { applyProductPlans } = await import("@/modules/bulk/apply");
    const res = await applyProductPlans({
      organisationId: orgId,
      userId: "test-user",
      branchId: null,
      plans: [{
        sheet: "products", rowNumber: 2, key: "OIL-" + tag, action: "update",
        values: { supplierName: "No Such Supplier" }, changes: [], errors: [],
      }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Unknown supplier");
  });
});
