// P3b 第 4 步最后一块：**注册流程的门店显式化**（`/t/<slug>/signup`）。
//
// 要证明的是隐患 ① 的正面解法：注册时"进哪家店"由**链接**决定，不由"平台恰好一家在营门店"
// 或字母序决定。两条断言：
//   ① 行为：带 `tenantSlug` 调 `signUpRider` → 新档案落在**链接那家店**；
//      而另一家店**同邮箱同手机**的老客户档案**一个字节都没被改**（跨店劫持的注册版本）。
//   ② 结构：注册路径的每个入口都必须把 slug 传下去（少一个就等于那条路仍靠兜底判断）。
//
// 为什么这个测试能跑：签了 Supabase 的桩之后，`signUpRider` 里真正吃 IO 的只剩数据库，
// 而**给了 slug 的租户解析是确定的**（不再依赖"唯一在营门店"这种受并发影响的判断）——
// 这正是"把租户做成显式参数"带来的可测性红利。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const TEST_AUTH_ID = "test-shop-signup-auth-user";

/** 记录 admin 端写过的 metadata（断言 app_metadata 真的被写了）。 */
const { writeCalls } = vi.hoisted(() => ({ writeCalls: [] as Array<{ id: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }> }));

// `active-tenant` 会读 cookie：vitest 里没有请求上下文，给它一个"没有 cookie"的桩
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
// Supabase 全打桩：admin 建号 / 写 claims，以及登录端 createClient
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      admin: {
        createUser: async () => ({ data: { user: { id: TEST_AUTH_ID } }, error: null }),
        updateUserById: async (id: string, attrs: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }) => {
          writeCalls.push({ id, app_metadata: attrs?.app_metadata, user_metadata: attrs?.user_metadata });
          return { data: { user: { id } }, error: null };
        },
        getUserById: async () => ({ data: { user: { id: TEST_AUTH_ID, email: "x@y.z" } }, error: null }),
      },
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: async () => ({ data: { user: { id: TEST_AUTH_ID } }, error: null }),
      getUser: async () => ({ data: { user: { id: TEST_AUTH_ID } }, error: null }),
    },
  }),
}));

const { db } = await import("@/lib/db");
const { signUpRider, injectBizClaims } = await import("@/actions/auth-supabase");

const ORG_A = "test_su_org_a";
const ORG_B = "test_su_org_b";
const SHARED_EMAIL = "shared.signup@dzsignup.test";
const SHARED_PHONE = "012-777 8899";

let slugA = "";
let slugB = "";
let custA = "";

async function cleanup() {
  // 这个 authId 是夹具独占的：按它清干净（不只是按 org）—— 否则哪次跑偏把映射写进了别家店，
  // 下面那条"AuthLink 只该有 B 店一条"的断言会一直红，而且看不出是谁留的。
  await db.authLink.deleteMany({ where: { authId: TEST_AUTH_ID } });
  await db.authLink.deleteMany({ where: { organisationId: { in: [ORG_A, ORG_B] } } });
  await db.customer.deleteMany({ where: { authId: TEST_AUTH_ID } });
  await db.customer.deleteMany({ where: { organisationId: { in: [ORG_A, ORG_B] } } });
  await db.organisation.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
}

beforeAll(async () => {
  await cleanup();
  const tag = Date.now().toString(36);
  slugA = "su-a-" + tag;
  slugB = "su-b-" + tag;
  await db.organisation.create({ data: { id: ORG_A, name: "Signup A", slug: slugA } });
  await db.organisation.create({ data: { id: ORG_B, name: "Signup B", slug: slugB } });
  // A 店先有一条**同邮箱同手机**的老客户档案（没有 authId）—— 它就是"被劫持"的诱饵
  custA = (await db.customer.create({ data: { organisationId: ORG_A, name: "A 店老客户", email: SHARED_EMAIL, phone: SHARED_PHONE } })).id;
});

afterAll(cleanup);

const signupAt = (slug?: string) =>
  signUpRider({ name: "新客户", phone: "7778899", countryCode: "+60", email: SHARED_EMAIL, password: "password123", tenantSlug: slug });

describe("① 带门店链接注册 → 落在链接那家店，且不碰别家店的档案", () => {
  it("注册成功，新档案在 B 店（slug 指定的那家）", async () => {
    const res = await signupAt(slugB);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const created = await db.customer.findFirst({ where: { organisationId: ORG_B, email: SHARED_EMAIL } });
    expect(created, "B 店应该出现新档案").not.toBeNull();
    expect(created!.authId).toBe(TEST_AUTH_ID);
  });

  it("**A 店那条同邮箱同手机的老客户档案没被动过**（注册版的跨店劫持回归）", async () => {
    const a = await db.customer.findUnique({ where: { id: custA } });
    expect(a!.authId, "A 店的档案被绑上了别人的登录").toBeNull();
    expect(a!.name).toBe("A 店老客户");
  });

  it("AuthLink 也落在 B 店（第 3 步解析链靠它）", async () => {
    const links = await db.authLink.findMany({ where: { authId: TEST_AUTH_ID } });
    expect(links.map((l) => l.organisationId)).toEqual([ORG_B]);
    expect(links[0].kind).toBe("CUSTOMER");
  });

  it("**claims 写进了 app_metadata**（P3b 第 6 步：user_metadata 用户自己就能改）", async () => {
    const mine = writeCalls.filter((c) => c.id === TEST_AUTH_ID);
    expect(mine.length, "注册/登录路径一次 claims 都没写").toBeGreaterThan(0);
    const created = await db.customer.findFirst({ where: { organisationId: ORG_B, email: SHARED_EMAIL } });
    // 每一条写入都必须带 app_metadata（过渡期同时写 user_metadata 是允许的）
    for (const call of mine) {
      expect(call.app_metadata, "只写了 user_metadata —— PostgREST 面会继续拒绝合法用户").toBeTruthy();
      expect(call.app_metadata!.orgId).toBe(ORG_B); // 门店来自链接，claims 也得是这家
    }
    expect(mine[mine.length - 1].app_metadata).toMatchObject({ orgId: ORG_B, role: "CUSTOMER", customerId: created!.id });
  });

  it("链接指向不存在的店 → 拒绝注册（不退回兜底判断）", async () => {
    const res = await signupAt("no-such-shop-" + Date.now().toString(36));
    expect(res.ok).toBe(false);
    expect(res.ok === false && /link/i.test(res.error)).toBe(true);
  });
});

describe("①b 登录路径也写 app_metadata（老账号靠这一次登录完成迁移）", () => {
  it("injectBizClaims → calls 里带着 app_metadata，且门店来自他的 AuthLink", async () => {
    writeCalls.length = 0;
    const res = await injectBizClaims(TEST_AUTH_ID);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const call = writeCalls.find((c) => c.id === TEST_AUTH_ID);
    expect(call, "injectBizClaims 一次 metadata 都没写").toBeTruthy();
    expect(call!.app_metadata).toMatchObject({ orgId: ORG_B, role: "CUSTOMER" });
  });
});

describe("② 结构：注册路径的每个入口都必须把 slug 传下去", () => {
  const root = process.cwd();
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const read = (p: string) => strip(readFileSync(path.join(root, p), "utf8"));

  it("action 里不再有「无 slug 的租户解析」", () => {
    const src = read("src/actions/auth-supabase.ts");
    const bare = src.match(/resolveEntryTenant\(\)/g) ?? [];
    expect(bare, "这些入口还在无 slug 地解析租户（注册就又回到'唯一在营门店'的兜底）").toEqual([]);
    const withSlug = src.match(/resolveEntryTenant\(\{ slug: input\.tenantSlug \}\)/g) ?? [];
    expect(withSlug.length, "四个注册入口都要带上 slug").toBeGreaterThanOrEqual(4);
  });

  it("注册表单把 slug 传给每一个 action（漏一个就等于那条路没有门店上下文）", () => {
    const src = read("src/components/rider/signup-form.tsx");
    const names = ["signUpRider", "requestRiderPhoneOtp", "verifyRiderPhoneOtp", "completeRiderPhoneSignup"];
    const found: string[] = [];
    for (const name of names) {
      const at = src.indexOf(name + "({");
      expect(at, "表单里找不到 " + name + " 的调用 —— 正则或写法变了").toBeGreaterThan(-1);
      // 取这个调用的实参（配对括号），里面必须有 tenantSlug
      let depth = 0;
      let end = at + name.length + 1;
      for (let i = end - 1; i < src.length; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }
      const args = src.slice(at, end);
      if (!args.includes("tenantSlug")) found.push(name);
    }
    expect(found, "这些 action 没有拿到门店 slug").toEqual([]);
  });

  it("门店注册页存在且把 slug 交给表单", () => {
    const src = read("src/app/t/[slug]/signup/page.tsx");
    expect(src).toContain("RiderSignupForm tenantSlug={slug}");
    // slug 不存在/停用时 notFound()，不静默渲染一个"没有门店"的注册页
    expect(src).toContain("notFound()");
  });
});
