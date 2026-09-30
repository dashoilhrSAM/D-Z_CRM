// P1a 验收：**租户内的唯一性**。
//
// 为什么有这条测试（2026-09-30 多租户审计）：
//   这几列原本是**全局唯一**，于是第二家 dealer 上线第一天就会撞：
//     · Motorcycle.plate      —— 同一台车不能被两家店服务（最硬的一条：真实世界必然发生）
//     · ServiceJob.jobNumber  —— 工单号串号，且能从号码读出别家的业务量
//     · Invoice.invoiceNumber —— 发票号无法按店分系列（税务/合规）
//     · User.email            —— 同一个人（兼职技师、跨店骑手）不能在两家店各有一个身份
//     · Product.sku / Lead.leadNumber 等同理
//
// 断言分两层，缺一不可：
//   ① **跨租户允许重复** —— 这正是本轮要打开的，没有它就等于没改；
//   ② **同租户内仍然拒绝** —— 放开全局唯一不能顺手把"店内的唯一性"也弄丢，
//      否则同店两台车挂同一个车牌、两张发票同号，比原来更糟。
//   只测 ① 会放过"把唯一约束整个删掉"的实现；只测 ② 会放过"其实没改"的实现。
//
// ⚠️ 复合唯一键在 SQLite / PostgreSQL 上**都不约束 organisationId 为 NULL 的行**。
//    所以每条断言都显式带上 organisationId，顺带钉住"写入方必须填这一列"这件事。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";

const ORG_A = "test_uniq_org_a";
const ORG_B = "test_uniq_org_b";
const SHARED_PLATE = "UNIQ 1234";
const SHARED_JOB = "DZUNIQ0001";
const SHARED_INV = "DZ-2099-00001";
const SHARED_SKU = "UNIQ-OIL-1";
const SHARED_EMAIL = "same.person@example.com";
const SHARED_LEAD = "LD-20990101-001";

async function plant(orgId: string, tag: string) {
  const branch = await db.branch.create({ data: { organisationId: orgId, name: "Uniq " + tag, city: "PJ" } });
  const customer = await db.customer.create({ data: { organisationId: orgId, branchId: branch.id, name: "Uniq cust " + tag } });
  await db.motorcycle.create({
    data: { organisationId: orgId, customerId: customer.id, brand: "Honda", model: "Wave", year: 2020, plate: SHARED_PLATE },
  });
  const bike = await db.motorcycle.findFirst({ where: { organisationId: orgId, plate: SHARED_PLATE } });
  await db.serviceJob.create({
    data: { organisationId: orgId, jobNumber: SHARED_JOB, branchId: branch.id, customerId: customer.id, motorcycleId: bike!.id, mileage: 1000 },
  });
  await db.invoice.create({
    data: { organisationId: orgId, invoiceNumber: SHARED_INV, branchId: branch.id, customerId: customer.id },
  });
  await db.product.create({ data: { organisationId: orgId, sku: SHARED_SKU, name: "Oil " + tag, sellPriceSen: 100, costPriceSen: 50 } });
  await db.user.create({ data: { organisationId: orgId, name: "Same Person " + tag, email: SHARED_EMAIL, role: "MECHANIC" } });
  await db.lead.create({ data: { organisationId: orgId, leadNumber: SHARED_LEAD, customerName: "Lead " + tag } });
  return { branch, customer, bike: bike! };
}

async function cleanup() {
  const orgs = [ORG_A, ORG_B];
  await db.invoice.deleteMany({ where: { organisationId: { in: orgs } } });
  await db.serviceJob.deleteMany({ where: { organisationId: { in: orgs } } });
  await db.motorcycle.deleteMany({ where: { organisationId: { in: orgs } } });
  await db.product.deleteMany({ where: { organisationId: { in: orgs } } });
  await db.lead.deleteMany({ where: { organisationId: { in: orgs } } });
  await db.user.deleteMany({ where: { organisationId: { in: orgs } } });
  await db.customer.deleteMany({ where: { organisationId: { in: orgs } } });
  await db.branch.deleteMany({ where: { organisationId: { in: orgs } } });
  await db.organisation.deleteMany({ where: { id: { in: orgs } } });
}

beforeAll(async () => {
  await cleanup();
  await db.organisation.create({ data: { id: ORG_A, name: "Uniq isolation A", slug: "uniq-a" } });
  await db.organisation.create({ data: { id: ORG_B, name: "Uniq isolation B", slug: "uniq-b" } });
  await plant(ORG_A, "A");
  await plant(ORG_B, "B");
});

afterAll(cleanup);

describe("P1a ① 跨租户：同一把钥匙可以各用一次", () => {
  it("同一个车牌可以在两家店各有一条（这是本轮要打开的核心场景）", async () => {
    expect(await db.motorcycle.count({ where: { plate: SHARED_PLATE } }), "对照组：两家店各一条").toBe(2);
    expect(await db.motorcycle.count({ where: { organisationId: ORG_A, plate: SHARED_PLATE } })).toBe(1);
    expect(await db.motorcycle.count({ where: { organisationId: ORG_B, plate: SHARED_PLATE } })).toBe(1);
  });

  it("同一个工单号、发票号、SKU、邮箱、线索号都可以各用一次", async () => {
    expect(await db.serviceJob.count({ where: { jobNumber: SHARED_JOB } })).toBe(2);
    expect(await db.invoice.count({ where: { invoiceNumber: SHARED_INV } })).toBe(2);
    expect(await db.product.count({ where: { sku: SHARED_SKU } })).toBe(2);
    expect(await db.user.count({ where: { email: SHARED_EMAIL } })).toBe(2);
    expect(await db.lead.count({ where: { leadNumber: SHARED_LEAD } })).toBe(2);
  });
});

describe("P1a ② 租户内：唯一性不能被顺手弄丢", () => {
  // 每条都断言"抛错"，因为放开全局唯一最容易犯的错就是把约束整个删掉。
  it("同一家店不能有两台车挂同一个车牌", async () => {
    const customer = await db.customer.findFirst({ where: { organisationId: ORG_A } });
    await expect(
      db.motorcycle.create({
        data: { organisationId: ORG_A, customerId: customer!.id, brand: "Yamaha", model: "LC", year: 2021, plate: SHARED_PLATE },
      }),
    ).rejects.toThrow();
  });

  it("同一家店不能有两张同号发票", async () => {
    const inv = await db.invoice.findFirst({ where: { organisationId: ORG_A } });
    await expect(
      db.invoice.create({
        data: { organisationId: ORG_A, invoiceNumber: SHARED_INV, branchId: inv!.branchId, customerId: inv!.customerId },
      }),
    ).rejects.toThrow();
  });

  it("同一家店不能有两个同 SKU 的产品", async () => {
    await expect(
      db.product.create({ data: { organisationId: ORG_A, sku: SHARED_SKU, name: "Dup", sellPriceSen: 1, costPriceSen: 1 } }),
    ).rejects.toThrow();
  });

  it("同一家店不能有两个同邮箱的账号", async () => {
    await expect(
      db.user.create({ data: { organisationId: ORG_A, name: "Dup", email: SHARED_EMAIL, role: "MECHANIC" } }),
    ).rejects.toThrow();
  });
});

describe("P1a ③ 组织运营句柄 slug", () => {
  it("slug 全局唯一（它是平台台路由、备份命名、日志的键）", async () => {
    await expect(db.organisation.create({ data: { id: "test_uniq_org_c", name: "Dup slug", slug: "uniq-a" } })).rejects.toThrow();
    await db.organisation.deleteMany({ where: { id: "test_uniq_org_c" } });
  });

  it("建组织时 slug 会被写上（平台台靠它指认租户）", async () => {
    // 注意**不能**断言"全库 slug 非空"：dev.db 是多个测试共用的，别的测试会建
    // 不带 slug 的组织（列当前可空，是合法的过渡态）。这里只钉住本测试建的那两个。
    // 真正的防线是静态守卫：src/ 下每个 organisation.create 都必须写 slug。
    for (const id of [ORG_A, ORG_B]) {
      const org = await db.organisation.findUnique({ where: { id }, select: { slug: true } });
      expect(org?.slug, id + " 缺 slug").toBeTruthy();
    }
  });
});
