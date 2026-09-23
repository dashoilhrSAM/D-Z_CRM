// 手机号归属判定的护栏。
//
// 这段逻辑决定「谁能用短信登录进哪个账号」，出错的方式只有两种，且都很严重：
//  · 判太严 → 真实客户被挡在门外（本轮线上实测：3 个客户全被拒）；
//  · 判太松 → 把号码挂到别人的账号上（等于账号接管），或删掉别人的 auth 账号。
// 所以正反两个方向都要钉住，尤其是「别人的账号绝对不能删也不能改」这条。
import { describe, expect, it } from "vitest";
import { planPhoneLogin, sameMsisdn } from "@/lib/auth/phone-login";

describe("号码形态比较（Supabase 存不带 + 的形式）", () => {
  it("带不带 +、带不带分隔符都视为同一个号码", () => {
    expect(sameMsisdn("+60111111111", "60111111111")).toBe(true);
    expect(sameMsisdn("013-125 2832", "+60131252832")).toBe(true);
    expect(sameMsisdn("0123456789", "+60123456789")).toBe(true);
  });

  it("不同号码不相等，空值不相等", () => {
    expect(sameMsisdn("+60111111111", "+60111111112")).toBe(false);
    expect(sameMsisdn("", "+60111111111")).toBe(false);
    expect(sameMsisdn(null, undefined)).toBe(false);
  });
});

describe("该挂哪、该建哪、什么情况必须停下来", () => {
  it("客户还没绑定账号 → 建号（验码后再认领档案）", () => {
    expect(planPhoneLogin({ customerAuthId: null, phoneHolderAuthId: null, holderBelongsToAnotherCustomer: false }))
      .toEqual({ action: "create" });
  });

  it("号码没人占用 → 直接挂到他已有的账号上（这就是被拒的那三个客户的情况）", () => {
    expect(planPhoneLogin({ customerAuthId: "user-1", phoneHolderAuthId: null, holderBelongsToAnotherCustomer: false }))
      .toEqual({ action: "attach", authUserId: "user-1" });
  });

  it("号码已经在他自己账号上 → 仍然走 attach（幂等，避免重复逻辑）", () => {
    expect(planPhoneLogin({ customerAuthId: "user-1", phoneHolderAuthId: "user-1", holderBelongsToAnotherCustomer: false }))
      .toEqual({ action: "attach", authUserId: "user-1" });
  });

  it("号码被**孤儿**账号占着 → 删掉孤儿再挂到他账号上（否则 Supabase 因号码唯一而拒绝）", () => {
    expect(planPhoneLogin({ customerAuthId: "user-1", phoneHolderAuthId: "orphan-9", holderBelongsToAnotherCustomer: false }))
      .toEqual({ action: "attach", authUserId: "user-1", deleteOrphanAuthUserId: "orphan-9" });
  });

  it("号码已被**另一个客户**绑定 → 停下来报冲突，绝不动别人的账号", () => {
    const plan = planPhoneLogin({ customerAuthId: "user-1", phoneHolderAuthId: "user-2", holderBelongsToAnotherCustomer: true });
    expect(plan.action).toBe("conflict");
    expect(JSON.stringify(plan)).not.toContain("deleteOrphan");
  });
});
