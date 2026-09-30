"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";

const CAN_MANAGE = new Set(["OWNER", "SUPER_ADMIN", "HEAD_OFFICE_ADMIN", "MANAGER"]);
async function requireProductManager(): Promise<{ ok: true; orgId: string } | { ok: false; error: string }> {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !CAN_MANAGE.has(session.role)) return { ok: false, error: "Only owners/managers can manage the product catalogue." };
  // 组织取会话，不用 organisation.findFirst()：多租户下后者等于"第一个组织"，
  // 于是新建产品会落进错误的租户，而按裸 id 的更新/停用则能改到别的租户的产品。
  return { ok: true, orgId: session.orgId };
}

export type ProductInput = {
  name: string; sku: string;
  manufacturerPartNo?: string | null; barcode?: string | null;
  category?: string | null; brand?: string | null; unit?: string;
  sellPriceSen: number; costPriceSen: number;
  minStock?: number; safetyStock?: number; leadTimeDays?: number;
  supplierId?: string | null;
  imageUrl?: string | null;
};

/** 新增产品（org 级）。 */
export async function createProduct(input: ProductInput) {
  const auth = await requireProductManager();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  const exists = await db.product.findFirst({ where: { sku: input.sku, organisationId: auth.orgId } });
  if (exists) return { ok: false as const, error: "SKU already exists." };
  await db.product.create({
    data: {
      organisationId: auth.orgId,
      name: input.name, sku: input.sku,
      manufacturerPartNo: input.manufacturerPartNo ?? null, barcode: input.barcode ?? null,
      category: input.category ?? null, brand: input.brand ?? null, unit: input.unit ?? "unit",
      sellPriceSen: input.sellPriceSen, costPriceSen: input.costPriceSen,
      minStock: input.minStock ?? 5, safetyStock: input.safetyStock ?? 2, leadTimeDays: input.leadTimeDays ?? 3,
      supplierId: input.supplierId ?? null, imageUrl: input.imageUrl ?? null,
    },
  });
  revalidatePath("/workshop/inventory/products");
  return { ok: true };
}

/** 编辑产品（org 级）。 */
export async function updateProduct(id: string, input: ProductInput) {
  const auth = await requireProductManager();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  const clash = await db.product.findFirst({ where: { sku: input.sku, organisationId: auth.orgId, NOT: { id } } });
  if (clash) return { ok: false as const, error: "SKU already exists." };
  // 先查归属再改：Product 有 organisationId，但 update 的 where 只接受唯一键，
  // 所以要一次 findFirst 判定"存在且属于本组织"，跨租户一律 "Not found"。
  if (!(await db.product.findFirst({ where: { id, organisationId: auth.orgId }, select: { id: true } }))) {
    return { ok: false as const, error: "Not found" };
  }
  await db.product.update({
    where: { id },
    data: {
      name: input.name, sku: input.sku,
      manufacturerPartNo: input.manufacturerPartNo ?? null, barcode: input.barcode ?? null,
      category: input.category ?? null, brand: input.brand ?? null, unit: input.unit ?? "unit",
      sellPriceSen: input.sellPriceSen, costPriceSen: input.costPriceSen,
      minStock: input.minStock ?? 5, safetyStock: input.safetyStock ?? 2, leadTimeDays: input.leadTimeDays ?? 3,
      supplierId: input.supplierId ?? null, imageUrl: input.imageUrl ?? null,
    },
  });
  revalidatePath("/workshop/inventory/products");
  return { ok: true };
}

/** 软删除产品（active=false，保留工单/PO/库存引用）。 */
export async function deleteProduct(id: string) {
  const auth = await requireProductManager();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  const res = await db.product.updateMany({ where: { id, organisationId: auth.orgId }, data: { active: false } });
  if (res.count === 0) return { ok: false as const, error: "Not found" };
  revalidatePath("/workshop/inventory/products");
  return { ok: true };
}

/** 启用/停用产品（重建目录）。 */
export async function setProductActive(id: string, active: boolean) {
  const auth = await requireProductManager();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  const res = await db.product.updateMany({ where: { id, organisationId: auth.orgId }, data: { active } });
  if (res.count === 0) return { ok: false as const, error: "Not found" };
  revalidatePath("/workshop/inventory/products");
  return { ok: true };
}