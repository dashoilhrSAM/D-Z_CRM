import { randomBytes } from "node:crypto";
import type { IPlatformRepository, ProvisionTenantRows, SupportGrantRow } from "@/modules/platform/repository";
import { PrismaPlatformRepository } from "@/repositories/prisma/platform.repository";
import type { AuthAdminPort } from "@/providers/auth-admin";
import { supabaseAuthAdmin } from "@/providers/auth-admin";
import { randomToken } from "@/lib/random-token";

/**
 * P4 · 开店（`provisionTenant`）—— 把"能隔离"变成"能开店"的那一步。
 *
 * 一家店开起来要同时成立四件事，缺一件都是半成品：
 *   ① `Organisation`（slug 是它的运营句柄：`/t/<slug>`、备份/导出命名、日志）
 *   ② 唯一 `Branch`（P5 之前产品仍需要一条主店记录）
 *   ③ 店主 `User` + **Supabase auth 账号**（没有 auth 就没有登录）
 *   ④ **`AuthLink`**（P3b 之后"这个人属于哪几家店"的唯一事实来源 ——
 *      少了它，店主登录后会落到"没有业务身份"，而且报错与真实原因无关）
 * 再加默认配置（服务目录/线索来源与阶段/消息模板/预约时段/库位），
 * 否则新店进去是空壳，每个新客户都要手工配一遍。
 *
 * ⚠️ **刻意不提供 HTTP 入口**：这一步只有 CLI（`scripts/provision-tenant.ts`）。
 * 管理台（`/platform/*`）与平台管理员身份模型是 P4 的下一块 ——
 * 在身份模型定下来之前，任何"网页上点一下就能建租户"的入口都是不必要的攻击面。
 */
export interface ProvisionTenantInput {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerName?: string;
  /** 不传则生成临时密码并回传（只回传一次） */
  ownerPassword?: string;
  city?: string;
  address?: string;
  phone?: string;
  email?: string;
  currency?: string;
  timezone?: string;
  /** 给天数 → 新店以 TRIAL 开始并记录到期时间 */
  trialDays?: number;
  /** 跳过默认配置（只建组织/门店/店主；测试或特殊店用） */
  skipDefaults?: boolean;
}

export interface ProvisionTenantSuccess {
  ok: true;
  organisationId: string;
  branchId: string;
  ownerUserId: string;
  slug: string;
  status: string;
  /** 店主登录邮箱 */
  ownerEmail: string;
  /** 新建 auth 账号时才有（复用老账号时为 undefined） */
  tempPassword?: string;
  /** 复用了已存在的 auth 账号 → 这是个跨店账号（登录会出现选择器） */
  reusedAuthAccount: boolean;
  /** 开通链接（发给店主） */
  entryUrl: string;
  /** 门店码（贴在店里，扫码进店） */
  workshopQrUrl: string | null;
  counts: { serviceTypes: number; leadSources: number; leadStages: number; messageTemplates: number; slots: number };
  warnings: string[];
}

export interface ProvisionTenantFailure {
  ok: false;
  error: string;
  /** 给 CLI 用的机器可读原因 */
  code: "INVALID_SLUG" | "INVALID_NAME" | "INVALID_EMAIL" | "SLUG_TAKEN" | "AUTH_EXISTS_IN_TENANT" | "AUTH_UNAVAILABLE" | "DB_FAILED";
}

export type ProvisionTenantResult = ProvisionTenantSuccess | ProvisionTenantFailure;

/** 支持访问的时长上下限：限时是这个能力的前提，所以边界写在服务层而不是 UI。 */
export const MIN_SUPPORT_MINUTES = 5;
export const MAX_SUPPORT_MINUTES = 480;

/** 租户状态。`SUSPENDED` = 停用（入口与已登录会话都立刻失去访问）。 */
export const TENANT_STATUSES = ["ACTIVE", "TRIAL", "SUSPENDED"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

/** slug 的规则：它会进 URL（`/t/<slug>`）与运维产物命名，所以只允许小写字母数字与连字符。 */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
/** 保留字：留给自己将来的路由，别让第一家店的链接把命名空间占死。 */
const RESERVED_SLUGS = new Set(["t", "qr", "login", "logout", "platform", "api", "admin", "www", "new", "static", "public"]);

/** 纯校验：可单测，也可在 CLI 里先跑一遍给出更好的提示。 */
export function validateProvisionInput(input: Pick<ProvisionTenantInput, "name" | "slug" | "ownerEmail">): ProvisionTenantFailure | null {
  if (RESERVED_SLUGS.has(input.slug)) {
    return { ok: false, code: "INVALID_SLUG", error: `slug "${input.slug}" 是保留字（${[...RESERVED_SLUGS].join("/")}）` };
  }
  if (!SLUG_PATTERN.test(input.slug)) {
    return { ok: false, code: "INVALID_SLUG", error: "slug 只能是小写字母/数字/连字符，2–48 位，且首尾必须是字母或数字（示例：d-z-smart-workshop）" };
  }
  if (!input.name.trim() || input.name.trim().length > 80) {
    return { ok: false, code: "INVALID_NAME", error: "店名必填且不超过 80 字" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.ownerEmail)) {
    return { ok: false, code: "INVALID_EMAIL", error: "店主邮箱格式不对（它同时是登录账号）" };
  }
  return null;
}

const DEFAULT_SERVICE_TYPES = [
  { name: "General Service", code: "SVC-GEN", category: "SERVICE", durationMin: 60, priceSen: 8000 },
  { name: "Engine Oil Change", code: "SVC-OIL", category: "SERVICE", durationMin: 30, priceSen: 4500 },
  { name: "Tyre Replace", code: "SVC-TYRE", category: "SERVICE", durationMin: 40, priceSen: 6000 },
  { name: "Full Inspection", code: "SVC-INSPECT", category: "SERVICE", durationMin: 45, priceSen: 3000 },
];
const DEFAULT_LEAD_SOURCES = ["Walk-in", "WhatsApp", "Facebook", "Referral", "Phone"];
const DEFAULT_LEAD_STAGES = ["New", "Contacted", "Quoted", "Won", "Lost"];
const DEFAULT_TEMPLATES = [
  { name: "Booking reminder", body: "Hi {{name}}, reminder for your appointment on {{date}} {{time}}. Reply to reschedule." },
  { name: "Job completed", body: "Hi {{name}}, your {{bike}} is ready for collection. Total {{amount}}." },
  { name: "Service due", body: "Hi {{name}}, your {{bike}} is due for service. Book here: {{link}}" },
];
const SLOT_TIMES = ["09:00", "11:00", "14:00", "16:00"];

/** 生成临时密码：够强（大小写+数字+符号），店主登录后应自行修改。 */
export function generateTempPassword(): string {
  return "Dz" + randomBytes(6).toString("base64url").replace(/[-_]/g, "x") + "!7";
}

export class PlatformService {
  constructor(
    private repo: IPlatformRepository = new PrismaPlatformRepository(),
    private authAdmin: AuthAdminPort = supabaseAuthAdmin,
  ) {}

  // ---------------------------------------------------------------------
  // 平台管理员（P4 第二块）：**与租户内的角色完全无关**
  // ---------------------------------------------------------------------

  /**
   * 这个人是不是平台管理员 —— 鉴权只认 `PlatformAdmin.authId`。
   *
   * ⚠️ 刻意**不**看租户角色：OWNER/MANAGER 再大也只是"一家店里最大"，
   * 让他们天然拥有跨店管理权，等于把整套租户隔离从后门打开。
   * `role-modules.ts` 那张矩阵管的是"在一家店里能做什么模块"，是另一条轴。
   */
  async adminFor(authId: string | null | undefined) {
    if (!authId) return null;
    return this.repo.findAdmin(authId);
  }

  listAdmins() {
    return this.repo.listAdmins();
  }

  /** 授予以邮箱为准（**找不到人就拒绝，绝不顺手建号**）—— 手滑打错一个字母不该造出账号。 */
  async grantAdminByEmail(email: string, opts: { note?: string; createdBy?: string } = {}) {
    const found = await this.authAdmin.findByEmail(email);
    if (!found) return { ok: false as const, error: `找不到邮箱为 ${email} 的登录账号（先让他自己注册/由开通流程创建，再授权）` };
    const row = await this.repo.upsertAdmin({ authId: found.authId, email: found.email, note: opts.note ?? null, createdBy: opts.createdBy ?? null });
    return { ok: true as const, admin: row };
  }

  /** 直接用 authId 授予（auth 服务不可用时的兜底；CLI 与邮箱二选一）。 */
  async grantAdminByAuthId(authId: string, opts: { email?: string; note?: string; createdBy?: string } = {}) {
    const row = await this.repo.upsertAdmin({ authId, email: opts.email ?? null, note: opts.note ?? null, createdBy: opts.createdBy ?? null });
    return { ok: true as const, admin: row };
  }

  revokeAdmin(authId: string) {
    return this.repo.removeAdmin(authId);
  }

  /** 按邮箱在**名单里**找（撤销时用；与"去 auth 找人"是两件事）。 */
  async adminForEmailLookup(email: string) {
    const want = email.trim().toLowerCase();
    const rows = await this.repo.listAdmins();
    return rows.find((r) => (r.email ?? "").toLowerCase() === want) ?? null;
  }

  // ---------------------------------------------------------------------
  // 租户状态：停用 / 恢复（P4 第三块）
  // ---------------------------------------------------------------------

  /**
   * 改一家店的状态。**停用必须是立刻生效的** —— 这一点靠两处：
   *   ① 入口链（`resolveEntryTenant*`）本来就不认非运营状态；
   *   ② `identitiesForAuthUser` 会把非运营租户的身份过滤掉，
   *      于是**已经登录的人下一次请求就失去业务身份**，不必等他登出。
   *
   * 写一条平台审计（append-only，跨租户）：谁、什么时候、把哪家店、因为什么停掉。
   * 状态没变化时不写审计（避免手抖点两次留下两条"停用"）。
   */
  async setTenantStatus(input: {
    organisationId: string;
    status: TenantStatus;
    actor: { authId: string; email?: string | null };
    reason?: string;
  }): Promise<{ ok: true; before: string; after: TenantStatus; changed: boolean } | { ok: false; error: string }> {
    if (!TENANT_STATUSES.includes(input.status)) {
      return { ok: false, error: `状态只能是 ${TENANT_STATUSES.join(" / ")}` };
    }
    const tenant = await this.repo.getTenant(input.organisationId);
    if (!tenant) return { ok: false, error: "租户不存在" };
    if (tenant.status === input.status) return { ok: true, before: tenant.status, after: input.status, changed: false };

    const before = await this.repo.setOrganisationStatus(input.organisationId, input.status);
    await this.repo.appendAudit({
      actorAuthId: input.actor.authId,
      actorEmail: input.actor.email ?? null,
      action: input.status === "SUSPENDED" ? "TENANT_SUSPENDED" : "TENANT_RESUMED",
      targetOrganisationId: input.organisationId,
      detail: (input.reason ?? "").trim() || null,
    });
    return { ok: true, before, after: input.status, changed: true };
  }

  /** 租户详情 + 它的审计轨迹（详情页用）。 */
  async tenantDetail(slug: string) {
    const row = await this.repo.findBySlug(slug);
    if (!row) return null;
    const tenant = await this.repo.getTenant(row.id);
    if (!tenant) return null;
    const [audit, tenants] = await Promise.all([
      this.repo.listAudit({ organisationId: tenant.id, limit: 20 }),
      this.repo.listTenants(),
    ]);
    const counts = tenants.find((t) => t.id === tenant.id);
    return { tenant, audit, usage: { staff: counts?.staff ?? 0, customers: counts?.customers ?? 0 } };
  }

  listAudit(opts: { organisationId?: string; limit?: number } = {}) {
    return this.repo.listAudit(opts);
  }

  // ---------------------------------------------------------------------
  // 限时支持访问（P4 第三块）：双向留痕
  // ---------------------------------------------------------------------

  /**
   * 授予自己一段**限时**的支持访问权。
   *
   * 为什么是"授予自己而不是别人"：这个能力的现实形态就是"运维要看一眼这家店为什么坏了"，
   * 中间隔一道审批只会让人绕过它。所以约束放在**别处**：必须写原因、必须有期限、
   * **必须让租户看得见**（租户审计里留痕）、随时可撤销，而且只能看只读快照。
   */
  async grantSupportAccess(input: {
    organisationId: string;
    actor: { authId: string; email?: string | null };
    reason: string;
    minutes: number;
    now?: Date;
  }): Promise<{ ok: true; grant: SupportGrantRow } | { ok: false; error: string }> {
    const reason = (input.reason ?? "").trim();
    if (reason.length < 4) return { ok: false, error: "必须写清楚支持访问的原因（至少 4 个字）—— 这是审计的第一性问题" };
    if (!Number.isFinite(input.minutes) || input.minutes < MIN_SUPPORT_MINUTES || input.minutes > MAX_SUPPORT_MINUTES) {
      return { ok: false, error: `时长必须在 ${MIN_SUPPORT_MINUTES}–${MAX_SUPPORT_MINUTES} 分钟之间（限时是这个能力的前提）` };
    }
    const tenant = await this.repo.getTenant(input.organisationId);
    if (!tenant) return { ok: false, error: "租户不存在" };

    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + input.minutes * 60_000);
    const grant = await this.repo.createSupportGrant({
      organisationId: input.organisationId,
      grantedByAuthId: input.actor.authId,
      grantedByEmail: input.actor.email ?? null,
      reason,
      expiresAt,
    });

    await this.repo.appendAudit({
      actorAuthId: input.actor.authId,
      actorEmail: input.actor.email ?? null,
      action: "SUPPORT_GRANTED",
      targetOrganisationId: input.organisationId,
      detail: `${input.minutes} 分钟 · ${reason}`,
    });
    // 双向留痕的另一半：租户在自己的审计页上就能看到"平台在什么时候被允许看过我"
    await this.repo.auditForTenant({
      organisationId: input.organisationId,
      action: "SUPPORT_ACCESS_GRANTED",
      entity: "SupportGrant",
      entityId: grant.id,
      detail: `平台支持访问 ${input.minutes} 分钟：${reason}`,
    });
    return { ok: true, grant };
  }

  /** 当前**有效**的授权（服务端判过期/撤销，不依赖 UI）。按人 —— 只有被授权的那个人能用。 */
  async activeSupportAccess(organisationId: string, authId: string, now = new Date()) {
    return this.repo.findActiveSupportGrant(organisationId, authId, now);
  }

  async revokeSupportAccess(input: { organisationId: string; actor: { authId: string; email?: string | null }; now?: Date }) {
    const at = input.now ?? new Date();
    const count = await this.repo.revokeSupportGrants(input.organisationId, input.actor.authId, at);
    if (count > 0) {
      await this.repo.appendAudit({
        actorAuthId: input.actor.authId, actorEmail: input.actor.email ?? null,
        action: "SUPPORT_REVOKED", targetOrganisationId: input.organisationId, detail: `撤销 ${count} 条`,
      });
      await this.repo.auditForTenant({
        organisationId: input.organisationId, action: "SUPPORT_ACCESS_REVOKED", entity: "SupportGrant", detail: "平台提前结束了支持访问",
      });
    }
    return count;
  }

  /**
   * 记一次"平台人员看了这家店的数据"。**每次查看都记**（两条：平台侧 + 租户侧）——
   * 审计的价值就在"每一次都留得下来"；写放大在这里是特性不是 bug。
   */
  async logSupportView(input: { organisationId: string; actor: { authId: string; email?: string | null }; detail?: string; now?: Date }) {
    await this.repo.appendAudit({
      actorAuthId: input.actor.authId, actorEmail: input.actor.email ?? null,
      action: "SUPPORT_VIEWED", targetOrganisationId: input.organisationId, detail: input.detail ?? null,
    });
    await this.repo.auditForTenant({
      organisationId: input.organisationId, action: "SUPPORT_ACCESS_VIEWED", entity: "SupportGrant",
      detail: (input.actor.email ?? "平台人员") + " 查看了本店数据（只读）",
    });
  }

  listSupportGrants(organisationId: string, limit = 20) {
    return this.repo.listSupportGrants(organisationId, limit);
  }

  /** 支持会话里能看到的只读快照（白名单见适配器）。 */
  supportSnapshot(organisationId: string) {
    return this.repo.supportSnapshot(organisationId);
  }

  /**
   * 记一次"他来过平台台"。**带节流**：每次渲染都写库是没必要的写放大，
   * 一小时内有记录就不再写。
   */
  async touchAdmin(authId: string, now = new Date()) {
    const row = await this.repo.findAdmin(authId);
    if (!row) return;
    if (row.lastSeenAt && now.getTime() - row.lastSeenAt.getTime() < 3600_000) return;
    await this.repo.touchAdmin(authId, now);
  }

  /** 租户目录（管理台第一屏的数据源）。 */
  listTenants() {
    return this.repo.listTenants();
  }

  /**
   * 开一家店。顺序是刻意的：**先 auth、后业务行**。
   * 反过来（先建组织、再建 auth）一旦 auth 失败，库里就留下一家"存在但没人登录得进去"的店 ——
   * 这种半成品运维只能靠肉眼发现。而反过来失败只留下一个没人用的 auth 账号（无害，且可复用）。
   */
  async provisionTenant(input: ProvisionTenantInput): Promise<ProvisionTenantResult> {
    const invalid = validateProvisionInput(input);
    if (invalid) return invalid;

    const existing = await this.repo.findBySlug(input.slug);
    if (existing) {
      return { ok: false, code: "SLUG_TAKEN", error: `slug "${input.slug}" 已被「${existing.name}」占用（slug 是运营句柄，不复用）` };
    }

    // ① 认证账号：能建就建，已存在则**复用**（同一个人可以同时是 A 店骑手、B 店店主）。
    //    走 provider 端口而不是直接连 Supabase —— 见 src/providers/auth-admin.ts 的说明
    //    （service role 的模块带 server-only，脚本 import 不了，而开店必须能由 CLI 跑）。
    const ownerEmail = input.ownerEmail.trim().toLowerCase();
    const tempPassword = input.ownerPassword ?? generateTempPassword();
    let authId: string;
    let reusedAuthAccount: boolean;
    try {
      const ensured = await this.authAdmin.ensureUser({ email: ownerEmail, password: tempPassword, name: input.ownerName ?? input.name });
      authId = ensured.authId;
      reusedAuthAccount = ensured.reused;
    } catch (e) {
      return { ok: false, code: "AUTH_UNAVAILABLE", error: "认证服务不可用：" + String((e as Error).message).slice(0, 160) };
    }

    // ② 一次事务写完：组织 + 主店 + 店主 + AuthLink + 默认配置 + 预约时段
    const warnings: string[] = [];
    const trial = typeof input.trialDays === "number" && input.trialDays > 0;
    const rows: ProvisionTenantRows = {
      slug: input.slug,
      organisation: {
        name: input.name.trim(),
        status: trial ? "TRIAL" : "ACTIVE",
        trialEndsAt: trial ? new Date(Date.now() + input.trialDays! * 86400000) : null,
        qrToken: randomToken(),
        currency: input.currency ?? "MYR",
        timezone: input.timezone ?? "Asia/Kuala_Lumpur",
        address: input.address ?? null,
        contactPhone: input.phone ?? null,
        contactEmail: input.email ?? ownerEmail,
        operatingHours: JSON.stringify({ mon: "09:00-19:00", tue: "09:00-19:00", wed: "09:00-19:00", thu: "09:00-19:00", fri: "09:00-19:00", sat: "09:00-18:00", sun: "Closed" }),
      },
      branch: {
        name: input.name.trim(),
        city: input.city ?? "",
        address: input.address ?? null,
        phone: input.phone ?? null,
        isMain: true,
        appointmentCapacity: 2,
        operatingHours: JSON.stringify({ mon: "09:00-19:00", tue: "09:00-19:00", wed: "09:00-19:00", thu: "09:00-19:00", fri: "09:00-19:00", sat: "09:00-18:00", sun: "Closed" }),
      },
      owner: {
        name: input.ownerName?.trim() || input.name.trim() + " Owner",
        email: ownerEmail,
        role: "OWNER",
        authId,
        branchId: null,
      },
      authId,
      defaults: input.skipDefaults
        ? { serviceTypes: [], leadSources: [], leadStages: [], messageTemplates: [] }
        : {
            serviceTypes: DEFAULT_SERVICE_TYPES,
            leadSources: DEFAULT_LEAD_SOURCES.map((name) => ({ name })),
            leadStages: DEFAULT_LEAD_STAGES.map((name, i) => ({ name, order: i })),
            messageTemplates: DEFAULT_TEMPLATES,
          },
      slots: input.skipDefaults ? [] : buildSlots(),
    };

    let provisioned;
    try {
      provisioned = await this.repo.provision(rows);
    } catch (e) {
      return { ok: false, code: "DB_FAILED", error: "建店失败（已回滚）：" + String((e as Error).message).slice(0, 200) };
    }

    // ③ 跨店账号提醒：他属于多家店 → 登录时会出现门店选择器（不是错误，但运维要知道）
    const tenants = await this.repo.tenantCountForAuth(authId);
    if (tenants > 1) {
      warnings.push(`${ownerEmail} 现在属于 ${tenants} 家店 —— 他登录时会先看到门店选择器（P3b 行为，正常）`);
    }

    const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://d-z-crm.vercel.app";
    return {
      ok: true,
      organisationId: provisioned.organisationId,
      branchId: provisioned.branchId,
      ownerUserId: provisioned.ownerUserId,
      slug: input.slug,
      status: rows.organisation.status as string,
      ownerEmail,
      tempPassword: reusedAuthAccount ? undefined : tempPassword,
      reusedAuthAccount,
      entryUrl: `${base}/t/${input.slug}`,
      workshopQrUrl: provisioned.qrToken ? `${base}/qr/workshop/${provisioned.qrToken}` : null,
      counts: {
        serviceTypes: rows.defaults.serviceTypes.length,
        leadSources: rows.defaults.leadSources.length,
        leadStages: rows.defaults.leadStages.length,
        messageTemplates: rows.defaults.messageTemplates.length,
        slots: rows.slots.length,
      },
      warnings,
    };
  }
}

/** 预约时段：从今天起 7 天 × 每天 4 个时段（与既有开通脚本同一口径，避免两家店规则不同）。 */
function buildSlots(days = 7): Array<{ date: Date; startTime: string; maxBookings: number }> {
  const out: Array<{ date: Date; startTime: string; maxBookings: number }> = [];
  for (let d = 0; d < days; d++) {
    const date = new Date(Date.now() + d * 86400000);
    date.setUTCHours(0, 0, 0, 0);
    for (const startTime of SLOT_TIMES) out.push({ date, startTime, maxBookings: 2 });
  }
  return out;
}

export const platformService = new PlatformService();
