import type { Prisma, PrismaClient } from "@prisma/client";
import type { DbLike } from "@/modules/customers/repository";

export type JobFull = Prisma.ServiceJobGetPayload<{
  include: {
    customer: true;
    motorcycle: true;
    mechanic: true;
    items: true;
    parts: { include: { product: true } };
    findings: { include: { approval: true } };
    approvals: true;
    checklist: { include: { items: true } };
    invoice: { include: { items: true; payments: true } };
    booking: true;
    branch: true;
    reminder: true;
    photos: true;
    quotation: true;
  };
}>;

export type JobRow = Prisma.ServiceJobGetPayload<{
  include: {
    customer: true;
    motorcycle: true;
    mechanic: { select: { id: true; name: true } };
    items: true;
    parts: true;
    approvals: { select: { status: true } };
  };
}>;

export interface IJobRepository {
  list(where?: Prisma.ServiceJobWhereInput, client?: DbLike): Promise<JobRow[]>;
  getById(id: string, client?: DbLike): Promise<JobFull | null>;
  getByNumber(jobNumber: string, client?: DbLike): Promise<JobRow | null>;
  create(data: Prisma.ServiceJobUncheckedCreateInput, client?: DbLike): Promise<JobFull>;
  update(id: string, data: Prisma.ServiceJobUpdateInput, client?: DbLike): Promise<JobFull>;
  count(client?: DbLike): Promise<number>;
  countByStatus(status: string, client?: DbLike): Promise<number>;
  nextJobNumber(client?: DbLike): Promise<string>;
}

export type { DbLike } from "@/modules/customers/repository";