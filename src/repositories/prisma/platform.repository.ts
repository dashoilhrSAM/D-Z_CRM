import type { PrismaClient } from "@prisma/client";
import type { DbLike } from "@/modules/customers/repository";
import type { IPlatformRepository, ProvisionTenantRows, ProvisionedTenant } from "@/modules/platform/repository";
import { db } from "@/lib/db";

/** 平台域的 Prisma 适配器。层级见 AGENTS.md：UI → Service → Repository → Adapter。 */
export class PrismaPlatformRepository implements IPlatformRepository {
  private c(client?: DbLike): PrismaClient { return (client ?? db) as PrismaClient; }

  findAdmin(authId: string) {
    return this.c().platformAdmin.findUnique({ where: { authId } });
  }

  listAdmins() {
    return this.c().platformAdmin.findMany({ orderBy: { createdAt: "asc" } });
  }

  upsertAdmin(input: { authId: string; email?: string | null; note?: string | null; createdBy?: string | null }) {
    const { authId, ...rest } = input;
    return this.c().platformAdmin.upsert({
      where: { authId },
      create: { authId, ...rest },
      update: rest,
    });
  }

  async removeAdmin(authId: string): Promise<boolean> {
    const res = await this.c().platformAdmin.deleteMany({ where: { authId } });
    return res.count > 0;
  }

  async touchAdmin(authId: string, at: Date): Promise<void> {
    await this.c().platformAdmin.update({ where: { authId }, data: { lastSeenAt: at } });
  }

  findBySlug(slug: string) {
    return this.c().organisation.findUnique({ where: { slug }, select: { id: true, name: true, status: true } });
  }

  async provision(rows: ProvisionTenantRows): Promise<ProvisionedTenant> {
    return this.c().$transaction(async (tx) => {
      const org = await tx.organisation.create({ data: { ...rows.organisation, slug: rows.slug } });
      const branch = await tx.branch.create({ data: { ...rows.branch, organisationId: org.id } });
      const owner = await tx.user.create({
        data: {
          ...rows.owner,
          organisationId: org.id,
          branchId: rows.owner.branchId ?? branch.id,
        },
      });
      // AuthLink 是"这个账号属于哪几家店"的唯一事实来源（P3b）——开通时就必须写上，
      // 否则新店主登录后会落到"没有业务身份"。
      await tx.authLink.create({
        data: { authId: rows.authId, organisationId: org.id, kind: "STAFF", userId: owner.id },
      });
      if (rows.defaults.serviceTypes.length) {
        await tx.serviceType.createMany({
          data: rows.defaults.serviceTypes.map((s) => ({ ...s, organisationId: org.id })),
        });
      }
      if (rows.defaults.leadSources.length) {
        await tx.leadSource.createMany({
          data: rows.defaults.leadSources.map((s) => ({ ...s, organisationId: org.id })),
        });
      }
      if (rows.defaults.leadStages.length) {
        await tx.leadStage.createMany({
          data: rows.defaults.leadStages.map((s) => ({ ...s, organisationId: org.id })),
        });
      }
      if (rows.defaults.messageTemplates.length) {
        await tx.messageTemplate.createMany({
          data: rows.defaults.messageTemplates.map((s) => ({ ...s, organisationId: org.id })),
        });
      }
      if (rows.slots.length) {
        await tx.appointmentSlot.createMany({
          data: rows.slots.map((s) => ({ ...s, branchId: branch.id })),
        });
      }
      // 库位：库存页面默认要有一个"主仓"，没有它入库表单是空的
      await tx.inventoryLocation.create({ data: { branchId: branch.id, name: "Main Store", code: "MAIN" } });
      return { organisationId: org.id, branchId: branch.id, ownerUserId: owner.id, qrToken: org.qrToken ?? null };
    });
  }

  async tenantCountForAuth(authId: string): Promise<number> {
    return this.c().authLink.count({ where: { authId } });
  }

  async listTenants() {
    const orgs = await this.c().organisation.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true, name: true, slug: true, status: true, createdAt: true,
        _count: { select: { users: true, customers: true } },
      },
    });
    return orgs.map((o) => ({
      id: o.id, name: o.name, slug: o.slug, status: o.status, createdAt: o.createdAt,
      staff: o._count.users, customers: o._count.customers,
    }));
  }

  /** 退租：按外键拓扑从叶子往上删。**只给测试与明确的运维动作**，不在服务层暴露。 */
  async dropTenant(organisationId: string): Promise<void> {
    const client = this.c();
    await client.$transaction(async (tx) => {
      const branches = await tx.branch.findMany({ where: { organisationId }, select: { id: true } });
      const branchIds = branches.map((b) => b.id);
      await tx.authLink.deleteMany({ where: { organisationId } });
      await tx.appointmentSlot.deleteMany({ where: { branchId: { in: branchIds } } });
      await tx.inventoryLocation.deleteMany({ where: { branchId: { in: branchIds } } });
      await tx.messageTemplate.deleteMany({ where: { organisationId } });
      await tx.leadStage.deleteMany({ where: { organisationId } });
      await tx.leadSource.deleteMany({ where: { organisationId } });
      await tx.serviceType.deleteMany({ where: { organisationId } });
      await tx.user.deleteMany({ where: { organisationId } });
      await tx.customer.deleteMany({ where: { organisationId } });
      await tx.branch.deleteMany({ where: { organisationId } });
      await tx.organisation.delete({ where: { id: organisationId } });
    });
  }
}
