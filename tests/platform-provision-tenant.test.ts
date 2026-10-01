// P4 · 开店（`provisionTenant`）—— 把"能隔离"变成"能开店"。
//
// 这个测试要证明的不是"函数能跑"，而是**开出来的店立刻是可用的**：
//   ① 四件东西同时成立：Organisation(slug) + 唯一 Branch + 店主 User + **AuthLink**
//      （少了 AuthLink，店主登录后会落到"没有业务身份"，而报错与真实原因无关）
//   ② 默认配置真的建了（服务目录/线索来源与阶段/消息模板/预约时段/库位）——
//      否则新店进去是空壳，每个新客户都得手工配一遍
//   ③ **开完就能走 P3b 的入口链**：`/t/<slug>` 认得这家店、店主点进去直接进得去
//      （这才是 P3b 与 P4 的接缝，也是最容易"看起来做完了其实没通"的地方）
//   ④ 失败不留半成品：slug 被占 / slug 非法 / auth 挂了 → 拒绝，且**库里不多出任何一行**
//
// ⚠️ 这里**注入假的 AuthAdminPort**，不依赖 `NEXT_PUBLIC_SUPABASE_URL` 之类的环境变量。
// 第一版是 mock `@supabase/supabase-js` 的，于是**本地绿（有 .env）而 CI 红（没有 .env）**——
// 这正是"端口"存在的意义：测试与脚本都不必先具备生产凭据。
// provider 自己的建号/复用逻辑另有一组测试（见文件末尾），那组会显式 stub env。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthAdminPort } from "@/providers/auth-admin";

// `resolveEntryTenant` 会读签名 cookie（`next/headers`）——vitest 里没有请求上下文，
// 给它一个"没有 cookie"的桩（这也正好是"店主打自己的开通链接"的真实起点）。
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

/** 假的认证端口：有则复用、无则建 —— 与真实实现同语义，但不碰网络、不需要 env。 */
class FakeAuthAdmin implements AuthAdminPort {
  users: Array<{ id: string; email: string }> = [];
  seq = 0;
  async ensureUser({ email }: { email: string; password: string; name?: string }) {
    const found = this.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (found) return { authId: found.id, reused: true };
    const id = "test-provision-auth-" + ++this.seq;
    this.users.push({ id, email });
    return { authId: id, reused: false };
  }
}

const { db } = await import("@/lib/db");
const { PlatformService, validateProvisionInput } = await import("@/modules/platform/service");
const { PrismaPlatformRepository } = await import("@/repositories/prisma/platform.repository");

const repo = new PrismaPlatformRepository();
const fakeAuth = new FakeAuthAdmin();
const platformService = new PlatformService(repo, fakeAuth);

const TAG = Date.now().toString(36);
const SLUG = "prov-" + TAG;
const SLUG2 = "prov2-" + TAG;
const OWNER = "owner." + TAG + "@provision.test";

async function dropIfAny(slug: string) {
  const org = await db.organisation.findUnique({ where: { slug }, select: { id: true } });
  if (org) await repo.dropTenant(org.id);
}

beforeAll(async () => {
  await dropIfAny(SLUG);
  await dropIfAny(SLUG2);
});
afterAll(async () => {
  await dropIfAny(SLUG);
  await dropIfAny(SLUG2);
});

describe("① 开出来的店是完整的（四件东西同时成立 + 默认配置）", () => {
  it("开店成功，返回开通链接与门店码", async () => {
    const res = await platformService.provisionTenant({
      name: "Provision Test Shop",
      slug: SLUG,
      ownerEmail: OWNER,
      ownerName: "Test Owner",
      city: "Kuala Lumpur",
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.slug).toBe(SLUG);
    expect(res.status).toBe("ACTIVE");
    expect(res.entryUrl).toContain("/t/" + SLUG);
    expect(res.workshopQrUrl).toContain("/qr/workshop/");
    expect(res.tempPassword, "新建账号要给一次性临时密码").toBeTruthy();
    expect(res.reusedAuthAccount).toBe(false);
  });

  it("组织 + 唯一主店 + 店主 + **AuthLink** 都在", async () => {
    const org = await db.organisation.findUnique({ where: { slug: SLUG } });
    expect(org).not.toBeNull();
    const branches = await db.branch.findMany({ where: { organisationId: org!.id } });
    expect(branches).toHaveLength(1);
    expect(branches[0].isMain).toBe(true);
    const owner = await db.user.findFirst({ where: { organisationId: org!.id, role: "OWNER" } });
    expect(owner?.authId, "店主没有绑 authId → 登录不进来").toBeTruthy();
    const link = await db.authLink.findFirst({ where: { authId: owner!.authId!, organisationId: org!.id } });
    expect(link, "少了 AuthLink，店主登录后会落到'没有业务身份'").not.toBeNull();
    expect(link!.kind).toBe("STAFF");
  });

  it("默认配置真的建了（服务目录/线索来源与阶段/消息模板/预约时段/库位）", async () => {
    const org = await db.organisation.findUnique({ where: { slug: SLUG } });
    const id = org!.id;
    const branch = await db.branch.findFirst({ where: { organisationId: id } });
    expect(await db.serviceType.count({ where: { organisationId: id } })).toBeGreaterThanOrEqual(4);
    expect(await db.leadSource.count({ where: { organisationId: id } })).toBeGreaterThanOrEqual(5);
    expect(await db.leadStage.count({ where: { organisationId: id } })).toBeGreaterThanOrEqual(5);
    expect(await db.messageTemplate.count({ where: { organisationId: id } })).toBeGreaterThanOrEqual(3);
    expect(await db.appointmentSlot.count({ where: { branchId: branch!.id } })).toBeGreaterThanOrEqual(28);
    expect(await db.inventoryLocation.count({ where: { branchId: branch!.id } })).toBe(1);
  });
});

describe("② 开完就能走 P3b 的入口链（P3b × P4 的接缝）", () => {
  it("门店链接认得这家新店", async () => {
    const { resolveEntryTenant } = await import("@/lib/tenant/entry-tenant");
    const tenant = await resolveEntryTenant({ slug: SLUG });
    expect(tenant.ok).toBe(true);
    expect(tenant.ok && tenant.source).toBe("slug");
  });

  it("**店主点自己的开通链接 → 直接进店**（不需要任何额外手工步骤）", async () => {
    const { planShopEntry } = await import("@/lib/tenant/entry-tenant");
    const org = await db.organisation.findUnique({ where: { slug: SLUG }, select: { id: true } });
    const owner = await db.user.findFirst({ where: { organisationId: org!.id, role: "OWNER" }, select: { authId: true } });
    const plan = await planShopEntry(owner!.authId!, SLUG);
    expect(plan.kind, "开通完店主却进不去自己的店 —— 这条不通，'能开店'就是假的").toBe("enter");
    expect(plan.kind === "enter" && plan.organisationId).toBe(org!.id);
    expect(plan.kind === "enter" && plan.home).toBe("/workshop/dashboard");
  });
});

describe("③ 失败不留半成品", () => {
  it("slug 被占用 → 拒绝，且不新建任何组织", async () => {
    const res = await platformService.provisionTenant({ name: "Dup", slug: SLUG, ownerEmail: "other." + TAG + "@provision.test" });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.code).toBe("SLUG_TAKEN");
    // ⚠️ 断言必须**限定在自己的夹具范围内**：`db.organisation.count()` 是全表计数，
    // 而本地 `fileParallelism` 打开、别的测试文件同时在增删组织 —— 用全表数做断言
    // 会得到一个只在本地偶发红的测试（本项目已经踩过一模一样的坑）。
    expect(await db.organisation.count({ where: { name: "Dup" } }), "被拒绝的开通居然建出了组织").toBe(0);
    const kept = await db.organisation.findUnique({ where: { slug: SLUG }, select: { name: true } });
    expect(kept!.name, "被拒绝的开通改动了已有租户").toBe("Provision Test Shop");
  });

  it("slug 非法 / 保留字 / 邮箱格式错 → 在校验阶段就被挡住（不碰 auth、不碰库）", () => {
    expect(validateProvisionInput({ name: "X", slug: "Bad Slug", ownerEmail: OWNER })?.code).toBe("INVALID_SLUG");
    expect(validateProvisionInput({ name: "X", slug: "a", ownerEmail: OWNER })?.code).toBe("INVALID_SLUG");
    expect(validateProvisionInput({ name: "X", slug: "platform", ownerEmail: OWNER })?.code).toBe("INVALID_SLUG");
    expect(validateProvisionInput({ name: "X", slug: "ok-slug", ownerEmail: "not-an-email" })?.code).toBe("INVALID_EMAIL");
    expect(validateProvisionInput({ name: "  ", slug: "ok-slug", ownerEmail: OWNER })?.code).toBe("INVALID_NAME");
    expect(validateProvisionInput({ name: "X", slug: "ok-slug", ownerEmail: OWNER })).toBeNull();
  });

  it("认证服务不可用 → AUTH_UNAVAILABLE，且**库里不多出任何一行**", async () => {
    const slug = "authdown-" + TAG;
    const broken = new PlatformService(repo, {
      ensureUser: async () => {
        throw new Error("boom");
      },
    });
    const res = await broken.provisionTenant({ name: "AuthDown Shop", slug, ownerEmail: "x@y.z" });
    expect(res.ok === false && res.code).toBe("AUTH_UNAVAILABLE");
    // 同样按夹具范围断言（全表计数在并行下不稳定）
    expect(await db.organisation.count({ where: { slug } }), "auth 挂了却建出了半家店").toBe(0);
    expect(await db.user.count({ where: { email: "x@y.z" } })).toBe(0);
  });
});

describe("④ 同一个人可以同时属于多家店（复用手册里的多租户能力）", () => {
  it("用同一个邮箱开第二家店 → 复用 auth 账号 + 新增一条 AuthLink，不给他新密码", async () => {
    const first = await db.organisation.findUnique({ where: { slug: SLUG }, select: { id: true } });
    const firstOwner = await db.user.findFirst({ where: { organisationId: first!.id, role: "OWNER" }, select: { authId: true } });

    const res = await platformService.provisionTenant({ name: "Provision Test Shop 2", slug: SLUG2, ownerEmail: OWNER });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.reusedAuthAccount).toBe(true);
    expect(res.tempPassword, "复用老账号时不能发新密码（那会改掉他在别家店的密码）").toBeUndefined();

    const second = await db.organisation.findUnique({ where: { slug: SLUG2 }, select: { id: true } });
    const secondOwner = await db.user.findFirst({ where: { organisationId: second!.id, role: "OWNER" }, select: { authId: true } });
    expect(secondOwner!.authId, "两家店的店主应该是同一个 auth 账号").toBe(firstOwner!.authId);

    // 跨店 → 登录时会出现选择器（这是 P3b 的正常行为，不是错误）
    expect(res.warnings.join(" ")).toContain("选择器");

    // 两家店各有一条 AuthLink（这就是"这个人属于哪几家店"的唯一事实来源）
    const links = await db.authLink.findMany({ where: { authId: firstOwner!.authId! } });
    expect(links.map((l) => l.organisationId).sort()).toEqual([first!.id, second!.id].sort());
  });
});

describe("⑤ 开通脚本的护栏判据（纯函数，CLI 与这里共用同一份）", () => {
  it("本地 / 远端认得清 —— 判据必须是**目标主机**，不能只看 NODE_ENV", async () => {
    const { isLocalDatabaseTarget } = await import("@/modules/platform/target");
    // 本地：放行
    expect(isLocalDatabaseTarget("")).toBe(true);
    expect(isLocalDatabaseTarget("file:./dev.db")).toBe(true);
    expect(isLocalDatabaseTarget("postgresql://postgres:pw@localhost:5432/db")).toBe(true);
    expect(isLocalDatabaseTarget("postgresql://postgres:pw@127.0.0.1:5432/db")).toBe(true);
    // 远端：拒绝（本仓 .env 里放的就是这种串 —— 本地终端跑起来 NODE_ENV 仍是 development）
    expect(isLocalDatabaseTarget("postgresql://postgres:pw@db.abcdefg.supabase.co:5432/postgres")).toBe(false);
    expect(isLocalDatabaseTarget("postgresql://postgres:pw@10.0.0.5:5432/db")).toBe(false);
    expect(isLocalDatabaseTarget("看不懂的串")).toBe(false);
  });
});

describe("⑥ service role 的 provider 不能进客户端 bundle", () => {
  it('没有任何 "use client" 文件引用 providers/auth-admin', async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const root = process.cwd();
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(path.join(root, dir))) {
        const rel = path.join(dir, e);
        if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out);
        else if (/\.tsx?$/.test(e)) out.push(rel);
      }
      return out;
    };
    const files = walk("src");
    const clients = files.filter((f) => readFileSync(path.join(root, f), "utf8").startsWith('"use client"'));
    expect(clients.length, "一个 use client 文件都没扫到 —— 守卫形同虚设").toBeGreaterThan(20);
    const offenders = clients.filter((f) => /providers\/auth-admin/.test(readFileSync(path.join(root, f), "utf8")));
    expect(offenders, "service role 的模块被客户端引用了").toEqual([]);
  });
});

describe("⑦ SupabaseAuthAdmin：建号 / 复用 / 失败（provider 自己的逻辑）", () => {
  it("新建成功 → reused=false；邮箱已存在 → 找回并 reused=true；都不通 → 抛错；缺 env → 抛错", async () => {
    /** 每个分支都要重新 mock + resetModules：provider 内部是 `await import(...)`。 */
    const withClient = async (adminImpl: Record<string, unknown>) => {
      vi.resetModules();
      vi.doMock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { admin: adminImpl } }) }));
      const mod = await import("@/providers/auth-admin");
      return new mod.SupabaseAuthAdmin();
    };

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "stub-service-key");

    const created = await withClient({
      createUser: async () => ({ data: { user: { id: "auth-new" } }, error: null }),
      listUsers: async () => ({ data: { users: [] } }),
    });
    expect(await created.ensureUser({ email: "x@y.z", password: "pw" })).toEqual({ authId: "auth-new", reused: false });

    // 邮箱已注册 → 从列表里找回（大小写不敏感），**不改密码**
    const existing = await withClient({
      createUser: async () => ({ data: { user: null }, error: { message: "User already registered" } }),
      listUsers: async () => ({ data: { users: [{ id: "auth-existing", email: "X@Y.Z" }] } }),
    });
    expect(await existing.ensureUser({ email: "x@y.z", password: "pw" })).toEqual({ authId: "auth-existing", reused: true });

    // 两条路都不通 → 抛错（让上层返回 AUTH_UNAVAILABLE，而不是静默建半个店）
    const broken = await withClient({
      createUser: async () => ({ data: { user: null }, error: { message: "boom" } }),
      listUsers: async () => ({ data: { users: [] } }),
    });
    await expect(broken.ensureUser({ email: "x@y.z", password: "pw" })).rejects.toThrow(/boom|无法/);

    // 缺 env 也要抛 —— 配置问题不能被当成"建好了"。
    // ⚠️ 必须**显式置空**而不是 `unstubAllEnvs()`：本地有 .env，那个调用会把它恢复回来，
    // 于是这条例外在"有 .env"的机器上永远绿、在 CI 上才是真的（方向刚好反了）。
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.resetModules();
    vi.doUnmock("@supabase/supabase-js");
    const { SupabaseAuthAdmin: Fresh } = await import("@/providers/auth-admin");
    await expect(new Fresh().ensureUser({ email: "x@y.z", password: "pw" })).rejects.toThrow(/SUPABASE/);
    vi.unstubAllEnvs();
  });
});
