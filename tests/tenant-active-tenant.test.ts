// P3b：当前门店上下文（签名 cookie）的测试。
//
// 这条 cookie 决定"这次请求能看哪家店的数据"，所以它是一个**安全边界**，
// 而不是一个偏好设置。测试的重点全在"伪造不了"上。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signTenant, verifyTenant } from "@/lib/tenant/active-tenant";

const saved = process.env.AUTH_SECRET;
const TENANT = { organisationId: "org_abc123", slug: "d-z-smart-workshop" };

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-active-tenant";
});
afterAll(() => {
  process.env.AUTH_SECRET = saved;
});

describe("签发与验签", () => {
  it("正常签发 → 验得回来", () => {
    expect(verifyTenant(signTenant(TENANT))).toEqual(TENANT);
  });

  it("**保留签名、改内容就验不过**（这是它存在的全部理由）", () => {
    const good = signTenant(TENANT);
    const parts = good.split(".");

    // 最像攻击的那种改法：签名照抄，把 organisationId 换成隔壁那家
    expect(verifyTenant(["org_other", parts[1], parts[2]].join("."))).toBeNull();
    // 改 slug 同样无效
    expect(verifyTenant([parts[0], "other-slug", parts[2]].join("."))).toBeNull();
    // 把签名换成一个自己算的（没有密钥，只能瞎猜）
    expect(verifyTenant([parts[0], parts[1], "not-a-real-signature"].join("."))).toBeNull();

    // ⚠️ 注意一个**容易被写错的断言**：直接调 signTenant({organisationId:"org_other"})
    // 得到的值是**合法**的 —— 服务端本来就有权为任意门店签发，那是它的职责。
    // 安全性质是"客户端造不出合法签名"，不是"服务端签不出别的门店"。
    // 第一版这里断言它应当为 null，测试红了，红得对：错的是那条断言。
    // 真正要守的是下面这条不变式：
    //   **setActiveTenant 只允许用「该用户确实有 AuthLink 的门店」来调用。**
    // 也就是先用 identitiesForAuthUser(authId) 取候选，再从中选，绝不直接用请求里的值。
  });

  it("换一个密钥签发的值也验不过（密钥不匹配不能「碰巧通过」）", () => {
    const forged = signTenant(TENANT);
    process.env.AUTH_SECRET = "a-different-secret";
    expect(verifyTenant(forged)).toBeNull();
    process.env.AUTH_SECRET = "test-secret-for-active-tenant";
  });

  it("形状不对的一律拒绝，而不是抛错", () => {
    for (const bad of [undefined, null, "", "a", "a.b", "a.b.c.d", "..", "org.slug.", ".slug.sig"]) {
      expect(verifyTenant(bad as string | undefined), "应拒绝: " + String(bad)).toBeNull();
    }
  });

  it("没有 AUTH_SECRET 时**不放行**（而不是暂时不校验）", () => {
    const good = signTenant(TENANT);
    delete process.env.AUTH_SECRET;
    // 这条是关键：如果实现成"没配密钥就跳过验签"，那么只要环境变量缺失，
    // 任何人都能伪造门店 —— 隔离会静默消失。必须 fail-closed。
    expect(verifyTenant(good)).toBeNull();
    process.env.AUTH_SECRET = "test-secret-for-active-tenant";
  });

  it("空 organisationId 直接拒绝签发（否则会签出一个谁都匹配得上的值）", () => {
    expect(() => signTenant({ organisationId: "", slug: "x" })).toThrow(/organisationId 必填/);
  });

  it("slug 可以变（改名不该让所有人掉线），organisationId 才是判据", () => {
    // 验签后以 organisationId 为准：slug 只是展示用的门牌号
    const a = verifyTenant(signTenant({ organisationId: "org_1", slug: "old-name" }));
    const b = verifyTenant(signTenant({ organisationId: "org_1", slug: "new-name" }));
    expect(a?.organisationId).toBe(b?.organisationId);
  });
});
