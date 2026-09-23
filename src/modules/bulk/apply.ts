import { db } from "@/lib/db";
import { audit } from "@/lib/auth/audit";
import type { RowPlan } from "./diff";

/**
 * 应用已确认的差异（P2）。
 *
 * 两条与"安全"有关、且**不能照直觉写**的地方：
 *
 * ① **有历史引用的零件不删，改成停用**。工单行、库存、库存流水都指向 Product；
 *    硬删会被外键挡住 —— 而这里的"被挡住"不是异常，是业务事实：历史单据提过它，就不能把它抹掉。
 * ② **用"先查引用再决定"而不是"试着删、失败再改"**。PostgreSQL 里事务中一条语句失败会让**整个事务作废**，
 *    后面那句 update 会直接报 current transaction is aborted —— 本地 SQLite 不会这样，
 *    所以这种写法能在本地全绿、到生产才坏。这是本项目已经记过一次的坑。
 *
 * 另外：任何一行有错误就**不写这一张 sheet**（半对半错比不写更糟）。
 */

export interface ApplySummary {
  created: number;
  updated: number;
  deleted: number;
  /** 有历史引用因而改成停用的 */
  deactivated: number;
  skipped: number;
}

export async function applyProductPlans(input: {
  organisationId: string;
  userId: string;
  branchId: string | null;
  plans: RowPlan[];
}): Promise<{ ok: true; summary: ApplySummary } | { ok: false; error: string }> {
  const bad = input.plans.filter((p) => p.action === "error");
  if (bad.length) {
    return { ok: false, error: "This sheet has " + bad.length + " row(s) with errors — nothing was written" };
  }

  const suppliers = await db.supplier.findMany({ where: { organisationId: input.organisationId }, select: { id: true, name: true } });
  const supplierIdByName = new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s.id]));

  const summary: ApplySummary = { created: 0, updated: 0, deleted: 0, deactivated: 0, skipped: 0 };

  try {
    await db.$transaction(async (tx) => {
      for (const plan of input.plans) {
        if (plan.action === "skip") {
          summary.skipped += 1;
          continue;
        }

        // 字段准备（supplierName → supplierId；未知供应商直接报错，不悄悄建一条）
        const data: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(plan.values)) {
          if (field === "supplierName") continue;
          data[field] = value;
        }
        if (typeof plan.values.supplierName === "string" && plan.values.supplierName.trim() !== "") {
          const id = supplierIdByName.get(String(plan.values.supplierName).trim().toLowerCase());
          if (!id) throw new Error("Unknown supplier: " + plan.values.supplierName + " (add it under Suppliers first)");
          data.supplierId = id;
        }

        if (plan.action === "create") {
          const createData: Record<string, unknown> = {
            organisationId: input.organisationId,
            name: plan.key,
            sellPriceSen: 0,
            costPriceSen: 0,
            ...data,
            sku: plan.key,
          };
          await tx.product.create({ data: createData as never });
          summary.created += 1;
        } else if (plan.action === "update") {
          await tx.product.update({ where: { sku: plan.key }, data: data as never });
          summary.updated += 1;
        } else if (plan.action === "delete") {
          const product = await tx.product.findUnique({ where: { sku: plan.key }, select: { id: true } });
          if (!product) {
            summary.skipped += 1;
            continue;
          }
          // 先查引用（见文件头 ②）：有引用就停用，不尝试删
          const [jobItems, inventories, movements] = await Promise.all([
            tx.serviceJobItem.count({ where: { productId: product.id } }),
            tx.inventory.count({ where: { productId: product.id } }),
            tx.stockMovement.count({ where: { productId: product.id } }),
          ]);
          if (jobItems + inventories + movements > 0) {
            await tx.product.update({ where: { id: product.id }, data: { active: false } });
            summary.deactivated += 1;
          } else {
            await tx.product.delete({ where: { id: product.id } });
            summary.deleted += 1;
          }
        }
      }
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  await audit({
    organisationId: input.organisationId,
    branchId: input.branchId,
    userId: input.userId,
    action: "BULK_IMPORT_APPLY",
    entity: "Product",
    after: { ...summary, rows: input.plans.length },
  });
  return { ok: true, summary };
}
