// P3b 第 1 步：注册入口的租户解析（`resolveEntryTenant`）。
//
// 要证明的一件事：**「这是哪家店」要么是显式给的，要么根本唯一，绝不猜。**
// 之前注册路径用的是 `db.organisation.findFirst({ orderBy: { name: "asc" } })` ——
// 两家店并存时它按字母序抛硬币。本地 dev.db 就是活证：10 家组织里 9 家是测试残留的空壳
// （0 门店 / 0 客户），按名字排序胜出的正是 `BULK-blkmueyf5dv`，于是注册会进一家空壳店。
//
// ⚠️「唯一在营门店」这条兜底路径只用**纯函数**测（`pickSoleTenant`），不走库：
// dev.db 是多个测试文件共用的，别的文件随时可能建出第二家带门店的组织 ——
// 对库断言「现在只有一家」必然随机红。对库只断言**确定性**的部分：
// 显式 slug / cookie / 多店必须拒绝。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pickSoleTenant, resolveEntryTenantFor, type TenantCandidate } from "@/lib/tenant/entry-tenant";

const ORG_MAIN = "test_entry_org_main";
const ORG_OTHER = "test_entry_org_other";
const ORG_SUSPENDED = "test_entry_org_suspended";

let slugMain = "";
let slugOther = "";

function candidate(over: Partial<TenantCandidate> & { id: string }): TenantCandidate {
  return { slug: null, status: "ACTIVE", hasBranch: true, ...over };
}

/** 兜底选中了谁（没选中回 null）——让断言读起来是「选了哪家」而不是「哪个字段非空」。 */
function soleId(rows: TenantCandidate[]): string | null {
  const p = pickSoleTenant(rows);
  return p.ok ? p.tenant.id : null;
}

async function cleanup() {
  await db.branch.deleteMany({ where: { organisationId: { in: [ORG_MAIN, ORG_OTHER, ORG_SUSPENDED] } } });
  await db.organisation.deleteMany({ where: { id: { in: [ORG_MAIN, ORG_OTHER, ORG_SUSPENDED] } } });
}

beforeAll(async () => {
  await cleanup();
  const tag = Date.now().toString(36);
  slugMain = "entry-main-" + tag;
  slugOther = "entry-other-" + tag;
  await db.organisation.create({ data: { id: ORG_MAIN, name: "Entry Main", slug: slugMain } });
  await db.organisation.create({ data: { id: ORG_OTHER, name: "Entry Other", slug: slugOther } });
  await db.organisation.create({ data: { id: ORG_SUSPENDED, name: "Entry Suspended", slug: "entry-susp-" + tag, status: "SUSPENDED" } });
  await db.branch.create({ data: { organisationId: ORG_MAIN, name: "Main Branch", city: "PJ" } });
  await db.branch.create({ data: { organisationId: ORG_OTHER, name: "Other Branch", city: "PJ" } });
});

afterAll(cleanup);

describe("pickSoleTenant：唯一才兜底，多店一律拒绝", () => {
  it("没有在营组织 → NONE", () => {
    expect(pickSoleTenant([])).toEqual({ ok: false, reason: "NONE" });
    expect(pickSoleTenant([candidate({ id: "a", status: "SUSPENDED" })])).toEqual({ ok: false, reason: "NONE" });
  });

  it("唯一一家在营且有门店 → 用它", () => {
    expect(pickSoleTenant([candidate({ id: "a", slug: "shop-a" })])).toEqual({
      ok: true,
      tenant: { id: "a", slug: "shop-a", status: "ACTIVE", hasBranch: true },
    });
  });

  it("两家在营门店 → MANY（这就是「不猜」的全部意义）", () => {
    expect(pickSoleTenant([candidate({ id: "a" }), candidate({ id: "b" })])).toEqual({ ok: false, reason: "MANY" });
  });

  it("测试残留的空壳组织（有行、无门店）不参与兜底 —— 否则单店部署会被它们变成「多店」", () => {
    // dev.db 的真实形状：1 家有门店 + 2 家空壳
    const rows = [candidate({ id: "real" }), candidate({ id: "shell1", hasBranch: false }), candidate({ id: "shell2", hasBranch: false })];
    expect(soleId(rows)).toBe("real");
  });

  it("空壳排在前面的顺序无关紧要（不是「挑第一个」）", () => {
    const rows = [candidate({ id: "shell1", hasBranch: false }), candidate({ id: "real" }), candidate({ id: "shell2", hasBranch: false })];
    expect(soleId(rows)).toBe("real");
  });

  it("一家有门店的都没有，但运营组织恰好一家 → 才退回它", () => {
    expect(pickSoleTenant([candidate({ id: "only", hasBranch: false })])).toEqual({
      ok: true,
      tenant: { id: "only", slug: null, status: "ACTIVE", hasBranch: false },
    });
  });

  it("停用的店不算在营：停用 1 家 + 在营 1 家 → 用在营那家", () => {
    expect(soleId([candidate({ id: "off", status: "SUSPENDED" }), candidate({ id: "on" })])).toBe("on");
  });

  it("TRIAL 算在营；未知状态不算（fail-closed）", () => {
    expect(pickSoleTenant([candidate({ id: "trial", status: "TRIAL" })]).ok).toBe(true);
    expect(pickSoleTenant([candidate({ id: "weird", status: "PAUSED" })])).toEqual({ ok: false, reason: "NONE" });
  });
});

describe("resolveEntryTenantFor：来源优先级与 fail-closed", () => {
  it("① 显式 slug 优先级最高 —— 两家店在营也照样定位到指定那家", async () => {
    const r = await resolveEntryTenantFor({ slug: slugOther });
    expect(r).toEqual({ ok: true, organisationId: ORG_OTHER, slug: slugOther, source: "slug" });
  });

  it("slug 会 trim；不存在的 slug 直接拒绝（不落回「随便找一家」）", async () => {
    expect((await resolveEntryTenantFor({ slug: "  " + slugMain + "  " })).ok).toBe(true);
    const r = await resolveEntryTenantFor({ slug: "no-such-shop-" + Date.now().toString(36) });
    expect(r).toMatchObject({ ok: false, code: "UNKNOWN_SLUG" });
  });

  it("slug 指向被停用的店 → SUSPENDED（不静默换成别家）", async () => {
    const org = await db.organisation.findUnique({ where: { id: ORG_SUSPENDED }, select: { slug: true } });
    const r = await resolveEntryTenantFor({ slug: org!.slug });
    expect(r).toMatchObject({ ok: false, code: "SUSPENDED" });
  });

  it("② 签名 cookie 次之 —— 同样在两家店在营时也能定位", async () => {
    const r = await resolveEntryTenantFor({ cookieTenant: { organisationId: ORG_MAIN, slug: slugMain } });
    expect(r).toEqual({ ok: true, organisationId: ORG_MAIN, slug: slugMain, source: "cookie" });
  });

  it("cookie 指向被停用的店 → 拒绝，而不是「顺手」把人注册到别家店", async () => {
    const r = await resolveEntryTenantFor({ cookieTenant: { organisationId: ORG_SUSPENDED, slug: "whatever" } });
    expect(r).toMatchObject({ ok: false, code: "SUSPENDED" });
  });

  it("cookie 指向已删除的店（陈旧 cookie）→ 当没选过，落到兜底；此处有两家在营 → AMBIGUOUS", async () => {
    const r = await resolveEntryTenantFor({ cookieTenant: { organisationId: "org_deleted_long_ago", slug: "gone" } });
    expect(r).toMatchObject({ ok: false, code: "AMBIGUOUS" });
  });

  it("③ 没有显式租户 + 两家在营门店 → AMBIGUOUS，并把话说明白（不再按字母序抛硬币）", async () => {
    const r = await resolveEntryTenantFor({});
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.code).toBe("AMBIGUOUS");
    // 错误文案要能指导用户（这条会被人看到，不是日志）
    expect(r.error).toMatch(/link/i);
  });

  it("显式 slug 与 cookie 冲突时以 slug 为准（URL 是用户这一次的明确意图）", async () => {
    const r = await resolveEntryTenantFor({ slug: slugMain, cookieTenant: { organisationId: ORG_OTHER, slug: slugOther } });
    expect(r).toEqual({ ok: true, organisationId: ORG_MAIN, slug: slugMain, source: "slug" });
  });
});
