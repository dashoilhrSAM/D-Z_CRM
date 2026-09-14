import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const auth = await requireStaff();
  if ("response" in auth) return auth.response;

  const productId = req.nextUrl.searchParams.get("productId") ?? "";
  const p = await db.product.findUnique({ where: { id: productId }, select: { supplierId: true, costPriceSen: true } });
  if (!p?.supplierId) return NextResponse.json({ supplierId: null, costSen: 0 });
  return NextResponse.json({ supplierId: p.supplierId, costSen: p.costPriceSen });
}
