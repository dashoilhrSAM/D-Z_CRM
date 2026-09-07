import type { Prisma, PrismaClient } from "@prisma/client";
import type { DbLike, IStaffRepository } from "@/modules/staff/repository";
import { db } from "@/lib/db";

export class PrismaStaffRepository implements IStaffRepository {
  private c(client?: DbLike): PrismaClient | Prisma.TransactionClient { return client ?? db; }
  listUsers(branchId?: string | null, client?: DbLike) { return this.c(client).user.findMany({ where: branchId ? { branchId } : undefined, include: { jobs: true }, orderBy: { name: "asc" } }); }
}