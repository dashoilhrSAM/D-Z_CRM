import type { DbLike } from "@/modules/customers/repository";
import type { StockLevel, StockStatus } from "@/types";
import type { IInventoryRepository } from "./repository";
import { PrismaInventoryRepository } from "@/repositories/prisma/inventory.repository";
import { stockLevel } from "@/lib/state-machines";
import { db } from "@/lib/db";

/** Deterministic stock intelligence (§34-37). */
export class InventoryService {
  constructor(private repo: IInventoryRepository = new PrismaInventoryRepository()) {}

  private levelOf(quantity: number, minStock: number): StockLevel {
    return stockLevel(quantity, minStock);
  }

  private avgDailyUsage(movements: { quantity: number; createdAt: Date }[], days = 30): number {
    const now = Date.now();
    const cutoff = now - days * 86400000;
    const out = movements.filter((m) => m.quantity < 0 && m.createdAt.getTime() >= cutoff).reduce((s, m) => s + Math.abs(m.quantity), 0);
    return out / days;
  }

  private daysSinceLastSale(movements: { quantity: number; createdAt: Date }[]): number | null {
    const sales = movements.filter((m) => m.quantity < 0);
    if (sales.length === 0) return null;
    const last = sales[0]; // newest first
    return Math.floor((Date.now() - last.createdAt.getTime()) / 86400000);
  }

  async stockStatus(branchId: string): Promise<StockStatus[]> {
    const products = await this.repo.listProducts();
    return products
      .map((p) => {
        const inv = p.inventories.find((i) => i.branchId === branchId);
        const quantity = inv?.quantity ?? 0;
        const usage = this.avgDailyUsage(p.stockMovements);
        const daysRemaining = usage > 0 ? Math.floor(quantity / usage) : null;
        const daysSinceLastSale = this.daysSinceLastSale(p.stockMovements);
        const reorderPoint = Math.ceil(usage * p.leadTimeDays) + p.safetyStock;
        const recommendedReorderQty = Math.max(0, Math.ceil(reorderPoint - quantity + usage * p.leadTimeDays));
        let reason: string | null = null;
        if (quantity === 0) reason = "Out of stock";
        else if (quantity <= Math.ceil(p.minStock * 0.5)) reason = "Below half of minimum stock";
        else if (quantity <= p.minStock) reason = "Below minimum stock";
        if (usage > 0 && daysRemaining !== null && daysRemaining <= 7 && reason === null) reason = "Estimated to run out within " + daysRemaining + " days";
        return {
          productId: p.id, name: p.name, sku: p.sku, quantity, minStock: p.minStock,
          level: this.levelOf(quantity, p.minStock),
          daysRemaining,
          daysSinceLastSale,
          valueSen: quantity * p.costPriceSen,
          recommendedReorderQty,
          reason,
          supplierId: p.supplierId,
          leadTimeDays: p.leadTimeDays,
        };
      })
      .sort((a, b) => ["OUT_OF_STOCK", "CRITICAL", "LOW", "HEALTHY"].indexOf(a.level) - ["OUT_OF_STOCK", "CRITICAL", "LOW", "HEALTHY"].indexOf(b.level));
  }

  async criticalStockCount(branchId: string): Promise<number> {
    const rows = await this.stockStatus(branchId);
    return rows.filter((r) => r.level === "CRITICAL" || r.level === "OUT_OF_STOCK").length;
  }

  /** Dead stock: 60d slow-moving, 90d warning, 180d critical (§36). */
  async deadStock(branchId: string) {
    const rows = await this.stockStatus(branchId);
    return rows
      .filter((r) => r.quantity > 0 && r.daysSinceLastSale !== null && r.daysSinceLastSale >= 60)
      .map((r) => ({
        ...r,
        stage: r.daysSinceLastSale! >= 180 ? "CRITICAL_DEAD_STOCK" : r.daysSinceLastSale! >= 90 ? "DEAD_STOCK_WARNING" : "SLOW_MOVING",
        recommendation:
          r.daysSinceLastSale! >= 180 ? "Bundle with service package or discount heavily"
          : r.daysSinceLastSale! >= 90 ? "Create promotion or transfer to another branch"
          : "Watch — consider bundling",
      }));
  }

  async deadStockValue(branchId: string): Promise<number> {
    const rows = await this.deadStock(branchId);
    return rows.reduce((s, r) => s + r.valueSen, 0);
  }

  /** Reorder recommendations (§37): reorder_point = avg_daily_usage × lead_time + safety_stock. */
  async reorderRecommendations(branchId: string) {
    const rows = await this.stockStatus(branchId);
    return rows.filter((r) => r.quantity <= r.minStock || (r.daysRemaining !== null && r.daysRemaining <= 7));
  }

  /** Consume stock for a service job (§34). Throws when insufficient. Creates StockMovement. */
  async deductStock(branchId: string, productId: string, qty: number, reason: string, referenceId?: string, client?: DbLike) {
    if (qty <= 0) return;
    if (client) return this.deductStockTx(branchId, productId, qty, reason, referenceId, client);
    return db.$transaction(async (tx: DbLike) => this.deductStockTx(branchId, productId, qty, reason, referenceId, tx));
  }

  private async deductStockTx(branchId: string, productId: string, qty: number, reason: string, referenceId: string | undefined, tx: DbLike) {
    const inv = await this.repo.getInventory(branchId, productId, tx);
    const current = inv?.quantity ?? 0;
    if (current < qty) throw new Error("Insufficient stock for product " + (inv?.product.name ?? productId) + " (have " + current + ", need " + qty + ")");
    await this.repo.upsertInventory(branchId, productId, current - qty, tx);
    await this.repo.createMovement({ branchId, productId, quantity: -qty, reason, referenceType: "SERVICE_JOB", referenceId }, tx);
  }

  async addStock(branchId: string, productId: string, qty: number, reason: string, referenceId?: string, client?: DbLike) {
    if (client) return this.addStockTx(branchId, productId, qty, reason, referenceId, client);
    return db.$transaction(async (tx: DbLike) => this.addStockTx(branchId, productId, qty, reason, referenceId, tx));
  }

  private async addStockTx(branchId: string, productId: string, qty: number, reason: string, referenceId: string | undefined, tx: DbLike) {
    const inv = await this.repo.getInventory(branchId, productId, tx);
    const current = inv?.quantity ?? 0;
    await this.repo.upsertInventory(branchId, productId, current + qty, tx);
    await this.repo.createMovement({ branchId, productId, quantity: qty, reason, referenceType: "PURCHASE_ORDER", referenceId }, tx);
  }

  /** Branch-to-branch stock transfer (INV-010): deduct source, add target, dual ledger entries. */
  async transferStock(fromBranchId: string, toBranchId: string, productId: string, qty: number) {
    if (qty <= 0) throw new Error("Quantity must be positive");
    if (fromBranchId === toBranchId) throw new Error("Source and target branches are the same");
    return db.$transaction(async (tx: DbLike) => {
      await this.deductStockTx(fromBranchId, productId, qty, "Transfer out to branch " + toBranchId.slice(-4), undefined, tx);
      const inv = await this.repo.getInventory(toBranchId, productId, tx);
      const current = inv?.quantity ?? 0;
      await this.repo.upsertInventory(toBranchId, productId, current + qty, tx);
      await this.repo.createMovement({ branchId: toBranchId, productId, quantity: qty, reason: "Transfer in from branch " + fromBranchId.slice(-4), referenceType: "TRANSFER", referenceId: fromBranchId }, tx);
      return { ok: true };
    });
  }

  async suppliers() {
    const rows = await this.repo.listSuppliers();
    return rows.map((s) => ({ id: s.id, name: s.name, contactName: s.contactName, phone: s.phone, leadTimeDays: s.leadTimeDays, productCount: s.products.length }));
  }

  async purchaseOrders(branchId?: string | null) {
    const rows = await this.repo.listPOs(branchId);
    return rows.map((po) => ({
      id: po.id, status: po.status, expectedAt: po.expectedAt, receivedAt: po.receivedAt, totalSen: po.totalSen, createdAt: po.createdAt,
      supplier: { id: po.supplier.id, name: po.supplier.name },
      items: po.items.map((i) => ({ id: i.id, product: i.product.name, quantity: i.quantity, unitCostSen: i.unitCostSen, lineTotalSen: i.lineTotalSen })),
    }));
  }

  async createPurchaseOrder(input: { branchId: string; supplierId: string; items: { productId: string; quantity: number; unitCostSen: number }[]; expectedAt?: Date }) {
    const total = input.items.reduce((s, i) => s + i.unitCostSen * i.quantity, 0);
    return db.$transaction(async (tx: DbLike) => {
      const po = await this.repo.createPO(
        { branch: { connect: { id: input.branchId } }, supplier: { connect: { id: input.supplierId } }, totalSen: total, expectedAt: input.expectedAt, status: "DRAFT" },
        tx
      );
      for (const it of input.items) {
        await this.repo.createPOItem(
          { purchaseOrder: { connect: { id: po.id } }, product: { connect: { id: it.productId } }, quantity: it.quantity, unitCostSen: it.unitCostSen, lineTotalSen: it.unitCostSen * it.quantity },
          tx
        );
      }
      return po;
    });
  }

  /** Receive a PO: mark RECEIVED, stock each line in and record movements (§34 purchase receiving). */
  async receivePurchaseOrder(poId: string, branchId: string) {
    return db.$transaction(async (tx: DbLike) => {
      const po = await this.repo.listPOs(undefined, tx).then((rows) => rows.find((p) => p.id === poId));
      if (!po) throw new Error("Purchase order not found");
      if (po.status === "RECEIVED") throw new Error("Purchase order already received");
      const receivedAt = new Date();
      await this.repo.markPOReceived(poId, receivedAt, tx);
      for (const item of po.items) {
        await this.addStockTx(branchId, item.productId, item.quantity, "PO receive: " + po.supplier.name, poId, tx);
        await this.repo.markPOItemReceived(item.id, item.quantity, tx);
      }
      return { ok: true, receivedAt };
    });
  }

  async searchProducts(q: string) {
    const rows = await this.repo.searchProducts(q);
    return rows.map((p) => ({ id: p.id, name: p.name, sku: p.sku, sellPriceSen: p.sellPriceSen, costPriceSen: p.costPriceSen, category: p.category, brand: p.brand, unit: p.unit, manufacturerPartNo: p.manufacturerPartNo, barcode: p.barcode }));
  }

  async productOptions() {
    const rows = await this.repo.listProducts();
    return rows.map((p) => ({ id: p.id, name: p.name, sku: p.sku, category: p.category, brand: p.brand, sellPriceSen: p.sellPriceSen, costPriceSen: p.costPriceSen, manufacturerPartNo: p.manufacturerPartNo, barcode: p.barcode, imageUrl: p.imageUrl }));
  }
}

export const inventoryService = new InventoryService();