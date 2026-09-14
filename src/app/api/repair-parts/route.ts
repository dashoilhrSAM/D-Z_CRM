import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/** Search active products for the repair job parts picker (returns id + prices + stock). */
export async function GET(req: NextRequest) {
  const auth = await requireStaff();
  if ("response" in auth) return auth.response;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q) return NextResponse.json({ parts: [] });
  const products = await db.product.findMany({
    where: { active: true, OR: [{ name: { contains: q } }, { sku: { contains: q.toUpperCase() } }, { barcode: { contains: q.toUpperCase() } }] },
    include: { inventories: { select: { quantity: true } } },
    take: 10,
  });
  return NextResponse.json({
    parts: products.map((p) => ({
      id: p.id, name: p.name, sku: p.sku, sellPriceSen: p.sellPriceSen, costPriceSen: p.costPriceSen,
      stock: p.inventories.reduce((s, i) => s + i.quantity, 0),
    })),
  });
}
