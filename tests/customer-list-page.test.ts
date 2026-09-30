// 客户列表页的**有界取数**回归测试（2026-09-30 压测之后新增）。
//
// 为什么有它：原来 listWith() 没有 where、没有 take —— 一次把整张客户表连同
// 车辆/工单/发票/提醒拉进内存再丢掉 99%。4202 个客户时单请求 323ms，四并发反而
// 掉到 1.23 req/s（每请求 CPU 放大 10 倍，GC 风暴），并拖慢同一实例上的所有人。
// 这种毛病**不报错**，只会让整站变慢，所以必须由测试盯着。
//
// 断言分两类，都能失败：
//   ① 行为：分页有界、搜索在分页之前、大小写不敏感（名称/手机/车牌三条分支都要走一遍）；
//   ② 结构：页面不许再出现无参的 listSummaries()（那正是全表扫描的入口）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const saved = { databaseUrl: process.env.DATABASE_URL };
const tag = "plp" + Date.now().toString(36);

let db: typeof import("@/lib/db")["db"];
let svc: InstanceType<typeof import("@/modules/customers/service")["CustomerService"]>;
let orgId = "";
const customerIds: string[] = [];
const motorcycleIds: string[] = [];

const N = 30;
const PAGE = 25;
const NAME = (i: number) => "PLP " + tag + " Customer " + String(i).padStart(2, "0");

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  ({ db } = await import("@/lib/db"));
  const { CustomerService } = await import("@/modules/customers/service");
  svc = new CustomerService();

  const org = await db.organisation.create({ data: { name: "PLP " + tag } });
  orgId = org.id;
  for (let i = 1; i <= N; i++) {
    const c = await db.customer.create({
      data: { organisationId: orgId, name: NAME(i), phone: "011" + String(i).padStart(8, "0") },
    });
    customerIds.push(c.id);
  }
  // 一台车：用来验证「按车牌搜索」走的是 EXISTS 那条分支，且大小写不敏感
  const bike = await db.motorcycle.create({
    data: { organisationId: orgId, customerId: customerIds[0], brand: "Honda", model: "Wave", year: 2020, plate: "PLP" + tag.toUpperCase() + "9" },
  });
  motorcycleIds.push(bike.id);
});

afterAll(async () => {
  // 夹具必须自足：先子表后父表，且清掉自己造的每一行（否则第二次跑就挂在外键上）
  if (motorcycleIds.length) await db.motorcycle.deleteMany({ where: { id: { in: motorcycleIds } } });
  if (customerIds.length) await db.customer.deleteMany({ where: { id: { in: customerIds } } });
  if (orgId) await db.organisation.delete({ where: { id: orgId } });
  process.env.DATABASE_URL = saved.databaseUrl;
});

describe("客户列表取数是有界的", () => {
  it("无搜索时也只返回一页（items.length 必须等于 min(pageSize, total)）", async () => {
    const p1 = await svc.listSummaries({ organisationId: orgId, page: 1, pageSize: PAGE });
    // 这条是关键：库里有 30 个夹具客户 + 演示数据，全部返回才是旧的坏行为
    expect(p1.total).toBeGreaterThan(PAGE);
    expect(p1.items.length).toBe(Math.min(PAGE, p1.total));
    expect(p1.totalPages).toBe(Math.ceil(p1.total / PAGE));
  });

  it("搜索命中数单独统计，且过滤发生在分页之前", async () => {
    const all = await svc.listSummaries({ organisationId: orgId, q: tag, page: 1, pageSize: PAGE });
    expect(all.total).toBe(N);
    expect(all.items.length).toBe(PAGE);
    expect(all.totalPages).toBe(2);

    const p2 = await svc.listSummaries({ organisationId: orgId, q: tag, page: 2, pageSize: PAGE });
    expect(p2.items.length).toBe(N - PAGE);

    // 两页不重叠（分页边界靠数据库的 name ASC，不能重复也不能漏）
    const ids1 = new Set(all.items.map((c) => c.id));
    expect(p2.items.some((c) => ids1.has(c.id))).toBe(false);

    // 第 30 个客户按名字排在第二页 —— 搜索它必须能直接命中（证明是过滤后再分页）
    const last = await svc.listSummaries({ organisationId: orgId, q: NAME(N).toLowerCase(), page: 1, pageSize: PAGE });
    expect(last.total).toBe(1);
    expect(last.items[0]?.name).toBe(NAME(N));
  });

  it("搜索大小写不敏感（名称 / 手机 / 车牌三条分支）", async () => {
    const byName = await svc.listSummaries({ organisationId: orgId, q: NAME(3).toLowerCase(), page: 1, pageSize: PAGE });
    expect(byName.total).toBe(1);
    expect(byName.items[0]?.name).toBe(NAME(3));

    const byPhone = await svc.listSummaries({ organisationId: orgId, q: "01100000004", page: 1, pageSize: PAGE });
    expect(byPhone.total).toBe(1);
    expect(byPhone.items[0]?.name).toBe(NAME(4));

    const byPlate = await svc.listSummaries({ organisationId: orgId, q: ("PLP" + tag.toUpperCase() + "9").toLowerCase(), page: 1, pageSize: PAGE });
    expect(byPlate.total).toBe(1);
    expect(byPlate.items[0]?.name).toBe(NAME(1));
  });

  it("**只看得到自己租户的客户**（P2：这一层原先完全不收窄）", async () => {
    // 另一个租户 + 一个同名客户：如果哪天有人把 organisationId 从 where 里拿掉，
    // 这个同名客户会出现在 A 的结果里 —— 断言立刻就红。
    const otherOrg = await db.organisation.create({ data: { name: "PLP-other " + tag } });
    const twin = await db.customer.create({ data: { organisationId: otherOrg.id, name: NAME(1) } });
    try {
      const mine = await svc.listSummaries({ organisationId: orgId, q: NAME(1), page: 1, pageSize: PAGE });
      expect(mine.total, "只应命中本租户那一个同名客户").toBe(1);
      expect(mine.items[0]?.id, "命中的必须是本租户的客户，不是别家的同名客户").toBe(customerIds[0]);

      // 对照组：那个同名客户确实存在于库里，否则上面的 toBe(1) 可能只是"根本没有第二个人"
      expect(await db.customer.count({ where: { name: NAME(1) } })).toBe(2);

      // 跨租户按 id 直查也拿不到（getById 已改成带租户的 findFirst）
      expect(await svc.getPassport(twin.id, orgId)).toBeNull();
      expect(await svc.getPassport(twin.id, otherOrg.id)).not.toBeNull();
    } finally {
      await db.customer.delete({ where: { id: twin.id } });
      await db.organisation.delete({ where: { id: otherOrg.id } });
    }
  });

  it("空搜索词按「不过滤」处理，不会退化成 LIKE '%%' 的全表读", async () => {
    const blank = await svc.listSummaries({ organisationId: orgId, q: "   ", page: 1, pageSize: PAGE });
    expect(blank.items.length).toBe(Math.min(PAGE, blank.total));
  });
});

describe("结构：全表扫描的入口不许回来", () => {
  it("页面不再无参调用 listSummaries（那正是全表读进来的写法）", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/workshop/customers/page.tsx"), "utf8");
    expect(src).not.toContain("listSummaries()");
    expect(src).toContain("listSummaries({");
  });

  it("结构：仓库的客户查询必须带 organisationId（P2 的租户收窄不许回退）", () => {
    const src = readFileSync(path.join(process.cwd(), "src/repositories/prisma/customers.repository.ts"), "utf8");
    // list / listWith / listPageWith 的 where、getById / getByPhone / search / count 的 where，
    // 以及原生 SQL 分支，都必须出现 organisationId
    const calls = src.match(/customer\.(findMany|findFirst|count)\(\{[^}]*\}/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const c of calls) {
      expect(c, "客户查询缺 organisationId：" + c.slice(0, 80)).toContain("organisationId");
    }
    expect(src, "原生 SQL 分支也要带租户").toMatch(/c\."organisationId" = \$\{organisationId\}/);
  });

  it("仓库的有界取数确实带 take（有界性写在查询里，不靠调用方自觉）", () => {
    const src = readFileSync(path.join(process.cwd(), "src/repositories/prisma/customers.repository.ts"), "utf8");
    const body = src.slice(src.indexOf("listPageWith"));
    expect(body).toMatch(/take/);
    expect(body).toMatch(/skip/);
    expect(body).toMatch(/LIMIT/);
  });
});
