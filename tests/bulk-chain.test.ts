// 批量配置的**闭环**（P2）：导出 → 解析 → 差异 → 应用。
//
// 这个文件里最有价值的几条：
//  ① 「往返一致」：导出的文件原样再导入必须**零改动** —— 一次证明金额 RM↔sen、枚举大小写、
//     日期、表头定位、供应商名对得上。任何一处不一致，它都会红。
//  ② 组合键（套餐明细＝套餐名 + 项目名）：同名项目在不同套餐里必须互不干扰。
//  ③ 分店：文件里写着哪个分店，就只动那个分店的数据。
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const saved = { databaseUrl: process.env.DATABASE_URL };
const tag = "blk" + Date.now().toString(36);

let db: typeof import("@/lib/db")["db"];
let build: typeof import("@/modules/bulk/export")["buildSetupWorkbook"];
let parse: typeof import("@/modules/bulk/parse")["parseSetupWorkbook"];
let orgId = "";
let branchId = "";

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  ({ db } = await import("@/lib/db"));
  build = (await import("@/modules/bulk/export")).buildSetupWorkbook;
  parse = (await import("@/modules/bulk/parse")).parseSetupWorkbook;

  const org = await db.organisation.create({ data: { name: "BULK-" + tag } });
  orgId = org.id;
  const branch = await db.branch.create({ data: { organisationId: org.id, name: "Bulk Branch " + tag, city: "PJ" } });
  branchId = branch.id;
  const supplier = await db.supplier.create({ data: { organisationId: org.id, name: "Sup " + tag } });
  await db.product.createMany({
    data: [
      // 第一个零件**带供应商**：这条专门防"导出写了供应商名、现状里没有 → 每个零件都被误报成有改动"
      { organisationId: org.id, sku: "OIL-" + tag, name: "Oil 4T", category: "ENGINE_OIL", brand: "Motul", unit: "litre", sellPriceSen: 3500, costPriceSen: 2500, minStock: 5, safetyStock: 2, leadTimeDays: 3, supplierId: supplier.id },
      { organisationId: org.id, sku: "PLUG-" + tag, name: "Spark Plug", category: "ELECTRICAL", brand: "NGK", unit: "piece", sellPriceSen: 1200, costPriceSen: 700, minStock: 10 },
    ],
  });
  await db.servicePackage.create({
    data: {
      branchId, name: "Basic " + tag, tier: "GOOD", priceSen: 6000,
      // 夹具按**生产的形状**造：生产里有 kind=GIFT 的赠品行（写测试时没想到，
      // 结果生产往返时才炸出"未知取值"）—— 见 2026-09-23 的实测记录
      items: {
        create: [
          { name: "Oil change", kind: "SERVICE", defaultQty: 1, priceSen: 4000 },
          { name: "Free keychain", kind: "GIFT", defaultQty: 1, priceSen: 0 },
        ],
      },
    },
  });
  await db.campaign.create({
    // 生产里的促销起止时间**带时刻**（实测全 10:00:58Z）—— 夹具也必须带，
    // 否则"导出只写日期 → 传回来变成零点"这个假改动永远是绿的
    data: { branchId, name: "Raya " + tag, type: "PROMO", status: "ACTIVE", startDate: new Date("2026-10-01T10:00:58Z"), endDate: new Date("2026-10-31T10:00:58Z"), discountPercent: 10 },
  });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { organisationId: orgId } });
  await db.servicePackageItem.deleteMany({ where: { package: { branchId } } });
  await db.servicePackage.deleteMany({ where: { branchId } });
  await db.campaign.deleteMany({ where: { branchId } });
  await db.product.deleteMany({ where: { organisationId: orgId } });
  await db.supplier.deleteMany({ where: { organisationId: orgId } });
  await db.branch.delete({ where: { id: branchId } });
  await db.organisation.delete({ where: { id: orgId } });
});

async function currentProducts() {
  return db.product.findMany({
    where: { organisationId: orgId },
    include: { supplier: { select: { name: true } } },
  });
}

async function planFromFile() {
  const { planSheet } = await import("@/modules/bulk/diff");
  const { PRODUCTS_SHEET, PACKAGES_SHEET, PACKAGE_ITEMS_SHEET, CAMPAIGNS_SHEET } = await import("@/modules/bulk/sheets");

  const parsed = await parse(await build({ organisationId: orgId, branchId }));
  const products = (await currentProducts()).map((p) => ({ ...p, supplierName: p.supplier?.name ?? "" }));
  const packages = await db.servicePackage.findMany({ where: { branchId } });
  const items = await db.servicePackageItem.findMany({ where: { package: { branchId } }, include: { package: { select: { name: true } }, product: { select: { sku: true } } } });
  const campaigns = await db.campaign.findMany({ where: { branchId } });

  const existingBySheet: Record<string, Record<string, unknown>[]> = {
    products,
    packages: packages as unknown as Record<string, unknown>[],
    packageItems: items.map((i) => ({ packageName: i.package.name, itemName: i.name, kind: i.kind, productSku: i.product?.sku ?? "", defaultQty: i.defaultQty, priceSen: i.priceSen })),
    campaigns: campaigns as unknown as Record<string, unknown>[],
  };
  const defs: Record<string, typeof PRODUCTS_SHEET> = { products: PRODUCTS_SHEET, packages: PACKAGES_SHEET, packageItems: PACKAGE_ITEMS_SHEET, campaigns: CAMPAIGNS_SHEET };

  const out = new Map<string, ReturnType<typeof planSheet>>();
  for (const s of parsed.sheets) {
    if (!s.found) continue;
    out.set(s.key, planSheet({ def: defs[s.key], incoming: s.rows, existing: existingBySheet[s.key] ?? [] }));
  }
  return { parsed, plans: out };
}

describe("往返一致：导出的文件原样导入 = 零改动", () => {
  it("**四张 sheet 一条 update 都不该出现**（含带供应商的零件、日期、枚举、组合键）", async () => {
    const { parsed, plans } = await planFromFile();
    expect(parsed.branchId).toBe(branchId);
    expect(parsed.versionOk).toBe(true);

    for (const [sheet, res] of plans.entries()) {
      const changes = res.plans.filter((p) => p.action === "create" || p.action === "update" || p.action === "delete");
      expect([sheet, changes.map((c) => c.key + ":" + JSON.stringify(c.changes))]).toEqual([sheet, []]);
      expect(res.summary.error).toBe(0);
    }
    expect(plans.get("products")!.summary.skip).toBe(2);
    expect(plans.get("packageItems")!.summary.skip).toBe(2);
  });
});

describe("改一条、加一条、删一条", () => {
  it("只改过的进 update，新 SKU 进 create，带 delete 标记的才进 delete", async () => {
    const { planSheet } = await import("@/modules/bulk/diff");
    const { PRODUCTS_SHEET } = await import("@/modules/bulk/sheets");
    const { applyPlans } = await import("@/modules/bulk/apply");
    const { parsed } = await planFromFile();

    const sheet = parsed.sheets.find((s) => s.key === "products")!;
    const rows = sheet.rows.map((r) => ({ ...r, cells: { ...r.cells } }));
    const oil = rows.find((r) => String(r.cells.sku) === "OIL-" + tag)!;
    oil.cells.sellPriceSen = 38;
    rows.find((r) => String(r.cells.sku) === "PLUG-" + tag)!.action = "delete";
    rows.push({ rowNumber: 99, cells: { sku: "NEW-" + tag, name: "New Filter", sellPriceSen: 25, costPriceSen: 15, unit: "piece", minStock: 3 }, action: "upsert" });

    const existing = (await currentProducts()).map((p) => ({ ...p, supplierName: p.supplier?.name ?? "" }));
    const { plans, summary } = planSheet({ def: PRODUCTS_SHEET, incoming: rows, existing });
    expect(summary).toMatchObject({ create: 1, update: 1, delete: 1, error: 0 });

    const res = await applyPlans({ organisationId: orgId, branchId, userId: "test-user", sessionBranchId: null, plans });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.products).toMatchObject({ created: 1, updated: 1, deleted: 1 });

    const after = await currentProducts();
    expect(after.map((p) => p.sku).sort()).toEqual(["NEW-" + tag, "OIL-" + tag].sort());
    expect(after.find((p) => p.sku === "OIL-" + tag)!.sellPriceSen).toBe(3800);
  });

  it("有错的 sheet **一条都不写**（半对半错比不写更糟）", async () => {
    const { applyPlans } = await import("@/modules/bulk/apply");
    const before = await currentProducts();
    const res = await applyPlans({
      organisationId: orgId, branchId, userId: "test-user", sessionBranchId: null,
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
    const { applyPlans } = await import("@/modules/bulk/apply");
    const res = await applyPlans({
      organisationId: orgId, branchId, userId: "test-user", sessionBranchId: null,
      plans: [{ sheet: "products", rowNumber: 2, key: "OIL-" + tag, action: "update", values: { supplierName: "No Such Supplier" }, changes: [], errors: [] }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Unknown supplier");
  });
});

describe("套餐与促销（按分店 + 组合键）", () => {
  it("改套餐价格、明细数量，加一条促销 —— 都落在文件写的那个分店上", async () => {
    const { planSheet } = await import("@/modules/bulk/diff");
    const { PACKAGES_SHEET, PACKAGE_ITEMS_SHEET, CAMPAIGNS_SHEET } = await import("@/modules/bulk/sheets");
    const { applyPlans } = await import("@/modules/bulk/apply");
    const { parsed } = await planFromFile();

    const pkgs = parsed.sheets.find((s) => s.key === "packages")!;
    const pkgRows = pkgs.rows.map((r) => ({ ...r, cells: { ...r.cells, priceSen: 72 } }));

    const items = parsed.sheets.find((s) => s.key === "packageItems")!;
    const itemRows = items.rows.map((r) => ({ ...r, cells: { ...r.cells, defaultQty: 2 } }));

    const camps = parsed.sheets.find((s) => s.key === "campaigns")!;
    const campRows = [
      ...camps.rows.map((r) => ({ ...r, cells: { ...r.cells } })),
      { rowNumber: 50, cells: { name: "Year End " + tag, type: "PROMO", status: "SCHEDULED", startDate: "2026-12-01", endDate: "2026-12-31", discountPercent: 15 }, action: "upsert" as const },
    ];

    const existingPkgs = await db.servicePackage.findMany({ where: { branchId }, select: { name: true, tier: true, priceSen: true, description: true, isBestValue: true } });
    const existingItems = (await db.servicePackageItem.findMany({ where: { package: { branchId } }, include: { package: { select: { name: true } }, product: { select: { sku: true } } } }))
      .map((i) => ({ packageName: i.package.name, itemName: i.name, kind: i.kind, productSku: i.product?.sku ?? "", defaultQty: i.defaultQty, priceSen: i.priceSen }));
    const existingCamps = await db.campaign.findMany({ where: { branchId }, select: { name: true, type: true, status: true, startDate: true, endDate: true, discountPercent: true, pointsBonus: true, audience: true } });

    const plans = [
      ...planSheet({ def: PACKAGES_SHEET, incoming: pkgRows, existing: existingPkgs }).plans,
      ...planSheet({ def: PACKAGE_ITEMS_SHEET, incoming: itemRows, existing: existingItems }).plans,
      ...planSheet({ def: CAMPAIGNS_SHEET, incoming: campRows, existing: existingCamps }).plans,
    ];
    const res = await applyPlans({ organisationId: orgId, branchId, userId: "test-user", sessionBranchId: null, plans });
    // 失败时把真实错误带进断言 —— 只看到 "expected false to be true" 等于白跑一轮
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) return;

    const pkg = await db.servicePackage.findFirst({ where: { branchId, name: "Basic " + tag } });
    expect(pkg!.priceSen).toBe(7200);
    const item = await db.servicePackageItem.findFirst({ where: { packageId: pkg!.id } });
    expect(item!.defaultQty).toBe(2);
    const created = await db.campaign.findFirst({ where: { branchId, name: "Year End " + tag } });
    expect(created).not.toBeNull();
    expect(created!.discountPercent).toBe(15);
    // 日期按 UTC 零点存（本项目约定）
    expect(created!.startDate.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("**别的分店一点都不动**（文件里写着哪个分店，就只动那个分店）", async () => {
    const other = await db.branch.create({ data: { organisationId: orgId, name: "Other " + tag, city: "Klang" } });
    try {
      await db.servicePackage.create({ data: { branchId: other.id, name: "Basic " + tag, tier: "GOOD", priceSen: 9900 } });
      const mine = await db.servicePackage.findFirst({ where: { branchId, name: "Basic " + tag } });
      const theirs = await db.servicePackage.findFirst({ where: { branchId: other.id, name: "Basic " + tag } });
      expect(mine!.priceSen).toBe(7200);
      expect(theirs!.priceSen).toBe(9900); // 同名、不同分店，互不影响
    } finally {
      await db.servicePackage.deleteMany({ where: { branchId: other.id } });
      await db.branch.delete({ where: { id: other.id } });
    }
  });
});
