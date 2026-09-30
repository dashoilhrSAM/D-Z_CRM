// P3b 第 4 步的另一半：门店专属链接 `/t/<slug>` 的落地决策（`planShopEntry`）。
//
// 这是一个**入口**，所以它守的是"别把人送进不属于他的店"：
//   ① 员工/骑手用自己店的链接 → 进对的家；
//   ② **一个 authId 两家店时，URL 里的 slug 说了算**（不是 cookie、不是"唯一所属"）；
//   ③ 不是这家店的人 → `not-a-member`，**绝不返回 enter**（不签 cookie、不猜一家）；
//   ④ 未登录 → 去登录（登录页消费 `?next=` 回跳）；slug 不存在/店停用 → 明确的失效。
//
// 决策抽成函数而不是写在 route handler 里的理由：handler 里的 cookies()/redirect()
// 在 vitest 里跑不了，而"该不该放行"才是要钉住的东西。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { planShopEntry } from "@/lib/tenant/entry-tenant";

const ORG_A = "test_shop_org_a";
const ORG_B = "test_shop_org_b";
const ORG_OFF = "test_shop_org_off";
const BOTH_AUTH = "test-shop-both-auth";
const NOBODY_AUTH = "test-shop-nobody-auth";

let slugA = "";
let slugB = "";
let slugOff = "";
let userA = "";
let userB = "";
let custB = "";

async function cleanup() {
  await db.authLink.deleteMany({ where: { organisationId: { in: [ORG_A, ORG_B, ORG_OFF] } } });
  await db.customer.deleteMany({ where: { organisationId: { in: [ORG_A, ORG_B, ORG_OFF] } } });
  await db.user.deleteMany({ where: { organisationId: { in: [ORG_A, ORG_B, ORG_OFF] } } });
  await db.organisation.deleteMany({ where: { id: { in: [ORG_A, ORG_B, ORG_OFF] } } });
}

beforeAll(async () => {
  await cleanup();
  const tag = Date.now().toString(36);
  slugA = "shop-a-" + tag;
  slugB = "shop-b-" + tag;
  slugOff = "shop-off-" + tag;
  await db.organisation.create({ data: { id: ORG_A, name: "Shop A", slug: slugA } });
  await db.organisation.create({ data: { id: ORG_B, name: "Shop B", slug: slugB } });
  await db.organisation.create({ data: { id: ORG_OFF, name: "Shop Off", slug: slugOff, status: "SUSPENDED" } });
  // 同一个人：A 店员工 + B 店骑手
  userA = (await db.user.create({ data: { organisationId: ORG_A, name: "Shop Staff A", email: "shop.a." + tag + "@example.com", role: "MECHANIC", authId: BOTH_AUTH } })).id;
  custB = (await db.customer.create({ data: { organisationId: ORG_B, name: "Shop Rider B", authId: BOTH_AUTH } })).id;
  userB = (await db.user.create({ data: { organisationId: ORG_B, name: "Shop Staff B", email: "shop.b." + tag + "@example.com", role: "MANAGER", authId: NOBODY_AUTH } })).id;
  await db.authLink.create({ data: { authId: BOTH_AUTH, organisationId: ORG_A, kind: "STAFF", userId: userA } });
  await db.authLink.create({ data: { authId: BOTH_AUTH, organisationId: ORG_B, kind: "CUSTOMER", customerId: custB } });
  await db.authLink.create({ data: { authId: NOBODY_AUTH, organisationId: ORG_B, kind: "STAFF", userId: userB } });
});

afterAll(cleanup);

describe("① 自己店的链接 → 进对的家", () => {
  it("A 店员工走 A 店链接 → /workshop/dashboard", async () => {
    expect(await planShopEntry(BOTH_AUTH, slugA)).toEqual({
      kind: "enter",
      organisationId: ORG_A,
      slug: slugA,
      home: "/workshop/dashboard",
    });
  });

  it("同一个人的 B 店骑手身份走 B 店链接 → /rider/home", async () => {
    expect(await planShopEntry(BOTH_AUTH, slugB)).toEqual({
      kind: "enter",
      organisationId: ORG_B,
      slug: slugB,
      home: "/rider/home",
    });
  });

  it("slug 前后有空格也能认（URL 里粘贴常带空格）", async () => {
    const p = await planShopEntry(BOTH_AUTH, "  " + slugA + "  ");
    expect(p.kind).toBe("enter");
  });
});

describe("② 不是这家店的人 → 绝不放行", () => {
  it("**在别家店有身份 ≠ 能进这家店**（BOTH_AUTH 走一家他没身份的店不可能发生，这里用另一家）", async () => {
    // NOBODY_AUTH 只有 B 店身份 → 走 A 店链接必须被拒
    const p = await planShopEntry(NOBODY_AUTH, slugA);
    expect(p.kind).toBe("not-a-member");
    if (p.kind !== "not-a-member") throw new Error("unreachable");
    expect(p.candidates.map((c) => c.organisationId)).toEqual([ORG_B]);
  });

  it("完全没有任何业务身份 → 也是 not-a-member（不是 enter，也不是崩）", async () => {
    const p = await planShopEntry("test-shop-ghost-auth", slugB);
    expect(p.kind).toBe("not-a-member");
    expect(p.kind === "not-a-member" && p.candidates).toEqual([]);
  });
});

describe("③ 未登录 / 链接失效", () => {
  it("未登录 → signin（route handler 会带上 ?next= 去登录）", async () => {
    expect(await planShopEntry(null, slugA)).toEqual({ kind: "signin" });
  });

  it("slug 不存在 → unknown-shop，带上原因", async () => {
    const p = await planShopEntry(BOTH_AUTH, "no-such-shop-" + Date.now().toString(36));
    expect(p.kind).toBe("unknown-shop");
    expect(p.kind === "unknown-shop" && p.error.length).toBeGreaterThan(5);
  });

  it("门店被停用 → unknown-shop（不因为 slug 存在就放行）", async () => {
    expect((await planShopEntry(BOTH_AUTH, slugOff)).kind).toBe("unknown-shop");
  });

  it("未登录 + slug 不存在 → 先报链接失效，不是先拉去登录", async () => {
    expect((await planShopEntry(null, "no-such-shop-xyz")).kind).toBe("unknown-shop");
  });
});
