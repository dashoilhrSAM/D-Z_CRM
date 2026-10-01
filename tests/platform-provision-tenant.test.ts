// P4 · 开店（`provisionTenant`）—— 把"能隔离"变成"能开店"。
//
// 这个测试要证明的不是"函数能跑"，而是**开出来的店立刻是可用的**：
//   ① 四件东西同时成立：Organisation(slug) + 唯一 Branch + 店主 User + **AuthLink**
//      （少了 AuthLink，店主登录后会落到"没有业务身份"，而报错与真实原因无关）
//   ② 默认配置真的建了（服务目录/线索来源与阶段/消息模板/预约时段/库位）——
//      否则新店进去是空壳，每个新客户都得手工配一遍
//   ③ **开完就能走 P3b 的入口链**：`/t/<slug>` 认得这家店、店主点进去直接进得去
//      （这才是 P3b 与 P4 的接缝，也是最容易"看起来做完了其实没通"的地方）
//   ④ 失败不留半成品：slug 被占 / slug 非法 → 拒绝，且**库里不多出任何一行**
//
// Supabase 只打桩（建号/列表），其余全是真实数据库 —— 与 `tenant-shop-signup.test.ts` 同一套手法。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { authUsers } = vi.hoisted(() => ({ authUsers: [] as Array<{ id: string; email: string }> }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
let authSeq = 0;
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      admin: {
        createUser: async ({ email }: { email: string }) => {
          // 邮箱已存在 → 真实 Supabase 会报错；这里同样报错，让"复用"分支必须自己走到
          if (authUsers.some((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
            return { data: { user: null }, error: { message: "User already registered" } };
          }
          const id = "test-provision-auth-" + ++authSeq;
          authUsers.push({ id, email: String(email) });
          return { data: { user: { id } }, error: null };
        },
        updateUserById: async () => ({ data: {}, error: null }),
        listUsers: async () => ({ data: { users: [...authUsers] }, error: null }),
      },
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }),
}));

const { db } = await import("@/lib/db");
const { platformService, validateProvisionInput } = await import("@/modules/platform/service");
const { resolveEntryTenant } = await import("@/lib/tenant/entry-tenant");
const { planShopEntry } = await import("@/lib/tenant/entry-tenant");

const TAG = Date.now().toString(36);
const SLUG = "prov-" + TAG;
const SLUG2 = "prov2-" + TAG;
const OWNER = "owner." + TAG + "@provision.test";
const created: string[] = [];

async function dropIfAny(slug: string) {
  const org = await db.organisation.findUnique({ where: { slug }, select: { id: true } });
  if (org) await platformService["repo"].dropTenant(org.id);
}

beforeAll(async () => {
  await dropIfAny(SLUG);
  await dropIfAny(SLUG2);
});
afterAll(async () => {
  await dropIfAny(SLUG);
  await dropIfAny(SLUG2);
  await db.organisation.deleteMany({ where: { id: { in: created } } });
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
    created.push(res.organisationId);
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
    const tenant = await resolveEntryTenant({ slug: SLUG });
    expect(tenant.ok).toBe(true);
    expect(tenant.ok && tenant.source).toBe("slug");
  });

  it("**店主点自己的开通链接 → 直接进店**（不需要任何额外手工步骤）", async () => {
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
    const before = await db.organisation.count();
    const res = await platformService.provisionTenant({ name: "Dup", slug: SLUG, ownerEmail: "other." + TAG + "@provision.test" });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.code).toBe("SLUG_TAKEN");
    expect(await db.organisation.count()).toBe(before);
  });

  it("slug 非法 / 保留字 / 邮箱格式错 → 在校验阶段就被挡住（不碰 auth、不碰库）", () => {
    expect(validateProvisionInput({ name: "X", slug: "Bad Slug", ownerEmail: OWNER })?.code).toBe("INVALID_SLUG");
    expect(validateProvisionInput({ name: "X", slug: "a", ownerEmail: OWNER })?.code).toBe("INVALID_SLUG");
    expect(validateProvisionInput({ name: "X", slug: "platform", ownerEmail: OWNER })?.code).toBe("INVALID_SLUG");
    expect(validateProvisionInput({ name: "X", slug: "ok-slug", ownerEmail: "not-an-email" })?.code).toBe("INVALID_EMAIL");
    expect(validateProvisionInput({ name: "  ", slug: "ok-slug", ownerEmail: OWNER })?.code).toBe("INVALID_NAME");
    expect(validateProvisionInput({ name: "X", slug: "ok-slug", ownerEmail: OWNER })).toBeNull();
  });
});

describe("④ 同一个人可以同时属于多家店（复用手册里的多租户能力）", () => {
  it("用同一个邮箱开第二家店 → 复用 auth 账号 + 新增一条 AuthLink，不给他新密码", async () => {
    const first = await db.organisation.findUnique({ where: { slug: SLUG }, select: { id: true } });
    const firstOwner = await db.user.findFirst({ where: { organisationId: first!.id, role: "OWNER" }, select: { authId: true } });

    const res = await platformService.provisionTenant({ name: "Provision Test Shop 2", slug: SLUG2, ownerEmail: OWNER });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    created.push(res.organisationId);
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
  it("没有任何 \"use client\" 文件引用 providers/auth-admin", async () => {
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
