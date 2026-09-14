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
  /**
   * 原子增减库存（增量语义）。
   * 为什么不能再用 upsertInventory：它是**绝对赋值**，调用方必须先读当前值再写回，
   * 并发下两个请求都读到 5、都写 4 —— 实扣 2 只记 1（PG READ COMMITTED 的经典丢失更新）。
   */
  addInventory(branchId: string, productId: string, delta: number, client?: DbLike): Promise<unknown>;
  /** 条件原子扣减：库存 >= qty 才扣。返回受影响行数，0 表示库存不足或没有该行。 */
  deductInventory(branchId: string, productId: string, qty: number, client?: DbLike): Promise<{ count: number }>;
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