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

export interface IPlatformRepository {
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
