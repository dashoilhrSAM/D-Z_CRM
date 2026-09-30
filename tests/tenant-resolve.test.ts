// P3b 第 3 步：请求级身份解析链（`requestPersonRef`）。
//
// 要证明的是**顺序与边界**，不是"能查到人"：
//   ① 有签名 cookie → 只认那家店；
//   ② **cookie 指向的店里没有他 → 就是"没有身份"，绝不回退到别家店**
//      （把"你选的那家没有你"和"没选、系统替你猜一家"混为一谈，正是串店的入口）；
//   ③ 没有 cookie → 唯一所属（今天 authId 全局唯一，单店体验不变）；
//   ④ 同一个人两家店各一条身份时，cookie 指哪家就取哪家的那条**行**。
//
// 第 ④ 条今天在 User/Customer 上还做不到（两个 authId 列都还是全局唯一），
// 但 AuthLink 已经能表达它 —— 这也正是第 2 步要松开那两个键的理由。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { requestPersonRefFor, loadStaffForRef, loadCustomerForRef } from "@/lib/tenant/resolve";

const ORG_A = "test_resolve_org_a";
const ORG_B = "test_resolve_org_b";
const ORG_C = "test_resolve_org_c";
const AUTH_ID = "test-resolve-shared-auth";
const ORPHAN_AUTH = "test-resolve-orphan-auth";

let userA = "";
let custB = "";

const TENANT_A = { organisationId: ORG_A, slug: "resolve-a" };
const TENANT_B = { organisationId: ORG_B, slug: "resolve-b" };
const TENANT_C = { organisationId: ORG_C, slug: "resolve-c" };

async function cleanup() {
  await db.authLink.deleteMany({ where: { organisationId: { in: [ORG_A, ORG_B, ORG_C] } } });
  await db.customer.deleteMany({ where: { organisationId: { in: [ORG_A, ORG_B, ORG_C] } } });
  await db.user.deleteMany({ where: { organisationId: { in: [ORG_A, ORG_B, ORG_C] } } });
  await db.organisation.deleteMany({ where: { id: { in: [ORG_A, ORG_B, ORG_C] } } });
}

beforeAll(async () => {
  await cleanup();
  const tag = Date.now().toString(36);
  await db.organisation.create({ data: { id: ORG_A, name: "Resolve A", slug: "resolve-a-" + tag } });
  await db.organisation.create({ data: { id: ORG_B, name: "Resolve B", slug: "resolve-b-" + tag } });
  await db.organisation.create({ data: { id: ORG_C, name: "Resolve C", slug: "resolve-c-" + tag } });
  // 同一个人：A 店是员工、B 店是骑手（一个 auth 账号，两条业务身份）
  userA = (await db.user.create({ data: { organisationId: ORG_A, name: "Resolve Staff", email: "resolve." + tag + "@example.com", role: "MECHANIC", authId: AUTH_ID } })).id;
  custB = (await db.customer.create({ data: { organisationId: ORG_B, name: "Resolve Rider", authId: AUTH_ID } })).id;
  await db.authLink.create({ data: { authId: AUTH_ID, organisationId: ORG_A, kind: "STAFF", userId: userA } });
  await db.authLink.create({ data: { authId: AUTH_ID, organisationId: ORG_B, kind: "CUSTOMER", customerId: custB } });
});

afterAll(cleanup);

describe("① 没有指定门店 → 唯一所属（单店体验不变）", () => {
  it("无 cookie（tenant=null）→ source=unique", async () => {
    expect(await requestPersonRefFor(AUTH_ID, null)).toEqual({ source: "unique" });
  });

  it("authId 为空也不炸，走 unique", async () => {
    expect(await requestPersonRefFor("", TENANT_A)).toEqual({ source: "unique" });
  });

  it("unique 分支按 authId 取行（= 今天的行为）", async () => {
    const ref = await requestPersonRefFor(AUTH_ID, null);
    expect((await loadStaffForRef(ref, AUTH_ID))?.id).toBe(userA);
    expect((await loadCustomerForRef(ref, AUTH_ID))?.id).toBe(custB);
  });
});

describe("② 指定了门店 → 只认那一家", () => {
  it("cookie 指向 A 店 → 拿到 A 店那条员工行", async () => {
    const ref = await requestPersonRefFor(AUTH_ID, TENANT_A);
    expect(ref.source).toBe("tenant");
    expect((await loadStaffForRef(ref, AUTH_ID))?.id).toBe(userA);
    // kind 不匹配就叫没有 —— 不许"顺手"把他 B 店的骑手身份给出来
    expect(await loadCustomerForRef(ref, AUTH_ID)).toBeNull();
  });

  it("cookie 指向 B 店 → 拿到 B 店那条骑手行（同一 authId，两条身份各归各店）", async () => {
    const ref = await requestPersonRefFor(AUTH_ID, TENANT_B);
    expect((await loadCustomerForRef(ref, AUTH_ID))?.id).toBe(custB);
    expect(await loadStaffForRef(ref, AUTH_ID)).toBeNull();
  });

  it("**cookie 指向 C 店（他在那儿没有身份）→ identity=null，绝不回退到别家店**", async () => {
    const ref = await requestPersonRefFor(AUTH_ID, TENANT_C);
    expect(ref).toEqual({ source: "tenant", organisationId: ORG_C, identity: null });
    // 关键：两个取行函数都必须给 null —— 一旦这里能拿到 A/B 的行，就是串店
    expect(await loadStaffForRef(ref, AUTH_ID)).toBeNull();
    expect(await loadCustomerForRef(ref, AUTH_ID)).toBeNull();
  });

  it("认证了但完全没有业务身份 → 也是 identity=null（不是报错，也不是猜一家）", async () => {
    const ref = await requestPersonRefFor(ORPHAN_AUTH, TENANT_A);
    expect(ref).toEqual({ source: "tenant", organisationId: ORG_A, identity: null });
    expect((await requestPersonRefFor(ORPHAN_AUTH, null)).source).toBe("unique");
  });
});

describe("③ 结构：authId → 业务行 的解析只允许出现在解析链里", () => {
  // 五处 `findUnique({ where: { authId } })` 是 P3b 第 2 步"松唯一键"时会**编译失败**的地方。
  // 第 3 步把它们收进了 resolve.ts —— 之后再有人随手写一条，多店时就会绕过解析链
  // （cookie 选了 A 店，却按全局唯一键拿到 B 店那条），而且第 2 步会到处报错。
  const root = process.cwd();
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(path.join(root, dir))) {
      const rel = path.join(dir, entry);
      if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out);
      else if (/\.tsx?$/.test(entry)) out.push(rel);
    }
    return out;
  }

  /**
   * 允许存在的例外：问的都**不是**"本次请求该按哪条业务身份办事"。
   * 带上 `max` 是为了别把白名单变成"这个文件以后随便写" —— 多一处就红。
   */
  const ALLOWED: Record<string, { max: number; why: string }> = {
    "src/lib/auth/phone-identity.ts": { max: 1, why: "平台级手机身份检查（问的是号码挂在哪个 auth 账号上）" },
    "src/actions/auth-supabase.ts": { max: 1, why: "注册流程那一处：门店已由 resolveEntryTenant 显式定好，查询自带 organisationId" },
    "src/actions/workshop.ts": { max: 1, why: "重置骑手密码前的安全检查（问的是这个登录是否同时是员工账号，跨店正是要拦的）" },
  };

  it("护栏仍在：唯一所属的 `{ authId }` where 只有解析链里那两处", () => {
    const src = stripComments(readFileSync(path.join(root, "src/lib/tenant/resolve.ts"), "utf8"));
    // 这两处就是"松唯一键时会编译失败"的地方（Prisma 只允许对唯一字段用 where-unique）
    const guards = (src.match(/return \{ authId \};/g) ?? []).length;
    expect(guards, "resolve.ts 里的唯一所属护栏不见了 —— 第 2 步的编译期提醒会跟着消失").toBe(2);
  });

  it("其余地方按 authId 取业务行必须先过解析链（新文件要写就得进白名单并说明理由 + 数量上限）", () => {
    const offenders: string[] = [];
    let total = 0;
    for (const file of walk("src")) {
      const src = stripComments(readFileSync(path.join(root, file), "utf8"));
      const re = /db\.(?:user|customer)\.find(?:Unique|First)\(\{\s*where:\s*\{[^}]{0,90}authId/g;
      const n = (src.match(re) ?? []).length;
      if (n === 0) continue;
      total += n;
      const ok = ALLOWED[file];
      if (!ok) offenders.push(file + " ×" + n + "（本次请求的身份解析请走 lib/tenant/resolve.ts）");
      else if (n > ok.max) offenders.push(file + " ×" + n + " 超过了白名单上限 " + ok.max + "（" + ok.why + "）");
    }
    expect(total, "一处都没匹配到 —— 正则失效，守卫形同虚设").toBeGreaterThanOrEqual(1);
    expect(offenders).toEqual([]);
  });

  it("注册流程（门店已显式定好）按 authId 查档案时带上了租户", () => {
    const src = stripComments(readFileSync(path.join(root, "src/actions/auth-supabase.ts"), "utf8"));
    expect(src).toContain("findFirst({ where: { authId: user.id, organisationId } })");
  });
});
