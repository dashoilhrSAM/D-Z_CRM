// P0b 的对齐护栏：**柜台在卖的每一项服务都必须能在 ServiceType 里找到**，
// 否则那一项就配不了佣金（佣金规则按 code 引用服务）。以及同步必须幂等 ——
// 目录同步一旦会造重复行，佣金配置就会指向"错误的那一行"，而且很难发现。
//
// 注意：这条测试会把 dev.db（或 DATABASE_URL 指向的库）**对齐到目标状态**。
// 这是有意的：同步本身幂等，且目标状态就是产品应有的状态。
import { beforeAll, describe, expect, it } from "vitest";
import { SERVICE_CATALOG } from "@/lib/service-catalog";

const saved = { databaseUrl: process.env.DATABASE_URL };
let db: typeof import("@/lib/db")["db"];
let syncServiceCatalogue: typeof import("@/lib/service-catalogue")["syncServiceCatalogue"];
let catalogueDrift: typeof import("@/lib/service-catalogue")["catalogueDrift"];

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  ({ db } = await import("@/lib/db"));
  ({ syncServiceCatalogue, catalogueDrift } = await import("@/lib/service-catalogue"));
});

describe("服务目录对齐（P0b）", () => {
  it("同步之后，柜台在卖的每一项服务都能在 ServiceType 里找到", async () => {
    await syncServiceCatalogue();
    expect(await catalogueDrift()).toEqual([]);
  });

  it("同步幂等：第二次不再造行、也不再改任何东西", async () => {
    const first = await syncServiceCatalogue();
    const second = await syncServiceCatalogue();
    expect(second.created, "第二次不该新建任何服务行").toBe(0);
    expect(second.coded).toBe(0);
    expect(second.priced).toBe(0);
    expect(second.total).toBe(first.total);
  });

  it("每一项源码目录服务都有 code 与价格（佣金规则要按 code 引用它）", async () => {
    const rows = await db.serviceType.findMany({ select: { code: true, priceSen: true } });
    const byCode = new Map(rows.map((r) => [r.code, r.priceSen]));
    for (const c of SERVICE_CATALOG) {
      expect(byCode.has(c.key), c.key + " 缺少 ServiceType 行 —— 这项服务会配不了佣金").toBe(true);
      expect(byCode.get(c.key) ?? null, c.key + " 没有价格").not.toBeNull();
    }
  });

  it("数据库独有的老服务也拿到了固定 code（决定：全部保留，不合并）", async () => {
    const legacy = ["GENERAL_SERVICE", "MAJOR_SERVICE", "BRAKE_SERVICE", "ELECTRICAL_CHECK", "FULL_INSPECTION", "ENGINE_TUNEUP"];
    const rows = await db.serviceType.findMany({ where: { code: { in: legacy } }, select: { code: true } });
    expect(rows.length, "老服务必须保留并拿到 code，否则历史工单里的旧名字就失去归因").toBe(legacy.length);
  });
});
