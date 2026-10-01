// P4 第三块（二）：限时支持访问 —— **双向留痕**。
//
// 平台人员要看租户数据，这个能力本身是必要的（不然"店里出问题了"只能靠猜），
// 但它的危险在于"看"是**不可见**的。所以这里守四件事：
//   ① 限时：服务端判过期（不靠 UI），且时长有上下限；
//   ② 必须写原因（审计的第一性问题）；
//   ③ **按人授权**：授权写清是谁，只有他能用（"谁都能用别人的授权"就没有留痕意义）；
//   ④ **双向留痕**：平台侧 `PlatformAuditLog` + 租户侧 `AuditLog`（他们在自己的审计页就能看到）。
//
// 另外两条结构断言：支持页**只读**（那个目录里没有任何 server action），
// 而且每次查看都会写两条审计。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { AuthAdminPort } from "@/providers/auth-admin";

class FakeAuthAdmin implements AuthAdminPort {
  users: Array<{ id: string; email: string }> = [];
  seq = 0;
  async ensureUser({ email }: { email: string; password: string; name?: string }) {
    const want = email.trim().toLowerCase();
    const found = this.users.find((u) => u.email === want);
    if (found) return { authId: found.id, reused: true };
    const id = "test-support-auth-" + ++this.seq;
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

const repo = new PrismaPlatformRepository();
const service = new PlatformService(repo, new FakeAuthAdmin());

// 固定夹具命名空间（自愈清理 —— 见 docs/changes/2026-10-01-p4-tenant-status.md 的教训）
const NS = "test-support";
const SLUG = "support-fixture";
const EMAIL = "owner@support.fixture.test";
const ADMIN_A = { authId: NS + "-admin-a", email: "a@platform.test" };
const ADMIN_B = { authId: NS + "-admin-b", email: "b@platform.test" };
let ORG = "";

async function cleanFixture() {
  await db.platformAuditLog.deleteMany({ where: { actorAuthId: { in: [ADMIN_A.authId, ADMIN_B.authId] } } });
  const old = await db.organisation.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (old) {
    await db.supportGrant.deleteMany({ where: { organisationId: old.id } });
    await db.auditLog.deleteMany({ where: { organisationId: old.id } });
    await repo.dropTenant(old.id);
  }
}

beforeAll(async () => {
  await cleanFixture();
  const res = await service.provisionTenant({ name: "Support Fixture Shop", slug: SLUG, ownerEmail: EMAIL });
  if (!res.ok) throw new Error("夹具开通失败：" + JSON.stringify(res));
  ORG = res.organisationId;
});
afterAll(cleanFixture);

const tenantAudit = (action: string) => db.auditLog.count({ where: { organisationId: ORG, action } });
const platformAudit = (action: string) => db.platformAuditLog.count({ where: { targetOrganisationId: ORG, action } });

describe("① 授权门槛：限时 + 必须写原因", () => {
  it("不写原因（或太短）→ 拒绝", async () => {
    const res = await service.grantSupportAccess({ organisationId: ORG, actor: ADMIN_A, reason: "看", minutes: 60 });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("原因");
  });

  it("时长越界（太短/太长）→ 拒绝", async () => {
    const tooShort = await service.grantSupportAccess({ organisationId: ORG, actor: ADMIN_A, reason: "排查工单", minutes: 1 });
    const tooLong = await service.grantSupportAccess({ organisationId: ORG, actor: ADMIN_A, reason: "排查工单", minutes: 9999 });
    expect(tooShort.ok).toBe(false);
    expect(tooLong.ok).toBe(false);
  });

  it("租户不存在 → 拒绝", async () => {
    const res = await service.grantSupportAccess({ organisationId: "no-such-org", actor: ADMIN_A, reason: "排查工单", minutes: 60 });
    expect(res.ok).toBe(false);
  });
});

describe("② **双向留痕**：平台侧与租户侧都写", () => {
  it("授予时两边各留一条", async () => {
    const res = await service.grantSupportAccess({ organisationId: ORG, actor: ADMIN_A, reason: "店主反馈工单卡住", minutes: 60 });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(await platformAudit("SUPPORT_GRANTED")).toBe(1);
    expect(await tenantAudit("SUPPORT_ACCESS_GRANTED"), "租户在自己的审计页看不到平台来过 = 单向留痕，不算数").toBe(1);
  });

  it("每次查看也两边都留（审计的价值就在每一次都留得下来）", async () => {
    await service.logSupportView({ organisationId: ORG, actor: ADMIN_A, detail: "support snapshot" });
    await service.logSupportView({ organisationId: ORG, actor: ADMIN_A, detail: "support snapshot" });
    expect(await platformAudit("SUPPORT_VIEWED")).toBe(2);
    expect(await tenantAudit("SUPPORT_ACCESS_VIEWED")).toBe(2);
  });

  it("撤销也是双向的", async () => {
    const count = await service.revokeSupportAccess({ organisationId: ORG, actor: ADMIN_A });
    expect(count).toBe(1);
    expect(await platformAudit("SUPPORT_REVOKED")).toBe(1);
    expect(await tenantAudit("SUPPORT_ACCESS_REVOKED")).toBe(1);
  });
});

describe("③ 失效判定在服务端（过期 / 撤销 / 换人）", () => {
  it("**过期即失效**（用显式 now 判，不依赖 UI）", async () => {
    const t0 = new Date("2026-10-01T00:00:00Z");
    const res = await service.grantSupportAccess({ organisationId: ORG, actor: ADMIN_A, reason: "过期测试", minutes: 30, now: t0 });
    expect(res.ok).toBe(true);
    const within = await service.activeSupportAccess(ORG, ADMIN_A.authId, new Date(t0.getTime() + 29 * 60_000));
    const after = await service.activeSupportAccess(ORG, ADMIN_A.authId, new Date(t0.getTime() + 31 * 60_000));
    expect(within, "有效期内应当可用").not.toBeNull();
    expect(after, "过期了还能用 = 限时是假的").toBeNull();
    await service.revokeSupportAccess({ organisationId: ORG, actor: ADMIN_A });
  });

  it("**撤销后立刻失效**", async () => {
    await service.grantSupportAccess({ organisationId: ORG, actor: ADMIN_A, reason: "撤销测试", minutes: 60 });
    expect(await service.activeSupportAccess(ORG, ADMIN_A.authId)).not.toBeNull();
    await service.revokeSupportAccess({ organisationId: ORG, actor: ADMIN_A });
    expect(await service.activeSupportAccess(ORG, ADMIN_A.authId)).toBeNull();
  });

  it("**授权按人**：B 管理员不能用 A 的授权", async () => {
    await service.grantSupportAccess({ organisationId: ORG, actor: ADMIN_A, reason: "按人测试", minutes: 60 });
    expect(await service.activeSupportAccess(ORG, ADMIN_A.authId)).not.toBeNull();
    expect(await service.activeSupportAccess(ORG, ADMIN_B.authId), "别人的授权也能用 → 留痕失去意义").toBeNull();
    await service.revokeSupportAccess({ organisationId: ORG, actor: ADMIN_A });
  });
});

describe("④ 支持会话能看到的只有白名单只读快照", () => {
  it("快照含计数/最近工单/员工/租户审计，且**没有任何写路径**", async () => {
    await service.grantSupportAccess({ organisationId: ORG, actor: ADMIN_A, reason: "快照测试", minutes: 60 });
    const snap = await service.supportSnapshot(ORG);
    expect(snap.counts.staff).toBeGreaterThanOrEqual(1);
    expect(Object.keys(snap.counts).sort()).toEqual(["bookings", "customers", "invoices", "jobs", "staff"]);
    expect(Array.isArray(snap.recentJobs)).toBe(true);
    expect(snap.staff.length).toBeGreaterThanOrEqual(1);
    // 租户审计里能看到"平台来过"——这就是"租户可见"的直接证明
    expect(snap.tenantAudit.some((a) => a.action.startsWith("SUPPORT_ACCESS_"))).toBe(true);
    await service.revokeSupportAccess({ organisationId: ORG, actor: ADMIN_A });
  });
});

describe("⑤ 结构守卫：支持页只读、入口都过守卫", () => {
  const root = process.cwd();
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("`/platform/[slug]/support` 目录里**没有 server action、没有写库**", () => {
    const dir = path.join(root, "src/app/platform/[slug]/support");
    const files = readdirSync(dir);
    expect(files.length, "支持页目录里不该有别的文件（多一个就可能多一条写路径）").toBe(1);
    const src = strip(readFileSync(path.join(dir, files[0]), "utf8"));
    expect(src.includes('"use server"'), "支持页不该定义 server action").toBe(false);
    expect(src, "支持页不该直接写库").not.toMatch(/\.(create|update|delete|upsert|deleteMany|updateMany)\(/);
    expect(src).toContain("requirePlatformAdmin()");
    expect(src, "没授权就不该展示租户数据").toMatch(/activeSupportAccess/);
  });

  it("平台台的 action 全都自己判身份（数量与守卫调用数相等）", () => {
    const src = strip(readFileSync(path.join(root, "src/app/platform/actions.ts"), "utf8"));
    const count = (src.match(/export async function \w+\(/g) ?? []).length;
    const guarded = (src.match(/requirePlatformAdmin\(\)/g) ?? []).length;
    expect(count, "action 至少四个（开通/改状态/授予支持/撤销支持）").toBeGreaterThanOrEqual(4);
    expect(guarded, "有 action 没判身份").toBe(count);
  });
});
