// P3b 第 2+3 步：请求级身份解析链（`requestPersonRef`）。
//
// 要证明的是**顺序与边界**，不是"能查到人"：
//   ① 恰好一条身份 → 唯一所属（单店体验不变）；
//   ② **多家店都有身份 → 必须让用户选，绝不静默挑一个**（第 4 步的选择器靠这条）；
//   ③ 指定了门店（签名 cookie）→ 只认那一家；那家没有他 → 就是"没有身份"，**不回退**；
//   ④ 取行函数在 choice/none 时必须给 null —— 一旦这里能拿到某一条，就是串店。
//
// ⚠️ 第 ② 条在第 2 步之前**不可能发生**（两个 authId 列都是全局唯一）。
// 现在 `User.authId` / `Customer.authId` 已是**租户内唯一**，所以同一个 authId
// 可以在两家店各有一条业务身份 —— 这正是"每个 workshop 独立、customer 不共用"的前提。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { requestPersonRefFor, loadStaffForRef, loadCustomerForRef } from "@/lib/tenant/resolve";

const ORG_A = "test_resolve_org_a";
const ORG_B = "test_resolve_org_b";
const ORG_C = "test_resolve_org_c";
/** 一个人两家店（A 店员工 + B 店骑手）—— 第 2 步之后才可能存在 */
const MULTI_AUTH = "test-resolve-multi-auth";
/** 只有一条身份 —— 第 ① 级"唯一所属" */
const SINGLE_AUTH = "test-resolve-single-auth";
const ORPHAN_AUTH = "test-resolve-orphan-auth";

let userA = "";
let userS = "";
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
  userA = (await db.user.create({ data: { organisationId: ORG_A, name: "Multi @ A", email: "multi.a." + tag + "@example.com", role: "MECHANIC", authId: MULTI_AUTH } })).id;
  userS = (await db.user.create({ data: { organisationId: ORG_A, name: "Single @ A", email: "single." + tag + "@example.com", role: "MECHANIC", authId: SINGLE_AUTH } })).id;
  custB = (await db.customer.create({ data: { organisationId: ORG_B, name: "Multi @ B", authId: MULTI_AUTH } })).id;
  await db.authLink.create({ data: { authId: MULTI_AUTH, organisationId: ORG_A, kind: "STAFF", userId: userA } });
  await db.authLink.create({ data: { authId: MULTI_AUTH, organisationId: ORG_B, kind: "CUSTOMER", customerId: custB } });
  await db.authLink.create({ data: { authId: SINGLE_AUTH, organisationId: ORG_A, kind: "STAFF", userId: userS } });
});

afterAll(cleanup);

describe("① 恰好一条身份 → 唯一所属（单店体验不变）", () => {
  it("无 cookie → source=unique，且 identity 就是那一条", async () => {
    const ref = await requestPersonRefFor(SINGLE_AUTH, null);
    expect(ref.source).toBe("unique");
    expect(ref.source === "unique" && ref.identity.organisationId).toBe(ORG_A);
  });

  it("取行拿到那一条", async () => {
    const ref = await requestPersonRefFor(SINGLE_AUTH, null);
    expect((await loadStaffForRef(ref))?.id).toBe(userS);
    expect(await loadCustomerForRef(ref)).toBeNull();
  });

  it("authId 为空 → none（不炸、也不猜）", async () => {
    expect(await requestPersonRefFor("", TENANT_A)).toEqual({ source: "none" });
  });
});

describe("② 多家店都有身份 → 必须让用户选", () => {
  it("无 cookie → source=choice，候选恰好两条（**不许静默挑一个**）", async () => {
    const ref = await requestPersonRefFor(MULTI_AUTH, null);
    expect(ref.source).toBe("choice");
    if (ref.source !== "choice") throw new Error("unreachable");
    expect(ref.candidates.map((c) => c.organisationId).sort()).toEqual([ORG_A, ORG_B].sort());
    expect(ref.candidates.map((c) => c.kind).sort()).toEqual(["CUSTOMER", "STAFF"]);
  });

  it("**choice 时两个取行函数都给 null** —— 静默挑一条就是串店", async () => {
    const ref = await requestPersonRefFor(MULTI_AUTH, null);
    expect(await loadStaffForRef(ref)).toBeNull();
    expect(await loadCustomerForRef(ref)).toBeNull();
  });
});

describe("③ 指定了门店 → 只认那一家", () => {
  it("cookie 指向 A 店 → A 店那条员工行；kind 不匹配的不给", async () => {
    const ref = await requestPersonRefFor(MULTI_AUTH, TENANT_A);
    expect(ref.source).toBe("tenant");
    expect((await loadStaffForRef(ref))?.id).toBe(userA);
    expect(await loadCustomerForRef(ref)).toBeNull();
  });

  it("cookie 指向 B 店 → B 店那条骑手行（同一 authId，两条身份各归各店）", async () => {
    const ref = await requestPersonRefFor(MULTI_AUTH, TENANT_B);
    expect((await loadCustomerForRef(ref))?.id).toBe(custB);
    expect(await loadStaffForRef(ref)).toBeNull();
  });

  it("**cookie 指向 C 店（他在那儿没有身份）→ identity=null，绝不回退到别家店**", async () => {
    const ref = await requestPersonRefFor(MULTI_AUTH, TENANT_C);
    expect(ref).toEqual({ source: "tenant", organisationId: ORG_C, identity: null });
    expect(await loadStaffForRef(ref)).toBeNull();
    expect(await loadCustomerForRef(ref)).toBeNull();
  });

  it("认证了但完全没有业务身份 → none / identity=null（不是报错，也不是猜一家）", async () => {
    expect(await requestPersonRefFor(ORPHAN_AUTH, TENANT_A)).toEqual({ source: "tenant", organisationId: ORG_A, identity: null });
    expect((await requestPersonRefFor(ORPHAN_AUTH, null)).source).toBe("none");
  });
});

describe("④ 结构：schema 与解析链的一致性", () => {
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

  it("**双 schema 都改了**：authId 是租户内唯一、不再是全局唯一（本项目最常踩的「只改一个 schema」）", () => {
    for (const file of ["prisma/schema.prisma", "prisma/schema.pg.prisma"]) {
      const src = readFileSync(path.join(root, file), "utf8");
      expect(src, file + " 的 authId 仍是全局唯一").not.toMatch(/authId\s+String\?\s+@unique/);
      expect(src, file + " 缺 @@unique([organisationId, authId])").toContain("@@unique([organisationId, authId])");
      expect(src, file + " 缺手机匹配索引").toContain("@@index([organisationId, phone])");
    }
  });

  it("有对应的迁移文件（改 schema 必须落到迁移上，否则本地库与 schema 会漂）", () => {
    const rel = "prisma/migrations/20260930234000_p3b_tenant_scoped_authid/migration.sql";
    expect(existsSync(path.join(root, rel)), "缺迁移文件 —— 本地库不会跟着变").toBe(true);
    const sql = readFileSync(path.join(root, rel), "utf8");
    expect(sql).toContain('CREATE UNIQUE INDEX "User_organisationId_authId_key"');
    expect(sql).toContain('DROP INDEX "User_authId_key"');
  });

  /** 允许存在的例外：问的都**不是**"本次请求该按哪条业务身份办事"。 */
  const ALLOWED: Record<string, { max: number; why: string }> = {
    "src/lib/auth/phone-identity.ts": { max: 1, why: "平台级手机身份检查（问的是号码挂在哪个 auth 账号上，已带租户）" },
    "src/actions/auth-supabase.ts": { max: 1, why: "注册流程那一处：门店已由 resolveEntryTenant 显式定好，查询自带 organisationId" },
    "src/actions/workshop.ts": { max: 1, why: "重置骑手密码前的安全检查（问的是这个登录是否同时是员工账号）" },
  };

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
});
