import type { Prisma, PrismaClient } from "@prisma/client";
import type { DbLike } from "@/modules/customers/repository";

export type InvoiceFull = Prisma.InvoiceGetPayload<{
  include: { items: true; payments: true; job: { include: { motorcycle: true; customer: true } }; customer: true };
}>;

export interface IFinanceRepository {
  listInvoices(client?: DbLike): Promise<InvoiceFull[]>;
  getInvoice(id: string, client?: DbLike): Promise<InvoiceFull | null>;
  getByJob(jobId: string, client?: DbLike): Promise<InvoiceFull | null>;
  getByNumber(num: string, client?: DbLike): Promise<InvoiceFull | null>;
  // 2026-09-30（P1）：organisationId 在类型上必需 —— 漏写它的发票行不受复合唯一键保护
  // （NULL 互不相等）。见 PrismaFinanceRepository.createInvoice 的说明。
  createInvoice(data: Prisma.InvoiceUncheckedCreateInput & { organisationId: string }, client?: DbLike): Promise<InvoiceFull>;
  createInvoiceItem(data: Prisma.InvoiceItemCreateInput, client?: DbLike): Promise<unknown>;
  createPayment(data: Prisma.PaymentCreateInput, client?: DbLike): Promise<unknown>;
  count(client?: DbLike): Promise<number>;
  nextInvoiceNumber(client?: DbLike): Promise<string>;
}

export type { DbLike } from "@/modules/customers/repository";
