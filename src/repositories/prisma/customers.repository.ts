// Prisma 需要**值**导入（Prisma.sql 用来拼带参数的原始 SQL）；PrismaClient 仍只是类型。
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Customer } from "@prisma/client";
import type { DbLike, ICustomerRepository } from "@/modules/customers/repository";
import { db } from "@/lib/db";

const withRelations = {
  motorcycles: { orderBy: { createdAt: "asc" as const } },
  jobs: { include: { invoice: true, mechanic: true, items: true, parts: { include: { product: true } } } },
  messages: { orderBy: { createdAt: "desc" as const } },
  reminders: true,
  reviews: true,
} satisfies Prisma.CustomerInclude;
const withList = {
  motorcycles: true,
  jobs: { include: { invoice: true } },
  messages: true,
  reminders: true,
} satisfies Prisma.CustomerInclude;

export class PrismaCustomerRepository implements ICustomerRepository {
  private c(client?: DbLike): PrismaClient | Prisma.TransactionClient {
    return client ?? db;
  }

  list(organisationId: string, client?: DbLike) {
    return this.c(client).customer.findMany({ where: { organisationId }, orderBy: { name: "asc" } });
  }

  listWith(organisationId: string, client?: DbLike) {
    return this.c(client).customer.findMany({ where: { organisationId }, orderBy: { name: "asc" }, include: withList });
  }

  /**
   * 列表页取数（有界）。**这是压测之后新增的唯一取数路径**，见 ICustomerRepository 的注释。
   *
   * 无搜索词时走纯 Prisma：findMany(skip/take) + count，两条查询、行数受 take 约束。
   *
   * 有搜索词时用 lower()+LIKE 的原始 SQL 只取「当前页的 id + 总数」，再交给 Prisma 取整行。
   * 为什么不直接用 Prisma 的 contains：它在 PG 上区分大小写（柜台打 "ahmad" 会一无所获），
   * 而 mode:"insensitive" 又不被 SQLite 支持 —— 本项目本地 SQLite、生产 PG 两套引擎，
   * lower() 是两边行为一致的那一种写法。SQL 只用标准语法（lower/COALESCE/EXISTS/LIMIT/OFFSET），
   * 标识符用双引号（Prisma 未做 @@map，两侧表名一致）。
   */
  async listPageWith({ organisationId, q, skip, take }: { organisationId: string; q?: string; skip: number; take: number }, client?: DbLike) {
    const c = this.c(client);
    const term = (q ?? "").trim();
    if (!term) {
      const [rows, total] = await Promise.all([
        c.customer.findMany({ where: { organisationId }, orderBy: { name: "asc" }, skip, take, include: withList }),
        c.customer.count({ where: { organisationId } }),
      ]);
      return { rows, total };
    }

    const like = "%" + term.toLowerCase() + "%";
    // 租户条件是这条 SQL 的要害：少了它，搜索会跨租户命中，而且 total 也是全库计数。
    // ⚠️ 括号不能省：AND 比 OR 结合得紧，写成 `A AND B OR C OR D` 会变成 `(A AND B) OR C OR D`，
    //    等于把租户条件只挂在第一个分支上 —— 后两个分支照样跨租户。第一版就是这么漏的。
    const where = Prisma.sql`WHERE c."organisationId" = ${organisationId} AND (
             lower(c."name") LIKE ${like}
          OR lower(COALESCE(c."phone", '')) LIKE ${like}
          OR EXISTS (
               SELECT 1 FROM "Motorcycle" m
               WHERE m."customerId" = c."id"
                 AND (lower(m."plate") LIKE ${like} OR lower(m."model") LIKE ${like} OR lower(m."brand") LIKE ${like})
             )
           )`;

    const idRows = await c.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT c."id" AS id FROM "Customer" c ${where} ORDER BY c."name" ASC LIMIT ${take} OFFSET ${skip}`,
    );
    const countRows = await c.$queryRaw<{ n: number | bigint }[]>(
      Prisma.sql`SELECT COUNT(*) AS n FROM "Customer" c ${where}`,
    );
    const total = Number(countRows[0]?.n ?? 0);

    if (idRows.length === 0) return { rows: [], total };
    // 带上租户：id 是从上面那条已收窄的 SQL 来的，单看是安全的；但"安全"依赖调用顺序，
    // 而这一层是要长期被人改的地方 —— 多加一个条件不会出错，少一个会。
    const fetched = await c.customer.findMany({
      where: { organisationId, id: { in: idRows.map((r) => r.id) } },
      include: withList,
    });
    // 原始 SQL 决定顺序（分页边界靠它），所以按 id 顺序还原，不用 JS 重排。
    const byId = new Map(fetched.map((r) => [r.id, r]));
    const rows = idRows.map((r) => byId.get(r.id)).filter((r): r is (typeof fetched)[number] => Boolean(r));
    return { rows, total };
  }

  // 2026-09-30（P2）：findUnique 的 where 只能吃唯一键，写不出租户条件 ——
  // 改成 findFirst 并把租户带进 where。这是 IDOR 最典型的形态（按 cuid 直查、不问归属）。
  getById(id: string, organisationId: string, client?: DbLike) {
    return this.c(client).customer.findFirst({
      where: { id, organisationId },
      include: withRelations,
    });
  }

  getByPhone(phone: string, organisationId: string, client?: DbLike) {
    return this.c(client).customer.findFirst({ where: { phone, organisationId } });
  }

  search(q: string, organisationId: string, client?: DbLike) {
    const contains = q.trim().toLowerCase();
    if (!contains) return this.c(client).customer.findMany({ where: { organisationId }, orderBy: { name: "asc" }, include: { motorcycles: true }, take: 20 });
    return this.c(client).customer.findMany({
      where: {
        organisationId,
        OR: [
          { name: { contains } },
          { phone: { contains } },
          { motorcycles: { some: { OR: [{ plate: { contains } }, { model: { contains } }, { brand: { contains } }] } } },
        ],
      },
      include: { motorcycles: true },
      orderBy: { name: "asc" },
      take: 20,
    });
  }

  create(data: Prisma.CustomerCreateInput, client?: DbLike) {
    return this.c(client).customer.create({ data });
  }

  update(id: string, data: Prisma.CustomerUpdateInput, client?: DbLike) {
    return this.c(client).customer.update({ where: { id }, data });
  }

  count(organisationId: string, client?: DbLike) {
    return this.c(client).customer.count({ where: { organisationId } });
  }
}
