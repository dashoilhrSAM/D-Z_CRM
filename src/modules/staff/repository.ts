import type { Prisma, PrismaClient } from "@prisma/client";
import type { DbLike } from "@/modules/customers/repository";

export interface IStaffRepository {
  listUsers(branchId?: string | null, client?: DbLike): Promise<Prisma.UserGetPayload<{ include: { jobs: true } }>[]>;
}

export type { DbLike } from "@/modules/customers/repository";