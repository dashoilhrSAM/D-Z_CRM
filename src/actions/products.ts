"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";

const CAN_MANAGE = new Set(["OWNER", "SUPER_ADMIN", "HEAD_OFFICE_ADMIN", "MANAGER"]);
async function requireProductManager(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !CAN_MANAGE.has(session.role)) return { ok: false, error: "Only owners/managers can manage the product catalogue." };
  return { ok: true };
}

export type ProductInput = {
  name: string; sku: string;
  manufacturerPartNo?: string | null; barcode?: string | null;
  category?: string | null; brand?: string | null; unit?: string;
  sellPriceSen: number; costPriceSen: number;
  minStock?: number; safetyStock?: number; leadTimeDays?: number;
  supplierId?: string | null;
};

/** 新增产品（org 级）。 */
export async function createProduct(input: ProductInput) {
  const auth = await requireProductManager();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  const org = await db.organisation.findFirst();
  const exists = await db.product.findFirst({ where: { sku: input.sku } });
  if (exists) return { ok: false as const, error: "SKU already exists." };
  await db.product.create({
    data: {
      organisationId: org!.id,
      name: input.name, sku: input.sku,
      manufacturerPartNo: input.manufacturerPartNo ?? null, barcode: input.barcode ?? null,
      category: input.category ?? null, brand: input.brand ?? null, unit: input.unit ?? "unit",
      sellPriceSen: input.sellPriceSen, costPriceSen: input.costPriceSen,
      minStock: input.minStock ?? 5, safetyStock: input.safetyStock ?? 2, leadTimeDays: input.leadTimeDays ?? 3,
      supplierId: input.supplierId ?? null,
    },
  });
  revalidatePath("/workshop/inventory/products");
  return { ok: true };
}

/** 编辑产品（org 级）。 */
export async function updateProduct(id: string, input: ProductInput) {
  const auth = await requireProductManager();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  const clash = await db.product.findFirst({ where: { sku: input.sku, NOT: { id } } });
  if (clash) return { ok: false as const, error: "SKU already exists." };
  await db.product.update({
    where: { id },
    data: {
      name: input.name, sku: input.sku,
      manufacturerPartNo: input.manufacturerPartNo ?? null, barcode: input.barcode ?? null,
      category: input.category ?? null, brand: input.brand ?? null, unit: input.unit ?? "unit",
      sellPriceSen: input.sellPriceSen, costPriceSen: input.costPriceSen,
      minStock: input.minStock ?? 5, safetyStock: input.safetyStock ?? 2, leadTimeDays: input.leadTimeDays ?? 3,
      supplierId: input.supplierId ?? null,
    },
  });
  revalidatePath("/workshop/inventory/products");
  return { ok: true };
}

/** 软删除产品（active=false，保留工单/PO/库存引用）。 */
export async function deleteProduct(id: string) {
  const auth = await requireProductManager();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  await db.product.update({ where: { id }, data: { active: false } });
  revalidatePath("/workshop/inventory/products");
  return { ok: true };
}

/** 启用/停用产品（重建目录）。 */
export async function setProductActive(id: string, active: boolean) {
  const auth = await requireProductManager();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  await db.product.update({ where: { id }, data: { active } });
  revalidatePath("/workshop/inventory/products");
  return { ok: true };
}