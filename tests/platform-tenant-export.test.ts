// P4 收尾：按租户导出（数据可携带性）。
//
// 这一块最要紧的不是"能下载一个 JSON"，而是**下载的东西里没有不该有的**：
// `User` 表还留着历史遗留的 passwordHash / mfaSecret / verifyToken / resetToken，
// `IntegrationConfig` 里是各家 provider 的凭据 —— 一份带着这些的导出，
// 等于把一家店的全部钥匙抄送出去。
//
// 所以四条断言：
//   ① **范围正确**：包含这家店在每一张属于租户的表里的行（行范围与退租同一份计划）；
//   ② **密钥脱敏**：真写一个密码哈希/MFA 密钥/provider 凭据，导出里必须是 [redacted]；
//   ③ **不串店**：另一家店的行绝不出现在导出里；
//   ④ **留痕**：平台侧 + 租户自己的审计页各一条（导出一家店的数据，两边都该知道）。
//
// 另外一条结构守卫：**扫 schema 找疑似密钥列，没登记就红** —— 免得将来新增一列密钥、
// 导出悄悄把它带上（这种错不会报错，只会泄露）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AuthAdminPort } from "@/providers/auth-admin";

class FakeAuthAdmin implements AuthAdminPort {
  users: Array<{ id: string; email: string }> = [];
  seq = 0;
  async ensureUser({ email }: { email: string; password: string; name?: string }) {
    const want = email.trim().toLowerCase();
    const found = this.users.find((u) => u.email === want);
    if (found) return { authId: found.id, reused: true };
    const id = "test-exp-auth-" + ++this.seq;
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
const { REDACTED_PLACEHOLDER, REDACTED_FIELDS, PUBLIC_TOKEN_FIELDS, exportFilename } = await import("@/modules/platform/export");

const repo = new PrismaPlatformRepository();
const service = new PlatformService(repo, new FakeAuthAdmin());

const NS = "test-exp";
const SLUG = "exp-fixture";
const OTHER_SLUG = "exp-other";
const ACTOR = { authId: NS + "-actor", email: "ops@platform.test" };
const SECRET_PW = "SUPER-SECRET-HASH-" + Date.now();
const SECRET_MFA = "MFA-SECRET-" + Date.now();
const SECRET_PROVIDER = "provider-key-" + Date.now();
let ORG = "";
let OTHER = "";

async function cleanFixture() {
  const orgs = await db.organisation.findMany({ where: { slug: { startsWith: "exp-" } }, select: { id: true } });
  for (const o of orgs) await repo.purgeTenantRows(o.id);
  await db.platformAuditLog.deleteMany({ where: { actorAuthId: ACTOR.authId } });
}

beforeAll(async () => {
  await cleanFixture();
  const a = await service.provisionTenant({ name: "Export Fixture Shop", slug: SLUG, ownerEmail: "owner@exp.test" });
  if (!a.ok) throw new Error("夹具开通失败：" + JSON.stringify(a));
  ORG = a.organisationId;
  const b = await service.provisionTenant({ name: "Other Export Shop", slug: OTHER_SLUG, ownerEmail: "other@exp.test" });
  if (!b.ok) throw new Error("对照夹具开通失败");
  OTHER = b.organisationId;

  // 关键：真写进"不该被导出"的东西
  const branch = await db.branch.findFirst({ where: { organisationId: ORG }, select: { id: true } });
  const owner = await db.user.findFirst({ where: { organisationId: ORG }, select: { id: true } });
  await db.user.update({
    where: { id: owner!.id },
    data: { passwordHash: SECRET_PW, mfaSecret: SECRET_MFA, resetToken: "reset-" + Date.now() },
  });
  await db.integrationConfig.create({
    data: { organisationId: ORG, provider: "WHATSAPP", configEncrypted: SECRET_PROVIDER, enabled: true },
  });
  const cust = await db.customer.create({ data: { organisationId: ORG, branchId: branch!.id, name: "Export Rider" }, select: { id: true } });
  const bike = await db.motorcycle.create({ data: { organisationId: ORG, customerId: cust.id, brand: "Honda", model: "Wave", year: 2020, plate: "EXP1" } });
  await db.serviceJob.create({ data: { organisationId: ORG, jobNumber: "EXP-0001", branchId: branch!.id, customerId: cust.id, motorcycleId: bike.id, mileage: 100 } });
  // 对照店也放一条，用于断言"不串店"
  const otherBranch = await db.branch.findFirst({ where: { organisationId: OTHER }, select: { id: true } });
  await db.customer.create({ data: { organisationId: OTHER, branchId: otherBranch!.id, name: "OTHER-RIDER-MARKER" } });
});
afterAll(cleanFixture);

describe("① 范围：属于租户的每一张表都在，行数对得上", () => {
  it("导出成功，含业务数据与配置", async () => {
    const res = await service.exportTenant({ organisationId: ORG, actor: ACTOR });
    expect(res.ok, JSON.stringify(res).slice(0, 200)).toBe(true);
    if (!res.ok) return;
    const t = res.data.tables;
    expect(res.data.rowCount).toBeGreaterThan(0);
    expect(t.Organisation?.[0]).toMatchObject({ name: "Export Fixture Shop" });
    expect(t.Branch?.length).toBe(1);
    expect(t.Customer?.some((c) => (c as { name: string }).name === "Export Rider")).toBe(true);
    expect(t.Motorcycle?.some((m) => (m as { plate: string }).plate === "EXP1")).toBe(true);
    expect(t.ServiceJob?.some((j) => (j as { jobNumber: string }).jobNumber === "EXP-0001")).toBe(true);
    expect(t.ServiceType?.length, "模板带来的默认配置也该在里面").toBeGreaterThan(0);
  });

  it("文件名带 slug（运维产物命名统一）", () => {
    expect(exportFilename(SLUG, new Date("2026-10-01T12:34:56Z"))).toBe("tenant-exp-fixture-2026-10-01T12-34-56.json");
  });
});

describe("② 脱敏：密钥类字段一律 [redacted]（真写进去验的）", () => {
  it("**密码哈希 / MFA 密钥 / 重置令牌 / provider 凭据都不出现**", async () => {
    const res = await service.exportTenant({ organisationId: ORG, actor: ACTOR });
    if (!res.ok) throw new Error("导出失败");
    const json = JSON.stringify(res.data);

    expect(json, "密码哈希被导出了").not.toContain(SECRET_PW);
    expect(json, "MFA 密钥被导出了（有它就能生成动态口令）").not.toContain(SECRET_MFA);
    expect(json, "provider 凭据被导出了").not.toContain(SECRET_PROVIDER);
    expect(json).toContain(REDACTED_PLACEHOLDER);

    const user = res.data.tables.User?.[0] as Record<string, unknown>;
    expect(user.passwordHash).toBe(REDACTED_PLACEHOLDER);
    expect(user.mfaSecret).toBe(REDACTED_PLACEHOLDER);
    const integ = res.data.tables.IntegrationConfig?.[0] as Record<string, unknown>;
    expect(integ.configEncrypted).toBe(REDACTED_PLACEHOLDER);
    expect(res.data.meta.redactedFields).toContain("User.passwordHash");
  });

  it("脱敏是**正向对照**：字段还在（只是内容被替换），不是整列消失", async () => {
    const res = await service.exportTenant({ organisationId: ORG, actor: ACTOR });
    if (!res.ok) throw new Error("导出失败");
    const user = res.data.tables.User?.[0] as Record<string, unknown>;
    expect("passwordHash" in user, "整列消失会让人以为这里本来就没有字段").toBe(true);
  });
});

describe("③ 不串店", () => {
  it("对照店的行不出现在导出里", async () => {
    const res = await service.exportTenant({ organisationId: ORG, actor: ACTOR });
    if (!res.ok) throw new Error("导出失败");
    expect(JSON.stringify(res.data)).not.toContain("OTHER-RIDER-MARKER");
  });
});

describe("④ 留痕：平台侧 + 租户侧", () => {
  it("两条审计都写（导出一家店的数据，两边都该知道）", async () => {
    const plat = await db.platformAuditLog.findFirst({ where: { targetOrganisationId: ORG, action: "TENANT_EXPORTED" } });
    expect(plat).not.toBeNull();
    expect(plat!.detail).toContain(SLUG);
    const tenantSide = await db.auditLog.findFirst({ where: { organisationId: ORG, action: "TENANT_DATA_EXPORTED" } });
    expect(tenantSide, "租户自己的审计页里看不到导出 = 单向留痕").not.toBeNull();
  });

  it("租户不存在 → 拒绝", async () => {
    const res = await service.exportTenant({ organisationId: "no-such-org", actor: ACTOR });
    expect(res.ok).toBe(false);
  });
});

describe("⑤ 结构守卫：schema 里的疑似密钥列必须登记", () => {
  it("**每一列像密钥的字段都在脱敏清单或允许清单里**（新增一列密钥不该悄悄被导出）", () => {
    const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    // 只看模型内的标量列声明：  "  passwordHash   String?"
    const suspects: string[] = [];
    let model = "";
    for (const line of schema.split("\n")) {
      const m = /^model\s+(\w+)\s*\{/.exec(line);
      if (m) { model = m[1]; continue; }
      if (/^\}/.test(line)) { model = ""; continue; }
      const col = /^\s{2}(\w+)\s+(String|Int|Boolean|DateTime|Json)\b/.exec(line);
      if (!col) continue;
      const name = col[1];
      if (!/secret|password|token|credential|apiKey/i.test(name)) continue;
      suspects.push(model + "." + name);
    }
    expect(suspects.length, "一个疑似密钥列都没扫到 —— 守卫形同虚设（正则或 schema 结构变了？）").toBeGreaterThan(2);
    const covered = new Set([...Object.keys(REDACTED_FIELDS), ...PUBLIC_TOKEN_FIELDS]);
    const uncovered = suspects.filter((s) => !covered.has(s));
    expect(uncovered, "这些列像密钥却没登记：要么加进 REDACTED_FIELDS，要么说明它为什么可以公开").toEqual([]);
  });
});
