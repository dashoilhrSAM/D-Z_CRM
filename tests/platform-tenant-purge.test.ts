// P4 第三块（三）：退租删除 —— 不可逆的动作，测法要跟"不可逆"匹配。
//
// 这里守四件事：
//   ① **删除计划不会漏表**：scope map 里每个属于租户的模型都必须在生成计划里，
//      且顺序是合法拓扑序（先子后父、Organisation 最后）。漏一张表 = 删到一半外键报错，
//      或者更糟 —— "看起来删成功了、其实留下一批孤儿行"。
//   ② **三道闸门**：先停用（两步走）、原样输入 slug、删除与复核同事务（残留即回滚）。
//   ③ 删完**真的干净**：拿 scope map 逐模型数一遍，全 0（不是"没报错"就算干净）。
//   ④ 墓碑：slug 永久占用（旧门店码/打印链接不能指向下一家店）+ 平台审计留痕。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AuthAdminPort } from "@/providers/auth-admin";

class FakeAuthAdmin implements AuthAdminPort {
  users: Array<{ id: string; email: string }> = [];
  seq = 0;
  async ensureUser({ email }: { email: string; password: string; name?: string }) {
    const want = email.trim().toLowerCase();
    const found = this.users.find((u) => u.email === want);
    if (found) return { authId: found.id, reused: true };
    const id = "test-purge-auth-" + ++this.seq;
    this.users.push({ id, email: want });
    return { authId: id, reused: false };
  }
  async findByEmail(email: string) {
    const want = email.trim().toLowerCase();
    const found = this.users.find((u) => u.email === want);
    return found ? { authId: found.id, email: found.email } : null;
  }
}

const { db } = await import("@/lib/db");
const { PlatformService } = await import("@/modules/platform/service");
const { PrismaPlatformRepository, resolvePurgeWhere } = await import("@/repositories/prisma/platform.repository");
const { TENANT_SCOPE } = await import("@/lib/tenant/scope-map");
const { PURGE_ORDER, PURGE_WHERE } = await import("@/modules/platform/purge-plan.generated");

const repo = new PrismaPlatformRepository();
const service = new PlatformService(repo, new FakeAuthAdmin());

const NS = "test-purge";
const SLUG = "purge-fixture";
const KEEP_SLUG = "purge-keep";
const EMAIL = "owner@purge.fixture.test";
const ACTOR = { authId: NS + "-actor", email: "ops@platform.test" };
let ORG = "";

async function cleanFixture() {
  for (const slug of [SLUG, KEEP_SLUG]) {
    const old = await db.organisation.findUnique({ where: { slug }, select: { id: true } });
    if (old) await repo.purgeTenantRows(old.id);
  }
  await db.tenantTombstone.deleteMany({ where: { slug: { in: [SLUG, KEEP_SLUG] } } });
  await db.platformAuditLog.deleteMany({ where: { actorAuthId: ACTOR.authId } });
}

beforeAll(async () => {
  await cleanFixture();
  const a = await service.provisionTenant({ name: "Purge Fixture Shop", slug: SLUG, ownerEmail: EMAIL });
  if (!a.ok) throw new Error("夹具开通失败：" + JSON.stringify(a));
  ORG = a.organisationId;
  const b = await service.provisionTenant({ name: "Keep Fixture Shop", slug: KEEP_SLUG, ownerEmail: "keep@purge.fixture.test" });
  if (!b.ok) throw new Error("对照夹具开通失败：" + JSON.stringify(b));
  // 造一点业务数据，让"删干净"这件事有东西可删
  const branch = await db.branch.findFirst({ where: { organisationId: ORG }, select: { id: true } });
  // 开通只建店主 User，不建客户（客户是骑手注册来的）—— 这里自己造一个，顺带让退租有"关系路径"的行可删
  const customer = await db.customer.create({ data: { organisationId: ORG, branchId: branch!.id, name: "Purge Rider" }, select: { id: true } });
  const bike = await db.motorcycle.create({ data: { organisationId: ORG, customerId: customer!.id, brand: "Honda", model: "Wave", year: 2020, plate: "PURGE1" } });
  const job = await db.serviceJob.create({ data: { organisationId: ORG, jobNumber: "PG-0001", branchId: branch!.id, customerId: customer!.id, motorcycleId: bike.id, mileage: 100 } });
  await db.serviceJobItem.create({ data: { jobId: job.id, description: "oil", quantity: 1, unitPriceSen: 100, lineTotalSen: 100 } });
  await db.invoice.create({ data: { organisationId: ORG, invoiceNumber: "PG-INV-1", branchId: branch!.id, customerId: customer!.id } });
  await db.notification.create({ data: { branchId: branch!.id, title: "t", body: "b" } }).catch(() => {});
});

afterAll(cleanFixture);

/** 用 scope map 把"这家店还剩多少行"逐模型数一遍（退役后应当全 0）。 */
async function countAll(orgId: string): Promise<Array<{ model: string; rows: number }>> {
  const client = db as unknown as Record<string, { count: (a: { where: unknown }) => Promise<number> }>;
  const out: Array<{ model: string; rows: number }> = [];
  for (const model of PURGE_ORDER as readonly string[]) {
    const rows = await client[model.charAt(0).toLowerCase() + model.slice(1)].count({ where: resolvePurgeWhere(PURGE_WHERE[model], orgId) });
    if (rows > 0) out.push({ model, rows });
  }
  return out;
}

describe("① 删除计划：从 scope map × schema 推导，不会漏表", () => {
  it("scope map 里每个属于租户的模型都在计划里（漏一个就红）", () => {
    const owned = Object.entries(TENANT_SCOPE)
      .filter(([, e]) => e.kind === "column" || e.kind === "relation")
      .map(([n]) => n);
    const planned = new Set<string>(PURGE_ORDER as readonly string[]);
    const missing = owned.filter((n) => !planned.has(n));
    expect(missing, "这些表属于租户却没进退租计划 —— 会留下孤儿行").toEqual([]);
    expect(planned.size, "计划规模明显不对").toBe(owned.length + 1); // +1 = Organisation
  });

  it("顺序是合法拓扑序（先子后父），且租户本身在最后", async () => {
    const idx = new Map((PURGE_ORDER as readonly string[]).map((n, i) => [n, i]));
    const { Prisma } = await import("@prisma/client");
    const models = Prisma.dmmf.datamodel.models;
    const bad: string[] = [];
    for (const m of models) {
      if (!idx.has(m.name)) continue;
      for (const f of m.fields) {
        if (f.kind !== "object" || !f.relationFromFields?.length) continue;
        if (!idx.has(f.type)) continue;
        if (idx.get(m.name)! >= idx.get(f.type)!) bad.push(`${m.name} 应在 ${f.type} 之前（外键 ${f.name}）`);
      }
    }
    expect(bad, "外键顺序不对，退租会半路报错").toEqual([]);
    expect(PURGE_ORDER[PURGE_ORDER.length - 1]).toBe("Organisation");
  });

  it("生成器是可复现的（同一份输入 → 同一份输出）", async () => {
    const before = readFileSync(path.join(process.cwd(), "src/modules/platform/purge-plan.generated.ts"), "utf8");
    const { execFileSync } = await import("node:child_process");
    execFileSync("pnpm", ["exec", "tsx", "scripts/gen-tenant-purge-plan.ts"], { cwd: process.cwd(), stdio: "pipe" });
    const after = readFileSync(path.join(process.cwd(), "src/modules/platform/purge-plan.generated.ts"), "utf8");
    expect(after, "生成结果不稳定（有随机/时间成分？）—— 那样 diff 就没意义了").toBe(before);
  });
});

describe("② 三道闸门：先停用、打字确认、残留即回滚", () => {
  it("还在营业（ACTIVE）→ 拒绝，且什么都没删", async () => {
    const res = await service.purgeTenant({ organisationId: ORG, actor: ACTOR, confirmSlug: SLUG });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("先停用");
    expect((await countAll(ORG)).length, "被拒绝的退租居然动了数据").toBeGreaterThan(0);
  });

  it("停用之后，确认字符串不对 → 拒绝", async () => {
    await service.setTenantStatus({ organisationId: ORG, status: "SUSPENDED", actor: ACTOR, reason: "要退租" });
    const res = await service.purgeTenant({ organisationId: ORG, actor: ACTOR, confirmSlug: "wrong-slug" });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("原样输入");
    expect((await countAll(ORG)).length).toBeGreaterThan(0);
  });

  it("预演能看清要删什么（逐表行数 + 总数）", async () => {
    const preview = await service.purgePreview(ORG);
    expect(preview).not.toBeNull();
    expect(preview!.total).toBeGreaterThan(0);
    expect(preview!.rows.some((r) => r.model === "ServiceJob")).toBe(true);
    expect(preview!.rows.some((r) => r.model === "Invoice")).toBe(true);
  });
});

describe("③ 真删：逐模型复核全 0，且不碰别家店", () => {
  it("退租成功，审计写 TENANT_PURGED 并留下墓碑", async () => {
    const res = await service.purgeTenant({ organisationId: ORG, actor: ACTOR, confirmSlug: SLUG });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.deleted).toBeGreaterThan(0);

    const left = await countAll(ORG);
    expect(left, "还有残留行（孤儿数据）").toEqual([]);

    const audit = await db.platformAuditLog.findFirst({ where: { targetOrganisationId: ORG, action: "TENANT_PURGED" } });
    expect(audit).not.toBeNull();
    expect(audit!.detail).toContain(SLUG);

    const stone = await db.tenantTombstone.findUnique({ where: { slug: SLUG } });
    expect(stone, "没有墓碑 → 这个 slug 会被下一个人重新开一家店").not.toBeNull();
    expect(stone!.name).toBe("Purge Fixture Shop");
    expect(JSON.parse(stone!.counts!).ServiceJob).toBeGreaterThanOrEqual(1);
  });

  it("**对照店没被动过**（退租不能误伤别家）", async () => {
    const keep = await db.organisation.findUnique({ where: { slug: KEEP_SLUG }, select: { id: true } });
    expect(keep).not.toBeNull();
    expect((await countAll(keep!.id)).length, "对照店被连带删了").toBeGreaterThan(0);
  });

  it("墓碑让 slug **永久不可再用**（旧门店码不能指向新店）", async () => {
    const res = await service.provisionTenant({ name: "Reuse Attempt", slug: SLUG, ownerEmail: "reuse@purge.fixture.test" });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("已退休");
  });

  it("重复退租 → 拒绝（不会二次删除或二次建墓碑）", async () => {
    const res = await service.purgeTenant({ organisationId: ORG, actor: ACTOR, confirmSlug: SLUG });
    expect(res.ok).toBe(false);
  });
});
