import type { Prisma, PrismaClient } from "@prisma/client";
import type { Customer } from "@prisma/client";

export type DbLike = PrismaClient | Prisma.TransactionClient;

/** 列表页用的行（含算 summary 所需的两层关联）。类型只在这里定义一次，实现与接口共用。 */
export type CustomerListRow = Prisma.CustomerGetPayload<{
  include: { motorcycles: true; jobs: { include: { invoice: true } }; messages: true; reminders: true };
}>;

/**
 * 2026-09-30（P2）：**读方法一律要求 organisationId**。
 *
 * 为什么改签名而不是"记得在 where 里写"：这一层原先每个方法都没有租户条件 ——
 * 客户列表页因此会列出**所有租户**的客户，详情页按 cuid 直查也是跨租户的。
 * 把租户做成**必需参数**，编译器就会替你盯着每一个调用点；漏了根本编译不过。
 * 租户守卫审计（scripts/tenant-guard-audit.mjs）跑出的清单里，
 * customers.repository 的 Customer.findMany / count 正是最高频的生产侧命中之一。
 */
/** CustomerRepository — data access boundary (UI → Service → Repository → DB). */
export interface ICustomerRepository {
  list(organisationId: string, client?: DbLike): Promise<Customer[]>;
  listWith(organisationId: string, client?: DbLike): Promise<CustomerListRow[]>;
  /**
   * 列表页取数：**带上限**（skip/take）并按 q 过滤。
   *
   * 存在的理由（2026-09-30 压测）：原来的 listWith() 没有 where、没有 take，
   * 一次把整张客户表连同车辆/工单/发票/提醒全拉进内存再丢掉 99%。4202 个客户时
   * 单请求 323ms、四并发反而掉到 1.23 req/s（每请求 CPU 放大 10 倍，GC 风暴），
   * 而且会让同一实例上所有人变慢。列表页的代价必须只跟「一页多少行」相关。
   */
  listPageWith(params: { organisationId: string; q?: string; skip: number; take: number }, client?: DbLike): Promise<{ rows: CustomerListRow[]; total: number }>;
  getById(id: string, organisationId: string, client?: DbLike): Promise<Prisma.CustomerGetPayload<{ include: { motorcycles: { orderBy: { createdAt: "asc" } }; jobs: { include: { invoice: true; mechanic: true; items: true; parts: { include: { product: true } } } }; messages: { orderBy: { createdAt: "desc" } }; reminders: true; reviews: true } }> | null>;
  getByPhone(phone: string, organisationId: string, client?: DbLike): Promise<Customer | null>;
  search(q: string, organisationId: string, client?: DbLike): Promise<Prisma.CustomerGetPayload<{ include: { motorcycles: true } }>[]>;
  create(data: Prisma.CustomerCreateInput, client?: DbLike): Promise<Customer>;
  update(id: string, data: Prisma.CustomerUpdateInput, client?: DbLike): Promise<Customer>;
  count(organisationId: string, client?: DbLike): Promise<number>;
}
