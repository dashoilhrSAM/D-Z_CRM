// P3b 第 1 步的**回归测试**：在 B 店用 A 店客户的邮箱/手机注册，不得绑上 A 店那条记录。
//
// 为什么这条测试是这一步的验收核心（MULTI_TENANT_PLAN §P3b 隐患 ②）：
//   今天 `signUpRider` 的邮箱/手机匹配**没有租户条件**，它能安全完全是因为
//   `Customer.authId` 全局唯一兜住了。P3b 第 2 步要松掉那个唯一键，
//   一松，无租户条件的匹配就变成"在 B 店注册可以认领 A 店的客户档案"。
//   所以先加租户条件（本文件守的就是它），再松约束 —— 顺序不能反。
//
// 断言分两层：
//   ① **行为**：两家店各有同邮箱/同手机的客户档案时，按租户查询只回本店那一条；
//      只有 A 有、B 没有时，B 的查询必须回 null（旧代码在这里会回 A 那一条 → 红）。
//   ② **结构**：注册 action 里不许再出现"按名字排序找一家店"与无租户的邮箱直查，
//      跨租户的手机匹配函数只允许登录入口调用一处。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { customersByPhone, customerByEmailInTenant } from "@/lib/auth/phone-identity";

const ORG_A = "test_scope_org_a";
const ORG_B = "test_scope_org_b";
/** 两家店**共用**的号码与邮箱：这是"串店"最容易发生的形状。 */
const SHARED_PHONE = "012-345 6789";
const SHARED_EMAIL = "shared.scope@dzscope.test";
/** 只有 A 店有的邮箱：B 店用它注册时**必须**匹配不到（旧代码会匹配到 A 那条）。 */
const A_ONLY_EMAIL = "a-only.scope@dzscope.test";

let custA = "";
let custB = "";
let custAOnly = "";

async function cleanup() {
  await db.customer.deleteMany({ where: { organisationId: { in: [ORG_A, ORG_B] } } });
  await db.organisation.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
}

beforeAll(async () => {
  await cleanup();
  const tag = Date.now().toString(36);
  await db.organisation.create({ data: { id: ORG_A, name: "Scope A", slug: "scope-a-" + tag } });
  await db.organisation.create({ data: { id: ORG_B, name: "Scope B", slug: "scope-b-" + tag } });
  custA = (await db.customer.create({ data: { organisationId: ORG_A, name: "同一个人 @ A", phone: SHARED_PHONE, email: SHARED_EMAIL } })).id;
  custB = (await db.customer.create({ data: { organisationId: ORG_B, name: "同一个人 @ B", phone: SHARED_PHONE, email: SHARED_EMAIL } })).id;
  custAOnly = (await db.customer.create({ data: { organisationId: ORG_A, name: "只在 A 店", email: A_ONLY_EMAIL } })).id;
});

afterAll(cleanup);

describe("① 行为：租户内匹配", () => {
  it("对照组：两家店确实各有一条同号码、同邮箱的档案（否则下面的断言可能什么都没证明）", async () => {
    expect(custA).not.toBe(custB);
    const rows = await db.customer.findMany({
      where: { organisationId: { in: [ORG_A, ORG_B] }, email: SHARED_EMAIL },
      select: { id: true },
    });
    expect(rows.map((r) => r.id).sort()).toEqual([custA, custB].sort());
  });

  it("同号码在两家店：按租户查只回本店那一条（两种号码写法都要能对上）", async () => {
    for (const written of [SHARED_PHONE, "+60123456789"]) {
      const inA = await customersByPhone(ORG_A, written);
      const inB = await customersByPhone(ORG_B, written);
      expect(inA.map((c) => c.id), "A 店查询：" + written).toEqual([custA]);
      expect(inB.map((c) => c.id), "B 店查询：" + written).toEqual([custB]);
    }
    // 这条才是回归断言本身：**任何**租户的查询都不许把别家的档案带出来
    const inB = await customersByPhone(ORG_B, SHARED_PHONE);
    expect(inB.some((c) => c.id === custA)).toBe(false);
  });

  it("**只有 A 店有这条邮箱时，B 店查不到它** —— 隐患 ② 的核心场景", async () => {
    // 旧代码（`db.customer.findFirst({ where: { email } })`）在这里会回 A 那条 →
    // 于是"在 B 店注册"会把 authId 绑到 A 店的客户档案上。加了租户条件后必须为 null。
    expect(await customerByEmailInTenant(ORG_B, A_ONLY_EMAIL)).toBeNull();
    // 反向对照：同一份数据，A 店查得到（证明上一条的 null 是"隔离生效"而不是"数据不存在"）
    expect((await customerByEmailInTenant(ORG_A, A_ONLY_EMAIL))?.id).toBe(custAOnly);
  });

  it("同邮箱在两家店：各查各的，互不越界", async () => {
    expect((await customerByEmailInTenant(ORG_A, SHARED_EMAIL))?.id).toBe(custA);
    expect((await customerByEmailInTenant(ORG_B, SHARED_EMAIL))?.id).toBe(custB);
  });

  it("租户参数为空/邮箱为空时 fail-closed，不退回「跨店找一条」", async () => {
    expect(await customerByEmailInTenant("", SHARED_EMAIL)).toBeNull();
    expect(await customerByEmailInTenant(ORG_A, "")).toBeNull();
    expect(await customersByPhone("", SHARED_PHONE)).toEqual([]);
  });
});

describe("② 结构：注册路径不许再有「无租户的匹配」", () => {
  const root = process.cwd();
  const read = (p: string) => readFileSync(path.join(root, p), "utf8");
  /** 只看代码不看注释：注释里写着旧写法会让守卫误报（本项目踩过）。 */
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(path.join(root, dir))) {
      const rel = path.join(dir, entry);
      if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out);
      else if (/\.tsx?$/.test(entry)) out.push(rel);
    }
    return out;
  };

  it("注册 action 里没有「按名字排序找一家店」（隐患 ①）", () => {
    const src = stripComments(read("src/actions/auth-supabase.ts"));
    expect(src).not.toContain("organisation.findFirst");
    // 正向对照：租户确实是从入口解析来的（否则上一条可能只是"这段被删空了"）
    expect(src).toContain("resolveEntryTenant(");
  });

  it("注册 action 里没有无租户条件的邮箱直查（隐患 ②）", () => {
    const src = stripComments(read("src/actions/auth-supabase.ts"));
    expect(src).not.toContain("db.customer.findFirst");
    expect(src).toContain("customerByEmailInTenant(");
  });

  it("跨租户的手机匹配只允许登录入口调用，且只有一处", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      const src = stripComments(read(file));
      const calls = src.split("customersByPhoneAnyTenant(").length - 1;
      // 定义处 1 次（lib/auth/phone-identity.ts），调用处允许在 auth-supabase.ts
      const allowed = file === "src/lib/auth/phone-identity.ts" ? 1 : file === "src/actions/auth-supabase.ts" ? 1 : 0;
      if (calls > allowed) offenders.push(file + " ×" + calls);
    }
    expect(offenders, "这些文件在登录之外的路径上用了跨租户手机匹配").toEqual([]);
  });
});
