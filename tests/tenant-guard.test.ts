// P2 强制层：`scopedDb(orgId)` 的证明。
//
// 为什么需要这条测试：前面所有的隔离都靠"每个调用点记得写 organisationId"，
// 而这是一个**没人能保证**的性质（P2 审计实测：单测覆盖到的路径里就有 469 次没带的查询）。
// `scopedDb` 把这件事变成机制：绑定租户的 client 自动注入条件，写不出条件的操作直接拒绝。
//
// 断言的是**行为**而不是形状 —— 每一条都真的去动数据库，并且带对照组
// （别家的行确实存在，否则"查不到"可能只是"本来就没有"）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/tenant/guard";

const ORG_A = "test_guard_org_a";
const ORG_B = "test_guard_org_b";

let aId = "";
let bId = "";

async function cleanup() {
  await db.lead.deleteMany({ where: { organisationId: { in: [ORG_A, ORG_B] } } });
  await db.customer.deleteMany({ where: { organisationId: { in: [ORG_A, ORG_B] } } });
  await db.organisation.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
}

beforeAll(async () => {
  await cleanup();
  await db.organisation.create({ data: { id: ORG_A, name: "Guard A", slug: "guard-a" } });
  await db.organisation.create({ data: { id: ORG_B, name: "Guard B", slug: "guard-b" } });
  aId = (await db.customer.create({ data: { organisationId: ORG_A, name: "Guard cust A" } })).id;
  bId = (await db.customer.create({ data: { organisationId: ORG_B, name: "Guard cust B" } })).id;
});

afterAll(cleanup);

describe("scopedDb：读只看得见本租户", () => {
  it("findMany 不带 where 也只返回本租户（带对照组）", async () => {
    // 对照组：两个租户各有客户，且都在库里
    expect(await db.customer.count({ where: { organisationId: { in: [ORG_A, ORG_B] } } })).toBe(2);

    const scopedA = scopedDb(db as never, ORG_A);
    const rows = await scopedA.customer.findMany({ where: { id: { in: [aId, bId] } } });
    expect(rows.map((r) => r.id), "A 的 client 查 B 的行必须查不到").toEqual([aId]);
  });

  it("findFirst 按别家的 id 查 → null", async () => {
    const scopedA = scopedDb(db as never, ORG_A);
    expect(await scopedA.customer.findFirst({ where: { id: bId } })).toBeNull();
    expect(await scopedA.customer.findFirst({ where: { id: aId } })).not.toBeNull();
  });

  it("count 也只数本租户", async () => {
    const scopedA = scopedDb(db as never, ORG_A);
    expect(await scopedA.customer.count()).toBe(1);
  });
});

describe("scopedDb：写不会碰到别家", () => {
  it("updateMany 打别家的 id → 影响 0 行", async () => {
    const scopedA = scopedDb(db as never, ORG_A);
    const res = await scopedA.customer.updateMany({ where: { id: bId }, data: { name: "被改名了" } });
    expect(res.count).toBe(0);
    // 对照组：B 的行没被动过
    expect((await db.customer.findUnique({ where: { id: bId } }))?.name).toBe("Guard cust B");
  });

  it("deleteMany 打别家的 id → 删不掉", async () => {
    const scopedA = scopedDb(db as never, ORG_A);
    const res = await scopedA.customer.deleteMany({ where: { id: bId } });
    expect(res.count).toBe(0);
    expect(await db.customer.findUnique({ where: { id: bId } })).not.toBeNull();
  });

  it("create 自动补上租户值（漏写也不会造出逃出唯一约束的行）", async () => {
    const scopedA = scopedDb(db as never, ORG_A);
    // 这里**刻意绕过类型检查**：生成的 client 类型要求 data 里必须有 organisationId，
    // 而"调用方不用写、运行时由 scopedDb 注入"正是这个 client 存在的意义 ——
    // 类型表达不了这件事（TypeScript 看不到 $extends 的运行时改写）。
    // 所以用 as never 把它交给下面的断言来证明：注入真的发生了。
    // 返回值一并断言成有 id/organisationId 的形状：`as never` 会把泛型返回值也推成 never
    const created = (await scopedA.customer.create({ data: { name: "自动归属" } } as never)) as {
      id: string;
      organisationId: string;
    };
    expect(created.organisationId).toBe(ORG_A);
    await db.customer.delete({ where: { id: created.id } });
  });
});

describe("scopedDb：写不出租户条件的操作直接拒绝", () => {
  it("findUnique 抛错，且错误信息说清怎么改", () => {
    const scopedA = scopedDb(db as never, ORG_A);
    // findUnique 的 where 只接受唯一键 —— 结构上表达不了租户条件。
    // 直接拒绝而不是放行，因为放行就是 IDOR 的入口。
    return expect(scopedA.customer.findUnique({ where: { id: aId } })).rejects.toThrow(/findUnique 无法表达租户条件/);
  });

  it("空 organisationId 直接抛错（空值会让隔离静默失效）", () => {
    expect(() => scopedDb(db as never, "")).toThrow(/需要 organisationId/);
  });
});

describe("租户守卫的判定函数（审计模式复用同一套）", () => {
  it("复合唯一键里嵌了租户 → 合规（不是漏写）", async () => {
    const { whereHasTenant } = await import("@/lib/tenant/guard");
    expect(whereHasTenant({ organisationId_year: { organisationId: "o", year: 2026 } }, "organisationId")).toBe(true);
    expect(whereHasTenant({ organisationId_sku: { organisationId: "o", sku: "S" } }, "organisationId")).toBe(true);
  });

  it("AND / OR 里任意一层带租户 → 合规", async () => {
    const { whereHasTenant } = await import("@/lib/tenant/guard");
    expect(whereHasTenant({ AND: [{ status: "x" }, { organisationId: "o" }] }, "organisationId")).toBe(true);
    expect(whereHasTenant({ OR: [{ branch: { organisationId: "o" } }] }, "branch")).toBe(true);
  });

  it("裸 id / 只带 branchId → 判为未收窄", async () => {
    const { whereHasTenant } = await import("@/lib/tenant/guard");
    expect(whereHasTenant({ id: "x" }, "organisationId")).toBe(false);
    expect(whereHasTenant({ branchId: "b" }, "organisationId")).toBe(false);
    expect(whereHasTenant(undefined, "organisationId")).toBe(false);
  });

  it("共享/无租户模型不参与判定（否则会逼着调用方给它们编一个租户）", async () => {
    const { tenantKeyFor } = await import("@/lib/tenant/guard");
    expect(tenantKeyFor("OtpAttempt")).toBeNull();
    expect(tenantKeyFor("Occasion")).toBeNull();
    expect(tenantKeyFor("Customer")).toBe("organisationId");
    expect(tenantKeyFor("ServiceJobPart")).toBe("job");
  });
});
