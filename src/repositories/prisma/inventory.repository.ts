import type { Prisma, PrismaClient } from "@prisma/client";
import type { DbLike, IInventoryRepository } from "@/modules/inventory/repository";
import { db } from "@/lib/db";

const productInclude = {
  supplier: true,
  inventories: true,
  stockMovements: { orderBy: { createdAt: "desc" as const }, take: 200 },
} satisfies Prisma.ProductInclude;

export class PrismaInventoryRepository implements IInventoryRepository {
  private c(client?: DbLike): PrismaClient | Prisma.TransactionClient { return client ?? db; }
  listProducts(client?: DbLike) { return this.c(client).product.findMany({ include: productInclude, orderBy: { name: "asc" } }); }
  getProduct(id: string, client?: DbLike) { return this.c(client).product.findUnique({ where: { id }, include: productInclude }); }
  getInventory(branchId: string, productId: string, client?: DbLike) {
    return this.c(client).inventory.findUnique({ where: { branchId_productId: { branchId, productId } }, include: { product: true } });
  }
  upsertInventory(branchId: string, productId: string, quantity: number, client?: DbLike) {
    return this.c(client).inventory.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: { branchId, productId, quantity },
      update: { quantity },
    });
  }
  createMovement(data: Prisma.StockMovementUncheckedCreateInput, client?: DbLike) { return this.c(client).stockMovement.create({ data }); }
  listSuppliers(client?: DbLike) { return this.c(client).supplier.findMany({ include: { products: true }, orderBy: { name: "asc" } }); }
  listPOs(branchId?: string | null, client?: DbLike) {
    return this.c(client).purchaseOrder.findMany({ where: branchId ? { branchId } : undefined, include: { supplier: true, items: { include: { product: true } } }, orderBy: { createdAt: "desc" } });
  }
  createPO(data: Prisma.PurchaseOrderCreateInput, client?: DbLike) { return this.c(client).purchaseOrder.create({ data }); }
  createPOItem(data: Prisma.PurchaseOrderItemCreateInput, client?: DbLike) { return this.c(client).purchaseOrderItem.create({ data }); }
  markPOReceived(poId: string, receivedAt: Date, client?: DbLike) {
    return this.c(client).purchaseOrder.update({ where: { id: poId }, data: { status: "RECEIVED", receivedAt } });
  }
  markPOItemReceived(itemId: string, receivedQty: number, client?: DbLike) {
    return this.c(client).purchaseOrderItem.update({ where: { id: itemId }, data: { receivedQty } });
  }
  searchProducts(q: string, client?: DbLike) {
    const contains = q.trim().toLowerCase();
    if (!contains) return this.c(client).product.findMany({ include: productInclude, take: 15 });
    return this.c(client).product.findMany({ where: { OR: [{ name: { contains } }, { sku: { contains } }, { brand: { contains } }] }, include: productInclude, take: 15 });
  }
}