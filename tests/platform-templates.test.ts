// P4 第三块（四）：开通模板库 —— "把店 A 的配置复制给店 B"。
//
// 开第一家店时默认配置"差不多就行"；开到第五家时你会希望把**已经调好的那家**复制过去。
// 所以这里守三件事：
//   ① 两条来源与**解析顺序一致**：自定义（库里）→ 内置（代码里）。
//      列表里"看到的"和开新店"用到的"必须是同一个 —— 否则选了自定义模板却开了标准配置，
//      而这种错**不会报错**。
//   ② 模板是不可信输入（可能来自某家店导出的 JSON）：形状不对就拒绝，且**不静默退回默认**——
//      "我明明选了模板"变成一句空话是很难查的。
//   ③ 导出只搬配置、不搬业务数据（模板不是备份）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthAdminPort } from "@/providers/auth-admin";

class FakeAuthAdmin implements AuthAdminPort {
  users: Array<{ id: string; email: string }> = [];
  seq = 0;
  async ensureUser({ email }: { email: string; password: string; name?: string }) {
    const want = email.trim().toLowerCase();
    const found = this.users.find((u) => u.email === want);
    if (found) return { authId: found.id, reused: true };
    const id = "test-tpl-auth-" + ++this.seq;
    this.users.push({ id, email: want });
    return { authId: id, reused: false };
  }
  async findByEmail(email: string) {
    const want = email.trim().toLowerCase();
    const found = this.users.find((u) => u.email === want);
    return found ? { authId: found.id, email: found.email } : null;
  }
}

const { db } = await import("@/lib/db");
const { PlatformService } = await import("@/modules/platform/service");
const { PrismaPlatformRepository } = await import("@/repositories/prisma/platform.repository");
const { BUILTIN_TEMPLATES, safeParsePayload, TEMPLATE_KEY_PATTERN } = await import("@/modules/platform/templates");

const repo = new PrismaPlatformRepository();
const service = new PlatformService(repo, new FakeAuthAdmin());

const NS = "test-tpl";
const SRC_SLUG = "tpl-source";
const NEW_SLUG = "tpl-new";
const TPL_KEY = NS + "-custom";
const ACTOR = { authId: NS + "-actor", email: "ops@platform.test" };
let SRC_ORG = "";

/** 按**夹具命名空间**清（`tpl-` 开头的店 + `test-tpl` 开头的模板 key）——
 *  自愈：变异/中断跑留下的东西不会让后面的断言以"看起来像实现坏了"的方式红。 */
async function cleanFixture() {
  const orgs = await db.organisation.findMany({ where: { slug: { startsWith: "tpl-" } }, select: { id: true } });
  for (const o of orgs) await repo.purgeTenantRows(o.id);
  await db.tenantTemplate.deleteMany({ where: { OR: [{ key: { startsWith: NS } }, { key: "standard" }] } });
  await db.platformAuditLog.deleteMany({ where: { actorAuthId: ACTOR.authId } });
}

beforeAll(async () => {
  await cleanFixture();
  const res = await service.provisionTenant({ name: "Template Source Shop", slug: SRC_SLUG, ownerEmail: "src@template.test" });
  if (!res.ok) throw new Error("夹具开通失败：" + JSON.stringify(res));
  SRC_ORG = res.organisationId;
  // 改一点配置，证明"导出的是这家店**当前**的配置"而不是内置默认
  await db.serviceType.updateMany({ where: { organisationId: SRC_ORG, code: "SVC-GEN" }, data: { name: "招牌大保养", priceSen: 9999 } });
  await db.serviceType.deleteMany({ where: { organisationId: SRC_ORG, code: "SVC-TYRE" } });
  await db.leadSource.create({ data: { organisationId: SRC_ORG, name: "Shopee" } });
});
afterAll(cleanFixture);

describe("① 内置模板：永远存在、形状合法、可复现", () => {
  it("内置模板都能通过负载校验（内置也是数据，也要过同一道关）", () => {
    for (const [key, t] of Object.entries(BUILTIN_TEMPLATES)) {
      expect(TEMPLATE_KEY_PATTERN.test(key), key + " 的 key 形状不对").toBe(true);
      expect(safeParsePayload(t.payload), key + " 的负载形状不合法").not.toBeNull();
      expect(t.payload.serviceTypes.length).toBeGreaterThan(0);
      expect(t.payload.leadStages.length).toBeGreaterThan(0);
    }
  });

  it("阶段顺序按数组下标兜底（顺序对线索看板是真实语义）", () => {
    const p = safeParsePayload({ leadStages: [{ name: "A" }, { name: "B" }] });
    expect(p!.leadStages.map((s) => s.order)).toEqual([0, 1]);
  });

  it("坏形状返回 null（不抛）—— 一条坏模板不该让列表页 500", () => {
    expect(safeParsePayload({ serviceTypes: [{ name: "" }] })).toBeNull();
    expect(safeParsePayload({ serviceTypes: [{ name: "x", priceSen: -5 }] })).toBeNull();
    expect(safeParsePayload("not an object")).toBeNull();
  });
});

describe("② 从某家店导出模板（只搬配置）", () => {
  it("导出的是**这家店当前的**配置，不是内置默认", async () => {
    const res = await service.saveTemplateFromTenant({
      organisationId: SRC_ORG, key: TPL_KEY, name: "从源店导出", description: "冒烟", actor: ACTOR,
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);

    const row = await db.tenantTemplate.findUnique({ where: { key: TPL_KEY } });
    const payload = safeParsePayload(JSON.parse(row!.payload))!;
    expect(payload.serviceTypes.some((s) => s.name === "招牌大保养" && s.priceSen === 9999), "改过的服务没被导出").toBe(true);
    expect(payload.serviceTypes.some((s) => s.code === "SVC-TYRE"), "删掉的服务不该还在").toBe(false);
    expect(payload.leadSources.some((s) => s.name === "Shopee"), "新增的线索来源没被导出").toBe(true);
    expect(row!.sourceOrganisationId).toBe(SRC_ORG);
  });

  it("导出会留平台审计（谁把哪家店导成了模板）", async () => {
    const audit = await db.platformAuditLog.findFirst({ where: { action: "TEMPLATE_SAVED", targetOrganisationId: SRC_ORG } });
    expect(audit).not.toBeNull();
    expect(audit!.detail).toContain(TPL_KEY);
  });

  it("key 形状不对 / 名字为空 / 店不存在 → 拒绝", async () => {
    expect((await service.saveTemplateFromTenant({ organisationId: SRC_ORG, key: "Bad Key", name: "x", actor: ACTOR })).ok).toBe(false);
    expect((await service.saveTemplateFromTenant({ organisationId: SRC_ORG, key: NS + "-ok", name: "  ", actor: ACTOR })).ok).toBe(false);
    expect((await service.saveTemplateFromTenant({ organisationId: "no-such-org", key: NS + "-ok", name: "x", actor: ACTOR })).ok).toBe(false);
  });
});

describe("③ 开新店套模板：自定义优先，找不到就明确拒绝", () => {
  it("**用自定义模板开的新店，拿到的是自定义那份配置**（不是内置）", async () => {
    const res = await service.provisionTenant({ name: "Template New Shop", slug: NEW_SLUG, ownerEmail: "new@template.test", templateKey: TPL_KEY });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    const org = await db.organisation.findUnique({ where: { slug: NEW_SLUG }, select: { id: true } });
    const names = (await db.serviceType.findMany({ where: { organisationId: org!.id }, select: { name: true } })).map((s) => s.name);
    expect(names, "选了自定义模板却建出内置配置 —— 这种错不会报错，只能靠断言").toContain("招牌大保养");
    expect(names).not.toContain("Tyre Replace");
    expect(await db.leadSource.count({ where: { organisationId: org!.id, name: "Shopee" } })).toBe(1);
  });

  it("内置模板也能直接点名用", async () => {
    const slug = "tpl-builtin";
    const old = await db.organisation.findUnique({ where: { slug }, select: { id: true } });
    if (old) await repo.purgeTenantRows(old.id);
    const res = await service.provisionTenant({ name: "Builtin Shop", slug, ownerEmail: "b@template.test", templateKey: "dealer-only" });
    expect(res.ok).toBe(true);
    const org = await db.organisation.findUnique({ where: { slug }, select: { id: true } });
    expect(await db.serviceType.count({ where: { organisationId: org!.id } })).toBe(BUILTIN_TEMPLATES["dealer-only"].payload.serviceTypes.length);
    await repo.purgeTenantRows(org!.id);
  });

  it("**自定义模板可以遮蔽内置同名 key，并且开新店真的用自定义那份**", async () => {
    // 这是"自定义优先"唯一能被观察到的情形：key 撞车。
    // 少了这条断言，把解析顺序改成"内置优先"也不会有任何测试变红（实测过）。
    const shadowSlug = "tpl-shadow";
    const old = await db.organisation.findUnique({ where: { slug: shadowSlug }, select: { id: true } });
    if (old) await repo.purgeTenantRows(old.id);

    const saved = await service.saveTemplateFromTenant({
      organisationId: SRC_ORG, key: "standard", name: "被改过的标准模板", actor: ACTOR,
    });
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    try {
      const res = await service.provisionTenant({ name: "Shadow Shop", slug: shadowSlug, ownerEmail: "s@template.test", templateKey: "standard" });
      expect(res.ok, JSON.stringify(res)).toBe(true);
      const org = await db.organisation.findUnique({ where: { slug: shadowSlug }, select: { id: true } });
      const names = (await db.serviceType.findMany({ where: { organisationId: org!.id }, select: { name: true } })).map((s2) => s2.name);
      expect(names, "解析顺序变成内置优先了 —— 列表里看到的和开出来的不是同一个").toContain("招牌大保养");
      await repo.purgeTenantRows(org!.id);
    } finally {
      await db.tenantTemplate.deleteMany({ where: { key: "standard" } });
    }
  });

  it("**模板不存在 → 拒绝开通**（不静默退回默认配置）", async () => {
    const slug = "tpl-missing";
    const stale = await db.organisation.findUnique({ where: { slug }, select: { id: true } });
    if (stale) await repo.purgeTenantRows(stale.id);
    const before = await db.organisation.count({ where: { slug } });
    const res = await service.provisionTenant({ name: "Missing Template Shop", slug, ownerEmail: "m@template.test", templateKey: "no-such-template" });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.code).toBe("TEMPLATE_NOT_FOUND");
    expect(res.ok === false && res.error).toContain("no-such-template");
    expect(await db.organisation.count({ where: { slug } })).toBe(before);
  });
});

describe("④ 列表：自定义在前、内置在后（与解析顺序一致）", () => {
  it("顺序一致 —— 免得「看到的」和「用到的」不是同一个", async () => {
    const list = await service.listTemplates();
    const firstBuiltin = list.findIndex((t) => t.source === "builtin");
    const lastCustom = list.map((t) => t.source).lastIndexOf("custom");
    expect(lastCustom).toBeGreaterThanOrEqual(0);
    expect(firstBuiltin).toBeGreaterThan(lastCustom);
    expect(list.some((t) => t.key === TPL_KEY && t.source === "custom")).toBe(true);
    expect(list.some((t) => t.key === "standard" && t.source === "builtin")).toBe(true);
  });

  it("删除自定义模板之后，同名 key 会退回内置（如果内置有的话）", async () => {
    expect(await service.deleteTemplate(TPL_KEY)).toBe(true);
    expect(await db.tenantTemplate.findUnique({ where: { key: TPL_KEY } })).toBeNull();
  });
});
