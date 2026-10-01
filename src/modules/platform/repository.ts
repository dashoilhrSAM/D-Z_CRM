import type { Prisma } from "@prisma/client";
import type { DbLike } from "@/modules/customers/repository";

/**
 * 平台域（P4）的仓储接口：**开一家店**要写下去的那几行。
 *
 * 为什么把"建租户"整块放进一个仓储方法而不是在 service 里逐表 create：
 * 它是**一次事务**——Organisation / Branch / User / AuthLink / 默认配置要么全有、要么全无。
 * 半成品最坏的形态不是报错，而是"店建出来了、店主登录不进去"（User 没有 authId）
 * 或者"能登录但店里什么都没有"（默认配置没建），运维得靠肉眼查库才发现。
 */
export interface ProvisionTenantRows {
  /** 租户句柄（唯一键）——**提到顶层**，因为它必须在 `organisation.create` 那一行显式写出来：
   *  平台台/备份命名/日志都以它为准，静态守卫（tests/tenant-isolation-guards.test.ts）也盯着这一行。
   *  类型上从 organisation 输入里 Omit 掉，杜绝"两处 slug 不一致"。 */
  slug: string;
  organisation: Omit<Prisma.OrganisationCreateInput, "slug">;
  branch: Omit<Prisma.BranchCreateInput, "organisation">;
  owner: Omit<Prisma.UserCreateInput, "organisation" | "branch"> & { branchId: string | null };
  authId: string;
  /** 默认配置（跟着租户一起建，缺一条都算开通失败）。organisationId 由仓储补 —— 调用方不该关心它。 */
  defaults: {
    serviceTypes: Array<Omit<Prisma.ServiceTypeCreateManyInput, "organisationId">>;
    leadSources: Array<Omit<Prisma.LeadSourceCreateManyInput, "organisationId">>;
    leadStages: Array<Omit<Prisma.LeadStageCreateManyInput, "organisationId">>;
    messageTemplates: Array<Omit<Prisma.MessageTemplateCreateManyInput, "organisationId">>;
  };
  /** 预约时段（开在当前日期之后的 N 天 × 每天几个时段） */
  slots: Array<{ date: Date; startTime: string; maxBookings: number }>;
}

export interface ProvisionedTenant {
  organisationId: string;
  branchId: string;
  ownerUserId: string;
  qrToken: string | null;
}

/** 平台管理员行（P4）。 */
export interface PlatformAdminRow {
  authId: string;
  email: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
  lastSeenAt: Date | null;
}

/** 平台审计行（P4）。 */
export interface PlatformAuditRow {
  id: string;
  actorAuthId: string;
  actorEmail: string | null;
  action: string;
  targetOrganisationId: string | null;
  detail: string | null;
  createdAt: Date;
}

/** 限时支持访问授权行。 */
export interface SupportGrantRow {
  id: string;
  organisationId: string;
  grantedByAuthId: string;
  grantedByEmail: string | null;
  reason: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface SupportSnapshot {
  counts: { staff: number; customers: number; jobs: number; invoices: number; bookings: number };
  recentJobs: Array<{ jobNumber: string; status: string; customer: string | null; createdAt: Date }>;
  staff: Array<{ name: string; role: string; email: string | null }>;
  tenantAudit: Array<{ action: string; entity: string; detail: string | null; createdAt: Date }>;
}

/** 退租墓碑行。 */
export interface TombstoneRow {
  id: string;
  slug: string;
  name: string;
  purgedAt: Date;
  purgedByAuthId: string;
  purgedByEmail: string | null;
  counts: string | null;
}

/** 自定义模板行（内置模板在代码里，不入库）。 */
export interface TemplateRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  payload: string;
  sourceOrganisationId: string | null;
  createdByAuthId: string;
  createdByEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPlatformRepository {
  // —— 开通模板 ——
  findTemplate(key: string): Promise<TemplateRow | null>;
  listTemplates(): Promise<TemplateRow[]>;
  upsertTemplate(row: { key: string; name: string; description: string | null; payload: string; sourceOrganisationId: string | null; createdByAuthId: string; createdByEmail: string | null }): Promise<TemplateRow>;
  deleteTemplate(key: string): Promise<boolean>;
  /** 把某家店当前的配置读出来（"把店 A 的配置复制给店 B"）。 */
  readTenantConfig(organisationId: string): Promise<{ serviceTypes: unknown[]; leadSources: unknown[]; leadStages: unknown[]; messageTemplates: unknown[] }>;

  /**
   * 退租：按计划把这家店的**每一行**删掉，并在**同一个事务里复核**（还有残留就整体回滚）。
   * `plan` 由 `purge-plan.generated.ts` 提供（scope map × DMMF 推导），不是手写清单。
   */
  purgeTenantRows(organisationId: string): Promise<{ deleted: number; remaining: number }>;
  /**
   * 按租户导出：把这家店的每一行读出来（**密钥类字段脱敏**）。
   * 行范围与退租删除**用的是同一份计划** —— 导出少了行不会报错，只会让人以为数据就这些。
   */
  exportTenantRows(organisationId: string): Promise<{ tables: Record<string, unknown[]>; rowCount: number; redactedFields: string[] }>;
  /** 只读预演：每个模型还剩多少行（UI 上先给人看清楚要删什么）。 */
  countTenantRows(organisationId: string): Promise<Array<{ model: string; rows: number }>>;
  createTombstone(row: { slug: string; name: string; purgedByAuthId: string; purgedByEmail: string | null; counts: string }): Promise<TombstoneRow>;
  findTombstone(slug: string): Promise<TombstoneRow | null>;
  listTombstones(): Promise<TombstoneRow[]>;

  createSupportGrant(row: Omit<SupportGrantRow, "id" | "createdAt" | "revokedAt">): Promise<SupportGrantRow>;
  findActiveSupportGrant(organisationId: string, authId: string, now: Date): Promise<SupportGrantRow | null>;
  revokeSupportGrants(organisationId: string, authId: string, at: Date): Promise<number>;
  listSupportGrants(organisationId: string, limit?: number): Promise<SupportGrantRow[]>;
  /** 平台人员在支持会话里能看到的**只读快照**（白名单式，不做"整个应用"）。 */
  supportSnapshot(organisationId: string): Promise<SupportSnapshot>;
  /** 写租户自己的审计（双向留痕的"租户那一侧"）。 */
  auditForTenant(row: { organisationId: string; action: string; entity: string; entityId?: string | null; detail?: string | null }): Promise<void>;

  /** 改租户状态（只有这一个字段，平台动作不该顺手改别的）。返回改动前的状态。 */
  setOrganisationStatus(organisationId: string, status: string): Promise<string>;
  getTenant(organisationId: string): Promise<{ id: string; name: string; slug: string | null; status: string; createdAt: Date; qrToken: string | null } | null>;
  appendAudit(row: Omit<PlatformAuditRow, "id" | "createdAt">): Promise<PlatformAuditRow>;
  listAudit(opts: { organisationId?: string; limit?: number }): Promise<PlatformAuditRow[]>;

  // —— 平台管理员（与租户完全无关的一张表）——
  findAdmin(authId: string): Promise<PlatformAdminRow | null>;
  listAdmins(): Promise<PlatformAdminRow[]>;
  /** 幂等：已在名单里就只更新备注/邮箱 */
  upsertAdmin(input: { authId: string; email?: string | null; note?: string | null; createdBy?: string | null }): Promise<PlatformAdminRow>;
  removeAdmin(authId: string): Promise<boolean>;
  touchAdmin(authId: string, at: Date): Promise<void>;

  findBySlug(slug: string): Promise<{ id: string; name: string; status: string } | null>;
  /** 一次事务写完；任何一条失败整块回滚。 */
  provision(rows: ProvisionTenantRows): Promise<ProvisionedTenant>;
  /** 该 auth 账号已有的租户（用于判断"这个人是不是已经属于别家店"）。 */
  tenantCountForAuth(authId: string): Promise<number>;
  listTenants(): Promise<Array<{ id: string; name: string; slug: string | null; status: string; createdAt: Date; staff: number; customers: number }>>;
  /** 测试与运维用：按 slug 删掉整家店（含其下所有行）。 */
  dropTenant(organisationId: string): Promise<void>;
  /** 仓储层可选注入事务客户端（与其它仓储同形）。 */
  _client?(client?: DbLike): unknown;
}
