// P3a：身份映射（AuthLink）——"customer 不共用"能不能成立，就看这张表。
//
// 要证明的核心一件事：**同一个 auth 账号可以在两家店各有一个业务身份**。
// 这在今天用 Customer.authId 是表达不出来的（它是全局唯一），而 AuthLink 让它成立：
//   一个自然人 = 一个 Supabase auth 账号
//   他在 N 家店   = N 条 AuthLink + N 个业务主体
// 两家店的客户档案互不可见 —— 跨店共享的是登录凭证，不是客户数据。
//
// 断言分三层：
//   ① 已知门店时解析到**本店**那一个（不是"随便是哪一个"）；
//   ② 不知道门店时**列出来**，并且明确"需要选择"（绝不静默挑第一个）；
//   ③ 别家门店查不到（不泄漏"这个人在别家有没有账号"）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { identityInTenant, identitiesForAuthUser, needsTenantChoice, linkIdentity } from "@/lib/tenant/identity";

const ORG_A = "test_id_org_a";
const ORG_B = "test_id_org_b";
const ORG_C = "test_id_org_c";
const AUTH_ID = "test-auth-user-shared";
const STAFF_AUTH = "test-auth-user-staff";

let custA = "";
let custB = "";
let staffId = "";

async function cleanup() {
  await db.authLink.deleteMany({ where: { organisationId: { in: [ORG_A, ORG_B, ORG_C] } } });
  await db.customer.deleteMany({ where: { organisationId: { in: [ORG_A, ORG_B] } } });
  await db.user.deleteMany({ where: { organisationId: { in: [ORG_C] } } });
  await db.organisation.deleteMany({ where: { id: { in: [ORG_A, ORG_B, ORG_C] } } });
}

beforeAll(async () => {
  await cleanup();
  for (const [id, name] of [[ORG_A, "Id A"], [ORG_B, "Id B"], [ORG_C, "Id C"]] as const) {
    await db.organisation.create({ data: { id, name, slug: "id-" + id.slice(-1) + "-" + Date.now().toString(36) } });
  }
  // 两家店各有一个客户档案。注意它们的 authId 都是 null ——
  // 因为旧列还是全局唯一，同一个 authId 现在挂不到两个 Customer 上。
  // 映射表在今天就解决了这件事，也正是 P3b 会去松开那两个唯一键的理由。
  custA = (await db.customer.create({ data: { organisationId: ORG_A, name: "Shared person @ A" } })).id;
  custB = (await db.customer.create({ data: { organisationId: ORG_B, name: "Shared person @ B" } })).id;
  staffId = (await db.user.create({ data: { organisationId: ORG_C, name: "Staff C", email: "staff.c." + Date.now() + "@example.com", role: "MECHANIC" } })).id;
});

afterAll(cleanup);

describe("P3a ① 同一个 auth 账号，两家店各一个客户身份", () => {
  it("两条映射可以共存（旧列做不到的事）", async () => {
    await linkIdentity({ authId: AUTH_ID, organisationId: ORG_A, kind: "CUSTOMER", customerId: custA });
    await linkIdentity({ authId: AUTH_ID, organisationId: ORG_B, kind: "CUSTOMER", customerId: custB });

    const links = await identitiesForAuthUser(AUTH_ID);
    expect(links.map((l) => l.organisationId).sort()).toEqual([ORG_A, ORG_B].sort());
  });

  it("已知门店 → 解析到**本店**那一个（不是随便是哪一个）", async () => {
    expect((await identityInTenant(AUTH_ID, ORG_A))?.customerId).toBe(custA);
    expect((await identityInTenant(AUTH_ID, ORG_B))?.customerId).toBe(custB);
    expect((await identityInTenant(AUTH_ID, ORG_A))?.customerId).not.toBe(custB);
  });

  it("不知道门店 → 明确告诉调用方「需要选择」，而不是替他挑一个", async () => {
    // 这条是整个 P3 最重要的一条：静默挑第一个是这类系统最典型的串店 bug ——
    // 客户在 A 店登录，界面却是 B 店的资料。
    expect(await needsTenantChoice(AUTH_ID)).toBe(true);
  });

  it("只有一家店时不需要选择（单店用户是绝大多数，别逼他们多点一次）", async () => {
    await linkIdentity({ authId: STAFF_AUTH, organisationId: ORG_C, kind: "STAFF", userId: staffId });
    expect(await needsTenantChoice(STAFF_AUTH)).toBe(false);
    expect((await identityInTenant(STAFF_AUTH, ORG_C))?.kind).toBe("STAFF");
  });
});

describe("P3a ② 别家门店查不到（不泄漏存在性）", () => {
  it("拿一个没有映射的门店去解析 → null", async () => {
    expect(await identityInTenant(AUTH_ID, ORG_C)).toBeNull();
  });

  it("空 authId / 空 organisationId → null，而不是抛错或返回全量", async () => {
    expect(await identityInTenant("", ORG_A)).toBeNull();
    expect(await identityInTenant(AUTH_ID, "")).toBeNull();
    expect(await identitiesForAuthUser("")).toEqual([]);
  });

  it("还没有映射的账号 → 空数组（调用方据此提示「先去注册」，而不是当成错误）", async () => {
    expect(await identitiesForAuthUser("test-auth-user-nobody")).toEqual([]);
  });
});

describe("P3a ③ linkIdentity 幂等且会校验形状", () => {
  it("重复绑定不会产生第二条（重复登录/重复扫码是常态）", async () => {
    await linkIdentity({ authId: AUTH_ID, organisationId: ORG_A, kind: "CUSTOMER", customerId: custA });
    await linkIdentity({ authId: AUTH_ID, organisationId: ORG_A, kind: "CUSTOMER", customerId: custA });
    const links = await db.authLink.count({ where: { authId: AUTH_ID, organisationId: ORG_A } });
    expect(links).toBe(1);
  });

  it("STAFF 必须给 userId、CUSTOMER 必须给 customerId（否则就是一条谁也对不上的映射）", async () => {
    await expect(linkIdentity({ authId: "x", organisationId: ORG_A, kind: "STAFF" })).rejects.toThrow(/STAFF 必须给 userId/);
    await expect(linkIdentity({ authId: "x", organisationId: ORG_A, kind: "CUSTOMER" })).rejects.toThrow(/CUSTOMER 必须给 customerId/);
    await expect(linkIdentity({ authId: "", organisationId: ORG_A, kind: "CUSTOMER", customerId: custA })).rejects.toThrow(/都必填/);
  });

  it("同一家店里，一条业务身份只能被一个 auth 账号认领", async () => {
    // 否则两个人会共享同一个客户档案 —— 那比"不共用"更糟
    await expect(
      linkIdentity({ authId: "test-auth-user-second", organisationId: ORG_A, kind: "CUSTOMER", customerId: custA }),
    ).rejects.toThrow();
  });
});
