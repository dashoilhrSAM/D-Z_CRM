import type { Prisma, PrismaClient } from "@prisma/client";
import type { DbLike } from "@/modules/customers/repository";

export type ProductWithInv = Prisma.ProductGetPayload<{
  include: {
    supplier: true;
    inventories: true;
    stockMovements: { orderBy: { createdAt: "desc" }; take: 200 };
  };
}>;

export interface IInventoryRepository {
  listProducts(client?: DbLike): Promise<ProductWithInv[]>;
  getProduct(id: string, client?: DbLike): Promise<ProductWithInv | null>;
  getInventory(branchId: string, productId: string, client?: DbLike): Promise<Prisma.InventoryGetPayload<{ include: { product: true } }> | null>;
  upsertInventory(branchId: string, productId: string, quantity: number, client?: DbLike): Promise<unknown>;
  createMovement(data: Prisma.StockMovementUncheckedCreateInput, client?: DbLike): Promise<unknown>;
  listSuppliers(client?: DbLike): Promise<Prisma.SupplierGetPayload<{ include: { products: true } }>[]>;
  listPOs(branchId?: string | null, client?: DbLike): Promise<Prisma.PurchaseOrderGetPayload<{ include: { supplier: true; items: { include: { product: true } } } }>[]>;
  createPO(data: Prisma.PurchaseOrderCreateInput, client?: DbLike): Promise<{ id: string }>;
  createPOItem(data: Prisma.PurchaseOrderItemCreateInput, client?: DbLike): Promise<unknown>;
  markPOReceived(poId: string, receivedAt: Date, client?: DbLike): Promise<unknown>;
  markPOItemReceived(itemId: string, receivedQty: number, client?: DbLike): Promise<unknown>;
  searchProducts(q: string, client?: DbLike): Promise<ProductWithInv[]>;
}

export type { DbLike } from "@/modules/customers/repository";