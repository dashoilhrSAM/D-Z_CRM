import { randomBytes } from "node:crypto";
import type { IPlatformRepository, ProvisionTenantRows } from "@/modules/platform/repository";
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
