import type { Prisma, PrismaClient } from "@prisma/client";
import type { DbLike, IFinanceRepository, InvoiceFull } from "@/modules/finance/repository";
import { db } from "@/lib/db";

const invoiceInclude = {
  items: true,
  payments: true,
  job: { include: { motorcycle: true, customer: true } },
  customer: true,
} satisfies Prisma.InvoiceInclude;

export class PrismaFinanceRepository implements IFinanceRepository {
  private c(client?: DbLike): PrismaClient | Prisma.TransactionClient { return client ?? db; }
  listInvoices(client?: DbLike) { return this.c(client).invoice.findMany({ include: invoiceInclude, orderBy: { issuedAt: "desc" } }); }
  getInvoice(id: string, client?: DbLike) { return this.c(client).invoice.findUnique({ where: { id }, include: invoiceInclude }); }
  getByJob(jobId: string, client?: DbLike) { return this.c(client).invoice.findFirst({ where: { jobId }, include: invoiceInclude }); }
  // 2026-09-30（P1）：invoiceNumber 不再是全局唯一（改成 @@unique([organisationId, invoiceNumber])），
  // findUnique 写不出来 —— 用 findFirst。要精确定位到某一家店时请带上 branch.organisationId。
  getByNumber(num: string, client?: DbLike) { return this.c(client).invoice.findFirst({ where: { invoiceNumber: num }, include: invoiceInclude }); }
  // 2026-09-30（P1）：下面两个方法**目前没有生产调用方**（发票由完工流程 completion.ts 直接建），
  // 但谁接上它们，谁就必须自己写 organisationId —— 复合唯一键 (organisationId, invoiceNumber)
  // **不约束 organisationId 为 NULL 的行**；而且这里的取号是老的 count+1（删除会回退、并发会撞号），
  // 不要用，取号请走 completion.ts 的 nextInvoiceNumber。
  /**
   * 2026-09-30（P1）：Invoice.organisationId 现在是租户内唯一键的一部分，漏写这一列的行
   * **不受唯一约束保护**（NULL 互不相等）—— 所以把它做成**类型上必需**，而不是靠注释提醒。
   * 这两个方法目前全仓库没有调用方（发票实际由 services/completion.ts 建）；留着是因为接口声明，
   * 将来谁接上，类型会先拦住他。
   */
  createInvoice(data: Prisma.InvoiceUncheckedCreateInput & { organisationId: string }, client?: DbLike) { return this.c(client).invoice.create({ data, include: invoiceInclude }); }
  createInvoiceItem(data: Prisma.InvoiceItemCreateInput, client?: DbLike) { return this.c(client).invoiceItem.create({ data }); }
  createPayment(data: Prisma.PaymentCreateInput, client?: DbLike) { return this.c(client).payment.create({ data }); }
  count(client?: DbLike) { return this.c(client).invoice.count(); }
  async nextInvoiceNumber(client?: DbLike) {
    const c = this.c(client);
    const year = new Date().getFullYear();
    const count = await c.invoice.count({ where: { invoiceNumber: { startsWith: "DZ-" + year + "-" } } });
    return "DZ-" + year + "-" + String(count + 1).padStart(5, "0");
  }
}
