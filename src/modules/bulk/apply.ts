import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { audit } from "@/lib/auth/audit";
import type { RowPlan } from "./diff";
import { PRODUCTS_SHEET, PACKAGES_SHEET, PACKAGE_ITEMS_SHEET, CAMPAIGNS_SHEET, SUPPLIERS_SHEET, SERVICE_TYPES_SHEET } from "./sheets";

/**
 * 应用已确认的差异（P2）。
 *
 * 与"安全"有关、且**不能照直觉写**的几处：
 *
 * ① **有历史引用的零件不删，改成停用**。工单行、库存、库存流水都指向 Product；
 *    硬删会被外键挡住 —— 而这不是异常，是业务事实：历史单据提过它，就不能把它抹掉。
 * ② **用"先查引用再决定"而不是"试着删、失败再改"**。PostgreSQL 里事务中一条语句失败会让**整个事务作废**，
 *    后面那句 update 会直接报 current transaction is aborted —— 本地 SQLite 不会这样，
 *    所以那种写法能在本地全绿、到生产才坏。
 * ③ **整份文件一个事务**：任何一张 sheet 有一行出错就全不写。
 *    "改了一半"比"什么都没改"难收拾得多 —— 而且用户看不出改到了哪里。
 */

export interface ApplySummary {
  created: number;
  updated: number;
  deleted: number;
  /** 有历史引用因而改成停用的 */
  deactivated: number;
  skipped: number;
}

function emptySummary(): ApplySummary {
  return { created: 0, updated: 0, deleted: 0, deactivated: 0, skipped: 0 };
}

export async function applyPlans(input: {
  organisationId: string;
  /** 文件里写的分店（套餐/促销落这个分店） */
  branchId: string;
  userId: string;
  sessionBranchId: string | null;
  plans: RowPlan[];
}): Promise<{ ok: true; summary: Record<string, ApplySummary> } | { ok: false; error: string }> {
  const bad = input.plans.filter((p) => p.action === "error");
  if (bad.length) {
    return { ok: false, error: bad.length + " row(s) have errors — nothing was written" };
  }

  const branch = await db.branch.findUnique({ where: { id: input.branchId }, select: { organisationId: true } });
  if (!branch || branch.organisationId !== input.organisationId) {
    return { ok: false, error: "The branch in this file is not in your organisation" };
  }

  const [suppliers, products, packages] = await Promise.all([
    db.supplier.findMany({ where: { organisationId: input.organisationId }, select: { id: true, name: true } }),
    db.product.findMany({ where: { organisationId: input.organisationId }, select: { id: true, sku: true } }),
    db.servicePackage.findMany({ where: { branchId: input.branchId }, select: { id: true, name: true } }),
  ]);
  const supplierIdByName = new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s.id]));
  const productIdBySku = new Map(products.map((p) => [p.sku.trim().toLowerCase(), p.id]));
  const packageIdByName = new Map(packages.map((p) => [p.name.trim().toLowerCase(), p.id]));

  const summary: Record<string, ApplySummary> = {};
  const bucket = (sheet: string) => (summary[sheet] ??= emptySummary());

  try {
    await db.$transaction(async (tx) => {
      for (const plan of input.plans) {
        if (plan.action === "skip") {
          bucket(plan.sheet).skipped += 1;
          continue;
        }
        if (plan.sheet === PRODUCTS_SHEET.key) await applyProduct(tx, plan, input, supplierIdByName, bucket(plan.sheet));
        else if (plan.sheet === PACKAGES_SHEET.key) await applyPackage(tx, plan, input, bucket(plan.sheet));
        else if (plan.sheet === PACKAGE_ITEMS_SHEET.key) await applyPackageItem(tx, plan, input, productIdBySku, packageIdByName, bucket(plan.sheet));
        else if (plan.sheet === CAMPAIGNS_SHEET.key) await applyCampaign(tx, plan, input, bucket(plan.sheet));
        else if (plan.sheet === SUPPLIERS_SHEET.key) await applySupplier(tx, plan, input, bucket(plan.sheet));
        else if (plan.sheet === SERVICE_TYPES_SHEET.key) await applyServiceType(tx, plan, input, bucket(plan.sheet));
        else throw new Error("Unknown sheet: " + plan.sheet);
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
    entity: "Setup",
    after: { summary, rows: input.plans.length, fileBranchId: input.branchId },
  });
  return { ok: true, summary };
}

type Tx = Prisma.TransactionClient;

async function applyProduct(
  tx: Tx,
  plan: RowPlan,
  input: { organisationId: string; userId: string },
  supplierIdByName: Map<string, string>,
  out: ApplySummary,
) {
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
    await tx.product.create({
      data: {
        organisationId: input.organisationId,
        name: plan.key,
        sellPriceSen: 0,
        costPriceSen: 0,
        ...data,
        sku: plan.key,
      } as never,
    });
    out.created += 1;
  } else if (plan.action === "update") {
    await tx.product.update({ where: { sku: plan.key }, data: data as never });
    out.updated += 1;
  } else if (plan.action === "delete") {
    const product = await tx.product.findUnique({ where: { sku: plan.key }, select: { id: true } });
    if (!product) {
      out.skipped += 1;
      return;
    }
    const [jobItems, inventories, movements] = await Promise.all([
      tx.serviceJobItem.count({ where: { productId: product.id } }),
      tx.inventory.count({ where: { productId: product.id } }),
      tx.stockMovement.count({ where: { productId: product.id } }),
    ]);
    if (jobItems + inventories + movements > 0) {
      await tx.product.update({ where: { id: product.id }, data: { active: false } });
      out.deactivated += 1;
    } else {
      await tx.product.delete({ where: { id: product.id } });
      out.deleted += 1;
    }
  }
}

async function applyPackage(
  tx: Tx,
  plan: RowPlan,
  input: { branchId: string },
  out: ApplySummary,
) {
  const data: Record<string, unknown> = { ...plan.values };
  delete data.name;
  if (plan.action === "create") {
    await tx.servicePackage.create({
      data: {
        branchId: input.branchId,
        name: plan.key,
        tier: (data.tier as never) ?? "GOOD",
        priceSen: Number(data.priceSen ?? 0),
        ...data,
      } as never,
    });
    out.created += 1;
  } else if (plan.action === "update") {
    // ServicePackage 没有 (branchId, name) 唯一键 —— 只能 findFirst 再按 id 更新
    const found = await tx.servicePackage.findFirst({ where: { branchId: input.branchId, name: plan.key }, select: { id: true } });
    if (!found) throw new Error("Package no longer exists in this branch: " + plan.key);
    await tx.servicePackage.update({ where: { id: found.id }, data: data as never });
    out.updated += 1;
  } else if (plan.action === "delete") {
    const pkg = await tx.servicePackage.findFirst({ where: { branchId: input.branchId, name: plan.key }, select: { id: true } });
    if (!pkg) {
      out.skipped += 1;
      return;
    }
    // 工单/预约指着套餐就不能删（先查，不靠外键异常 —— 见文件头 ②）
    const used = await tx.serviceJob.count({ where: { servicePackageId: pkg.id } })
      + await tx.booking.count({ where: { servicePackageId: pkg.id } });
    if (used > 0) throw new Error("Package is used by jobs or bookings and cannot be deleted: " + plan.key);
    await tx.servicePackageItem.deleteMany({ where: { packageId: pkg.id } });
    await tx.servicePackage.delete({ where: { id: pkg.id } });
    out.deleted += 1;
  }
}

async function applyPackageItem(
  tx: Tx,
  plan: RowPlan,
  input: { branchId: string },
  productIdBySku: Map<string, string>,
  packageIdByName: Map<string, string>,
  out: ApplySummary,
) {
  // 键形如 "套餐名 / 项目名"（删除行没有 values，所以两种来源都要支持）。
  // 优先用**字段值**，只有删除行才回退到拆键 —— 拆键依赖顺序，容易错（实测错过一次）。
  const [keyPackageName, keyItemName] = plan.key.split(" / ");
  const packageName = String(plan.values.packageName ?? keyPackageName ?? "").trim();
  const itemName = String(plan.values.itemName ?? keyItemName ?? "").trim();
  const packageId = packageIdByName.get(packageName.toLowerCase());
  if (!packageId) throw new Error("Unknown package in this branch: " + packageName);

  const data: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(plan.values)) {
    if (field === "packageName" || field === "productSku") continue;
    data[field] = value;
  }
  if (typeof plan.values.productSku === "string" && plan.values.productSku.trim() !== "") {
    const pid = productIdBySku.get(String(plan.values.productSku).trim().toLowerCase());
    if (!pid) throw new Error("Unknown product SKU: " + plan.values.productSku);
    data.productId = pid;
  }

  const existing = await tx.servicePackageItem.findFirst({
    where: { packageId, name: itemName },
    select: { id: true },
  });

  if (plan.action === "delete") {
    if (!existing) {
      out.skipped += 1;
      return;
    }
    await tx.servicePackageItem.delete({ where: { id: existing.id } });
    out.deleted += 1;
    return;
  }
  if (plan.action === "create") {
    await tx.servicePackageItem.create({
      data: {
        packageId,
        name: itemName,
        kind: (data.kind as never) ?? "SERVICE",
        ...data,
      } as never,
    });
    out.created += 1;
    return;
  }
  if (plan.action === "update") {
    if (!existing) throw new Error("Package item no longer exists: " + plan.key);
    await tx.servicePackageItem.update({ where: { id: existing.id }, data: data as never });
    out.updated += 1;
  }
}

async function applySupplier(
  tx: Tx,
  plan: RowPlan,
  input: { organisationId: string; branchId: string },
  out: ApplySummary,
) {
  const data: Record<string, unknown> = { ...plan.values };
  delete data.name;
  if (plan.action === "create") {
    await tx.supplier.create({ data: { organisationId: input.organisationId, name: plan.key, ...data } as never });
    out.created += 1;
  } else if (plan.action === "update") {
    const found = await tx.supplier.findFirst({ where: { organisationId: input.organisationId, name: plan.key }, select: { id: true } });
    if (!found) throw new Error("Supplier no longer exists: " + plan.key);
    await tx.supplier.update({ where: { id: found.id }, data: data as never });
    out.updated += 1;
  } else if (plan.action === "delete") {
    const found = await tx.supplier.findFirst({ where: { organisationId: input.organisationId, name: plan.key }, select: { id: true } });
    if (!found) {
      out.skipped += 1;
      return;
    }
    // 供应商没有"停用"字段，被引用时不能删 —— 先查引用再决定（见文件头 ②）
    const used = await tx.product.count({ where: { supplierId: found.id } })
      + await tx.purchaseOrder.count({ where: { supplierId: found.id } });
    if (used > 0) throw new Error("Supplier is used by " + used + " part(s) or purchase order(s) and cannot be deleted: " + plan.key);
    await tx.supplier.delete({ where: { id: found.id } });
    out.deleted += 1;
  }
}

/**
 * 服务目录：**只改，不建、不删**。
 * 服务是代码定义的（src/lib/service-catalog.ts 同步进库）；从 Excel 造一个新 code
 * 会得到一个柜台根本看不到的服务 —— 那种"数据库里有、前台没有"的东西最难查。
 */
async function applyServiceType(
  tx: Tx,
  plan: RowPlan,
  input: { organisationId: string },
  out: ApplySummary,
) {
  const found = await tx.serviceType.findFirst({ where: { organisationId: input.organisationId, code: plan.key }, select: { id: true } });
  if (!found) throw new Error("Unknown service code: " + plan.key + " (services come from the app catalogue)");
  if (plan.action === "delete") throw new Error("Services cannot be deleted from a workbook: " + plan.key);
  const data: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(plan.values)) {
    if (field === "code") continue;
    data[field] = value;
  }
  await tx.serviceType.update({ where: { id: found.id }, data: data as never });
  out.updated += 1;
}

async function applyCampaign(
  tx: Tx,
  plan: RowPlan,
  input: { branchId: string },
  out: ApplySummary,
) {
  const data: Record<string, unknown> = { ...plan.values };
  delete data.name;
  if (plan.action === "create") {
    await tx.campaign.create({
      data: {
        branchId: input.branchId,
        name: plan.key,
        type: (data.type as never) ?? "RETURN",
        status: (data.status as never) ?? "ACTIVE",
        startDate: (data.startDate as Date) ?? new Date(),
        ...data,
      } as never,
    });
    out.created += 1;
  } else if (plan.action === "update") {
    const found = await tx.campaign.findFirst({ where: { branchId: input.branchId, name: plan.key }, select: { id: true } });
    if (!found) throw new Error("Campaign no longer exists: " + plan.key);
    await tx.campaign.update({ where: { id: found.id }, data: data as never });
    out.updated += 1;
  } else if (plan.action === "delete") {
    const found = await tx.campaign.findFirst({ where: { branchId: input.branchId, name: plan.key }, select: { id: true } });
    if (!found) {
      out.skipped += 1;
      return;
    }
    const used = await tx.booking.count({ where: { campaignId: found.id } }) + await tx.lead.count({ where: { campaignId: found.id } });
    if (used > 0) throw new Error("Campaign has bookings or leads and cannot be deleted: " + plan.key);
    await tx.campaign.delete({ where: { id: found.id } });
    out.deleted += 1;
  }
}
