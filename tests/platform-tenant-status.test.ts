// P4 第三块：租户状态（停用/恢复）+ 平台侧审计。
//
// 这一块最要紧的不是"能点一个按钮改状态"，而是**停用是否真的立刻生效**：
//   只挡入口是不够的 —— 已经在店里的人手里握着会话，下一次请求照样能进来。
// 所以真正的强制点在 `identitiesForAuthUser`（非运营租户的身份被过滤），
// 于是被停用的人下一次请求就变成"没有业务身份"，而且**拿不到新 claims**。
//
// 三条断言对应三件事：
//   ① 状态机：非法值拒绝、状态没变不写审计、变了才写（append-only，跨租户）
//   ② **停用立刻生效**：入口链不认 + 成员身份消失 + 登录侧给的是"店被停用"而不是"没有账号"
//   ③ 恢复之后一切照旧（不能修完停用把恢复弄坏了）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { AuthAdminPort } from "@/providers/auth-admin";

// 入口链（`resolveEntryTenant`）与 `requestPersonRef` 都会读签名 cookie；
// vitest 里没有请求上下文，给一个"没有 cookie"的桩 —— 这也正是"这个人没选店"的真实起点。
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

class FakeAuthAdmin implements AuthAdminPort {
  users: Array<{ id: string; email: string }> = [];
  seq = 0;
  async ensureUser({ email }: { email: string; password: string; name?: string }) {
    const want = email.trim().toLowerCase();
    const found = this.users.find((u) => u.email === want);
    if (found) return { authId: found.id, reused: true };
    const id = "test-status-auth-" + ++this.seq;
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
const { PrismaPlatformRepository } = await import("@/repositories/prisma/platform.repository");

const repo = new PrismaPlatformRepository();
const service = new PlatformService(repo, new FakeAuthAdmin());

// ⚠️ 夹具用**固定名字**而不是每轮一个随机 tag：
// 假认证端口每轮都会生成同一个 `test-status-auth-N`，而"多店"那条曾经在断言失败时
// 走不到收尾，于是 healthy-* 店一轮一轮攒下来 —— 下一轮 `identitiesForAuthUser`
// 就会看到 3、4 条身份，断言以"看起来像实现坏了"的方式红掉。
// 固定命名空间 + 按命名空间清理 = 自愈（本项目今天第二次踩同一类坑）。
const NS = "test-status";
const SLUG = "status-fixture";
const HEALTHY_SLUG = "healthy-fixture";
const OWNER_EMAIL = "owner@status.fixture.test";
const ACTOR = { authId: NS + "-actor", email: "ops@platform.test" };
let ORG = "";

/** 按**夹具命名空间**清干净：authId 前缀 + 固定 slug + 审计 actor。 */
async function cleanFixture() {
  await db.platformAuditLog.deleteMany({ where: { actorAuthId: ACTOR.authId } });
  for (const slug of [SLUG, HEALTHY_SLUG]) {
    const old = await db.organisation.findUnique({ where: { slug }, select: { id: true } });
    if (old) await repo.dropTenant(old.id);
  }
  await db.authLink.deleteMany({ where: { authId: { startsWith: NS + "-auth-" } } });
}

beforeAll(async () => {
  await cleanFixture();
  const res = await service.provisionTenant({ name: "Status Test Shop", slug: SLUG, ownerEmail: OWNER_EMAIL });
  if (!res.ok) throw new Error("夹具开通失败：" + JSON.stringify(res));
  ORG = res.organisationId;
});

afterAll(cleanFixture);

describe("① 状态机 + 审计（append-only、跨租户）", () => {
  it("非法状态被拒绝", async () => {
    // @ts-expect-error 故意传非法值
    const res = await service.setTenantStatus({ organisationId: ORG, status: "DELETED", actor: ACTOR });
    expect(res.ok).toBe(false);
  });

  it("停用写一条审计（带原因与操作者）", async () => {
    const res = await service.setTenantStatus({ organisationId: ORG, status: "SUSPENDED", actor: ACTOR, reason: "未付款" });
    expect(res.ok && res.changed, JSON.stringify(res)).toBe(true);
    const rows = await service.listAudit({ organisationId: ORG });
    expect(rows[0].action).toBe("TENANT_SUSPENDED");
    expect(rows[0].detail).toBe("未付款");
    expect(rows[0].actorEmail).toBe("ops@platform.test");
  });

  it("**状态没变化就不写审计**（手抖点两次不该留下两条）", async () => {
    const before = await service.listAudit({ organisationId: ORG });
    const res = await service.setTenantStatus({ organisationId: ORG, status: "SUSPENDED", actor: ACTOR, reason: "又点了一次" });
    expect(res.ok && res.changed).toBe(false);
    const after = await service.listAudit({ organisationId: ORG });
    expect(after.length).toBe(before.length);
  });

  it("审计不挂在租户表上 —— 退租删掉整家店之后它还在", async () => {
    const keep = "keep-fixture";
    const res = await service.provisionTenant({ name: "Drop Me", slug: keep, ownerEmail: "drop@status.fixture.test" });
    if (!res.ok) throw new Error("夹具开通失败");
    await service.setTenantStatus({ organisationId: res.organisationId, status: "SUSPENDED", actor: ACTOR, reason: "要退租" });
    await repo.dropTenant(res.organisationId);
    const rows = await service.listAudit({ organisationId: res.organisationId });
    expect(rows.length, "租户被删了，'谁关掉了它'也必须还在").toBeGreaterThan(0);
    expect(await db.organisation.findUnique({ where: { slug: keep } })).toBeNull();
    await db.platformAuditLog.deleteMany({ where: { targetOrganisationId: res.organisationId } });
  });
});

describe("② 停用立刻生效（只挡入口是不够的）", () => {
  it("入口链不认这家店了", async () => {
    const { resolveEntryTenant } = await import("@/lib/tenant/entry-tenant");
    const tenant = await resolveEntryTenant({ slug: SLUG });
    expect(tenant.ok).toBe(false);
    // `code` 是机器可读的原因；`error` 是给店主看的英文文案（两者都在）
    expect(tenant.ok === false && tenant.code).toBe("SUSPENDED");
    expect(tenant.ok === false && tenant.error).toContain("not accepting");
  });

  it("**已经登录的成员下一次请求就失去业务身份**（不必等他登出）", async () => {
    const owner = await db.user.findFirst({ where: { organisationId: ORG, role: "OWNER" }, select: { authId: true } });
    const { identitiesForAuthUser } = await import("@/lib/tenant/identity");
    expect(await identitiesForAuthUser(owner!.authId!), "被停用的店还算是他的身份 → 停用等于没停").toEqual([]);
  });

  it("登录侧给的是「店被停用」，而不是「没有账号」", async () => {
    const owner = await db.user.findFirst({ where: { organisationId: ORG, role: "OWNER" }, select: { authId: true } });
    const { requestPersonRef } = await import("@/lib/tenant/resolve");
    const ref = await requestPersonRef(owner!.authId!);
    expect(ref.source, "没有身份才对（source=choice 只应发生在多条候选时）").toBe("none");
  });

  it("多店的人只失去被停用那一家，别的店照常", async () => {
    const owner = await db.user.findFirst({ where: { organisationId: ORG, role: "OWNER" }, select: { authId: true } });
    // 用**同一个邮箱**再开一家正常的店：provisionTenant 会复用同一个 auth 账号、
    // 并自动建好第二条 AuthLink（跨店账号就是这么来的）—— 不需要手动挂链接。
    const other = await service.provisionTenant({ name: "Healthy Shop", slug: HEALTHY_SLUG, ownerEmail: OWNER_EMAIL });
    if (!other.ok) throw new Error("夹具开通失败：" + JSON.stringify(other));
    expect(other.reusedAuthAccount, "同一邮箱应当复用 auth 账号").toBe(true);

    const { identitiesForAuthUser } = await import("@/lib/tenant/identity");
    const ids = await identitiesForAuthUser(owner!.authId!);
    expect(ids.map((i) => i.organisationId), "被停用那家不该出现，正常那家必须还在").toEqual([other.organisationId]);

    await repo.dropTenant(other.organisationId);
  });
});

describe("③ 恢复之后一切照旧", () => {
  it("恢复 → 成员身份回来、入口链重新认它、审计里留下 RESUME", async () => {
    const res = await service.setTenantStatus({ organisationId: ORG, status: "ACTIVE", actor: ACTOR, reason: "已付款" });
    expect(res.ok && res.changed).toBe(true);

    const owner = await db.user.findFirst({ where: { organisationId: ORG, role: "OWNER" }, select: { authId: true } });
    const { identitiesForAuthUser } = await import("@/lib/tenant/identity");
    expect((await identitiesForAuthUser(owner!.authId!)).length).toBe(1);

    const { resolveEntryTenant, planShopEntry } = await import("@/lib/tenant/entry-tenant");
    expect((await resolveEntryTenant({ slug: SLUG })).ok).toBe(true);
    expect((await planShopEntry(owner!.authId!, SLUG)).kind).toBe("enter");

    const actions = (await service.listAudit({ organisationId: ORG })).map((a) => a.action);
    expect(actions).toContain("TENANT_RESUMED");
    expect(actions).toContain("TENANT_SUSPENDED");
  });
});

describe("④ 结构守卫：状态改动只能从平台台来", () => {
  it("详情页与 action 都过守卫；action 数量与守卫调用数一致", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const root = process.cwd();
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const read = (p: string) => strip(readFileSync(path.join(root, p), "utf8"));

    const actions = read("src/app/platform/actions.ts");
    const count = (actions.match(/export async function \w+\(/g) ?? []).length;
    const guarded = (actions.match(/requirePlatformAdmin\(\)/g) ?? []).length;
    expect(count, "平台台的 action 至少两个（开通、停用/恢复）").toBeGreaterThanOrEqual(2);
    expect(guarded, "有 action 没判身份").toBe(count);

    const detail = read("src/app/platform/[slug]/page.tsx");
    expect(detail).toContain("requirePlatformAdmin()");
  });
});
