// 「清空业务数据」必须只清当前租户 —— 这是全项目唯一一个**不可逆**的批量删除。
//
// 为什么有这条测试（2026-09-30 多租户审计）：
//   src/actions/developer.ts 的 resetBusinessData 原实现对 40 张表循环 deleteMany({})，
//   **没有任何租户收窄**。生产现在只有 1 个 Organisation，所以界面上完全看不出来；
//   一旦有第二家门店，任何一家的 owner 点一下「清空业务数据」，
//   **所有租户的业务数据一起没**，而且审计行只记录了操作者自己的 orgId。
//
// 断言分两层，每层都能独立失败：
//   ① 结构：删除清单里**没有任何一项退化成空条件**，且每项都指向某个 organisationId。
//      （加一张表却忘了写作用域，会在这一层失败。）
//   ② 行为：真建两个租户各放一份数据，按 A 的作用域执行同一套删除循环，
//      A 的行必须没了，**B 的行必须一行不少**。
//      ②里带对照组（B 的行确实存在于库中），否则 toBe(0) 可能只是"本来就没有"。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { BUSINESS_DATA_DELETE_ORDER, accessorFor } from "@/lib/tenant/business-data-scope";

const ORG_A = "test_reset_org_a";
const ORG_B = "test_reset_org_b";

/** 两个租户各建一条，覆盖四条不同的收窄路径（直接 / branch / customer / job）。 */
async function plant(orgId: string, tag: string) {
  const branch = await db.branch.create({ data: { organisationId: orgId, name: "Reset " + tag, city: "PJ" } });
  const customer = await db.customer.create({ data: { organisationId: orgId, branchId: branch.id, name: "Reset cust " + tag } });
  const motorcycle = await db.motorcycle.create({
    data: { organisationId: orgId, customerId: customer.id, brand: "Honda", model: "Wave", year: 2020, plate: "RESET-" + tag },
  });
  const job = await db.serviceJob.create({
    data: { organisationId: orgId, branchId: branch.id, customerId: customer.id, motorcycleId: motorcycle.id, jobNumber: "DZRESET" + tag, mileage: 1000, status: "COMPLETED" },
  });
  const invoice = await db.invoice.create({
    data: { organisationId: orgId, branchId: branch.id, customerId: customer.id, jobId: job.id, invoiceNumber: "INVRESET" + tag, totalSen: 100 },
  });
  await db.invoiceItem.create({ data: { invoiceId: invoice.id, description: "item " + tag, quantity: 1, unitPriceSen: 100, lineTotalSen: 100 } });
  await db.serviceJobItem.create({ data: { jobId: job.id, description: "line " + tag, quantity: 1, unitPriceSen: 100, lineTotalSen: 100 } });
  await db.serviceReminder.create({
    data: { customerId: customer.id, motorcycleId: motorcycle.id, lastServiceMileage: 1000, intervalKm: 3000, nextServiceMileage: 4000 },
  });
  await db.notification.create({ data: { branchId: branch.id, title: "n " + tag, body: "b", type: "SYSTEM" } });
  return { branch, customer, motorcycle, job, invoice };
}

async function cleanup() {
  const orgs = [ORG_A, ORG_B];
  // 用生产同一套作用域清，保证清理本身也不会越界。
  const byOrg = async (model: string, run: (where: Record<string, unknown>) => Promise<unknown>) => {
    const entry = BUSINESS_DATA_DELETE_ORDER.find((t) => t.model === model);
    if (!entry) throw new Error("missing scope for " + model);
    for (const orgId of orgs) await run(entry.where(orgId));
  };
  // 逐表按依赖顺序删（直接用同一份清单，先子后父）。
  const deleter = db as unknown as Record<string, { deleteMany: (args: unknown) => Promise<{ count: number }> }>;
  for (const table of BUSINESS_DATA_DELETE_ORDER) {
    for (const orgId of orgs) {
      await deleter[accessorFor(table.model)].deleteMany({ where: table.where(orgId) });
    }
  }
  await db.branch.deleteMany({ where: { organisationId: { in: orgs } } });
  void byOrg;
  await db.organisation.deleteMany({ where: { id: { in: orgs } } });
}

beforeAll(async () => {
  await cleanup();
  await db.organisation.create({ data: { id: ORG_A, name: "Reset isolation A" } });
  await db.organisation.create({ data: { id: ORG_B, name: "Reset isolation B" } });
  await plant(ORG_A, "A");
  await plant(ORG_B, "B");
});

afterAll(cleanup);

describe("清空业务数据：作用域结构", () => {
  it("清单里没有任何一项是空条件（空 where = 删全表）", () => {
    for (const table of BUSINESS_DATA_DELETE_ORDER) {
      const where = table.where("SOME_ORG");
      expect(Object.keys(where).length, table.model + " 的 where 不能为空").toBeGreaterThan(0);
    }
  });

  it("每一项都把条件指向某个 organisationId（而不是分行名/用户名之类的裸值）", () => {
    for (const table of BUSINESS_DATA_DELETE_ORDER) {
      expect(JSON.stringify(table.where("SOME_ORG")), table.model + " 未按租户收窄").toContain("SOME_ORG");
    }
  });

  it("清单与原删除顺序一致（先子后父）", () => {
    const models = BUSINESS_DATA_DELETE_ORDER.map((t) => t.model);
    // 父表必须排在引用它的子表之后：ServiceJob 在 Invoice/ServiceJobItem 之后，Customer 最后。
    expect(models.indexOf("ServiceJob")).toBeGreaterThan(models.indexOf("ServiceJobItem"));
    expect(models.indexOf("Invoice")).toBeGreaterThan(models.indexOf("InvoiceItem"));
    expect(models.indexOf("Customer")).toBe(models.length - 1);
    expect(models.indexOf("Customer")).toBeGreaterThan(models.indexOf("Motorcycle"));
  });
});

describe("清空业务数据：真的只清当前租户", () => {
  it("按 A 的作用域删完，A 清了、B 一行不少（带对照组）", async () => {
    // 对照组：库里确实两家都有数据 —— 否则下面的 0 可能只是"本来就没有"。
    expect(await db.customer.count({ where: { organisationId: { in: [ORG_A, ORG_B] } } }), "对照组：两家各一条客户").toBe(2);
    expect(await db.motorcycle.count({ where: { customer: { organisationId: { in: [ORG_A, ORG_B] } } } }), "对照组：两家各一台车").toBe(2);
    expect(await db.serviceJob.count({ where: { branch: { organisationId: { in: [ORG_A, ORG_B] } } } }), "对照组：两家各一张工单").toBe(2);

    // 跑与 resetBusinessData 完全相同的那套循环，但只针对 A。
    const deleter = db as unknown as Record<string, { deleteMany: (args: unknown) => Promise<{ count: number }> }>;
    for (const table of BUSINESS_DATA_DELETE_ORDER) {
      await deleter[accessorFor(table.model)].deleteMany({ where: table.where(ORG_A) });
    }

    // A 的都没了
    expect(await db.customer.count({ where: { organisationId: ORG_A } })).toBe(0);
    expect(await db.motorcycle.count({ where: { customer: { organisationId: ORG_A } } })).toBe(0);
    expect(await db.serviceJob.count({ where: { branch: { organisationId: ORG_A } } })).toBe(0);
    expect(await db.invoice.count({ where: { branch: { organisationId: ORG_A } } })).toBe(0);
    expect(await db.invoiceItem.count({ where: { invoice: { branch: { organisationId: ORG_A } } } })).toBe(0);
    expect(await db.serviceJobItem.count({ where: { job: { branch: { organisationId: ORG_A } } } })).toBe(0);
    expect(await db.serviceReminder.count({ where: { customer: { organisationId: ORG_A } } })).toBe(0);
    expect(await db.notification.count({ where: { branch: { organisationId: ORG_A } } })).toBe(0);

    // B 的**一行都不能少** —— 这是这条测试存在的理由
    expect(await db.customer.count({ where: { organisationId: ORG_B } }), "B 的客户被误删").toBe(1);
    expect(await db.motorcycle.count({ where: { customer: { organisationId: ORG_B } } }), "B 的车辆被误删").toBe(1);
    expect(await db.serviceJob.count({ where: { branch: { organisationId: ORG_B } } }), "B 的工单被误删").toBe(1);
    expect(await db.invoice.count({ where: { branch: { organisationId: ORG_B } } }), "B 的发票被误删").toBe(1);
    expect(await db.invoiceItem.count({ where: { invoice: { branch: { organisationId: ORG_B } } } }), "B 的发票行被误删").toBe(1);
    expect(await db.serviceJobItem.count({ where: { job: { branch: { organisationId: ORG_B } } } }), "B 的工单行被误删").toBe(1);
    expect(await db.serviceReminder.count({ where: { customer: { organisationId: ORG_B } } }), "B 的提醒被误删").toBe(1);
    expect(await db.notification.count({ where: { branch: { organisationId: ORG_B } } }), "B 的通知被误删").toBe(1);
  });

  it("该按钮不再可能在全库范围删除（源码里不得再出现无参 deleteMany）", async () => {
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync("src/actions/developer.ts", "utf8");
    // 先剥掉注释再匹配：这个文件的文档注释里**故意**引用了旧写法 deleteMany({}) 做说明，
    // 不剥注释的话，注释本身会把这条断言弄红（第一次跑就是这样）。
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src, "resetBusinessData 里又出现了无参 deleteMany").not.toMatch(/deleteMany\(\s*\{\s*\}\s*\)/);
    expect(src, "出现了不带 where 的 deleteMany").not.toMatch(/deleteMany\(\s*\)/);
    // 正向断言：确实存在按租户收窄的删除调用（否则"没有无参调用"可能只是因为整个函数被删了）
    expect(src).toMatch(/deleteMany\(\{\s*where:/);
  });
});
