// P4 第二块：平台管理员的身份模型（`PlatformAdmin` 表）+ `/platform` 守卫。
//
// 这一层守的是一句话：**"在一家店里最大"不等于"能跨店管理"**。
// 所以最要紧的断言不是"管理员能进"，而是：
//   · 租户里的 OWNER（甚至 SUPER_ADMIN 角色）**不是**平台管理员；
//   · 授予只走 `PlatformAdmin` 表，按邮箱授予时**只找不建**（手滑打错字母不该造出账号）；
//   · 撤销之后立刻失效（不是"缓存里的名单"）；
//   · `/platform` 的每个入口（layout + 每个 action）都必须过守卫 —— 结构守卫钉住，
//     因为"渲染被挡住了但 action 能直接 POST"是这类后台最典型的漏法。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AuthAdminPort } from "@/providers/auth-admin";

/** 假认证端口：有则复用、无则建；`findByEmail` 只找不建（与真实实现同语义）。 */
class FakeAuthAdmin implements AuthAdminPort {
  users = [{ id: "auth-known-admin", email: "admin@platform.test" }];
  seq = 0;
  async ensureUser({ email }: { email: string; password: string; name?: string }) {
    const want = email.trim().toLowerCase();
    const found = this.users.find((u) => u.email === want);
    if (found) return { authId: found.id, reused: true };
    const id = "test-plat-auth-" + ++this.seq;
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

const TAG = Date.now().toString(36);
const ADMIN_AUTH = "test-plat-admin-" + TAG;
const OWNER_AUTH = "test-plat-owner-" + TAG;
const TENANT_SLUG = "plat-" + TAG;

beforeAll(async () => {
  await cleanAdmins();
});

/** 按**夹具自己的命名空间**清理（`test-plat-` 前缀 + 假端口生成的号）——
 *  自愈：哪次跑偏留下的行不会让后面的断言长期假红（本项目踩过这个坑）。 */
async function cleanAdmins() {
  await db.platformAdmin.deleteMany({
    where: { OR: [{ authId: { startsWith: "test-plat-" } }, { authId: "auth-known-admin" }] },
  });
}

afterAll(async () => {
  // 铁律：只清自己造的行（按夹具命名空间收窄，绝不用全表 count/delete）
  await cleanAdmins();
  const org = await db.organisation.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (org) await repo.dropTenant(org.id);
});

describe("① 判定只认 PlatformAdmin 表", () => {
  it("匿名 / 空 authId → 不是管理员", async () => {
    expect(await service.adminFor(null)).toBeNull();
    expect(await service.adminFor(undefined)).toBeNull();
    expect(await service.adminFor("")).toBeNull();
  });

  it("表里有行才算；撤销后立刻失效", async () => {
    expect(await service.adminFor(ADMIN_AUTH)).toBeNull();
    await service.grantAdminByAuthId(ADMIN_AUTH, { email: "ops@platform.test", note: "运维" });
    const row = await service.adminFor(ADMIN_AUTH);
    expect(row?.note).toBe("运维");
    expect(await service.revokeAdmin(ADMIN_AUTH)).toBe(true);
    expect(await service.adminFor(ADMIN_AUTH), "撤销后还认，等于没撤").toBeNull();
  });

  it("**租户里的 OWNER 不是平台管理员**（有 staff 身份 ≠ 能跨店管理）", async () => {
    // 造一家店和一个带 authId 的 OWNER —— 他在自己的店里权限最大
    const res = await service.provisionTenant({ name: "Platform Guard Shop", slug: TENANT_SLUG, ownerEmail: "owner." + TAG + "@platform.test" });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const org = await db.organisation.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
    await db.user.updateMany({ where: { organisationId: org!.id, role: "OWNER" }, data: { authId: OWNER_AUTH } });

    expect(await service.adminFor(OWNER_AUTH), "OWNER 天然拥有跨店管理权 = 租户隔离被从后门打开").toBeNull();
  });
});

describe("② 授予 / 撤销", () => {
  it("按邮箱授予：找得到就授予，并记下是谁给的", async () => {
    const res = await service.grantAdminByEmail("admin@platform.test", { note: "第一位", createdBy: "cli-test" });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.admin.email).toBe("admin@platform.test");
    expect(res.admin.createdBy).toBe("cli-test");
  });

  it("**邮箱打错 → 拒绝，且绝不建号**（否则手滑就造出一个账号）", async () => {
    const before = await db.platformAdmin.count({ where: { authId: "auth-known-admin" } });
    const res = await service.grantAdminByEmail("admin@platform.tets"); // 故意打错
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("找不到");
    expect(await db.platformAdmin.count({ where: { authId: "auth-known-admin" } })).toBe(before);
  });

  it("重复授予是幂等的（只更新备注，不新增行）", async () => {
    const rows = await db.platformAdmin.findMany({ where: { authId: "auth-known-admin" } });
    expect(rows).toHaveLength(1);
    await service.grantAdminByEmail("admin@platform.test", { note: "改了备注" });
    const after = await db.platformAdmin.findMany({ where: { authId: "auth-known-admin" } });
    expect(after).toHaveLength(1);
    expect(after[0].note).toBe("改了备注");
  });

  it("按名单邮箱撤销（不需要去 auth 找人）", async () => {
    const found = await service.adminForEmailLookup("admin@platform.test");
    expect(found).not.toBeNull();
    expect(await service.revokeAdmin(found!.authId)).toBe(true);
    expect(await service.adminForEmailLookup("admin@platform.test")).toBeNull();
  });
});

describe("③ 来过就留痕，但不做写放大", () => {
  it("首次记录 lastSeenAt；一小时内不再写；超过一小时才更新", async () => {
    await service.grantAdminByAuthId(ADMIN_AUTH, { note: "留痕测试" });
    // 注意：这里刻意用 test-plat- 命名空间，cleanAdmins 能自愈
    const t0 = new Date("2026-10-01T00:00:00Z");
    await service.touchAdmin(ADMIN_AUTH, t0);
    expect((await service.adminFor(ADMIN_AUTH))!.lastSeenAt?.toISOString()).toBe(t0.toISOString());

    // 30 分钟后：不该覆盖
    await service.touchAdmin(ADMIN_AUTH, new Date(t0.getTime() + 1800_000));
    expect((await service.adminFor(ADMIN_AUTH))!.lastSeenAt?.toISOString()).toBe(t0.toISOString());

    // 两小时后：更新
    const t2 = new Date(t0.getTime() + 7200_000);
    await service.touchAdmin(ADMIN_AUTH, t2);
    expect((await service.adminFor(ADMIN_AUTH))!.lastSeenAt?.toISOString()).toBe(t2.toISOString());
  });
});

describe("④ 结构守卫：平台台的每个入口都过守卫", () => {
  const root = process.cwd();
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const read = (p: string) => strip(readFileSync(path.join(root, p), "utf8"));

  it("layout 判身份（未登录去登录 / 非管理员 404）", () => {
    const src = read("src/app/platform/layout.tsx");
    expect(src).toContain("requirePlatformAdmin()");
    expect(src, "非管理员必须 404（不要确认这个路由存在）").toContain("notFound()");
    expect(src).toContain("redirect(");
  });

  it("**每个** server action 都自己再判一次（layout 挡不住直接 POST）", () => {
    const src = read("src/app/platform/actions.ts");
    const actions = src.match(/export async function \w+\(/g) ?? [];
    expect(actions.length, "一个 action 都没扫到 —— 守卫形同虚设").toBeGreaterThanOrEqual(1);
    const guarded = src.match(/requirePlatformAdmin\(\)/g) ?? [];
    expect(guarded.length, "action 数量与守卫调用数对不上，有入口没判身份").toBe(actions.length);
  });

  it("守卫是 server-only（不能进客户端 bundle）", () => {
    expect(read("src/lib/platform/guard.ts").startsWith('import "server-only"')).toBe(true);
  });

  it("客户端表单只 type-import 服务层（不把服务端代码拖进 bundle）", () => {
    const src = readFileSync(path.join(root, "src/components/platform/provision-tenant-form.tsx"), "utf8");
    expect(src.startsWith('"use client"')).toBe(true);
    expect(src, "服务层必须用 import type").toContain('import type { ProvisionTenantResult }');
    expect(src, "别用值导入把服务层拖进客户端").not.toMatch(/import \{[^}]*\} from "@\/modules\/platform\/service"/);
  });
});
