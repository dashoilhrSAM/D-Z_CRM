
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/api-auth";

/** Product CSV import. Prices in RM (converted to SEN). Columns: (see template in public/csv-templates). */
export async function POST(req: NextRequest) {
  const auth = await requireStaff();
  if ("response" in auth) return auth.response;

  const org = await db.organisation.findFirst();
  if (!org) return NextResponse.json({ ok: false, error: "No organisation" });
  const body = await req.json();
  const rows = (body.rows ?? []) as Record<string, string>[];
  let imported = 0, failed = 0, duplicates = 0;
  const errors: string[] = [];
  const num = (v: string | undefined, def = 0) => { const n = Number((v ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : def; };
  const rmToSen = (v: string | undefined) => Math.round(num(v) * 100);
  for (const [i, row] of rows.entries()) {
    const line = "Row " + (i + 2) + ": ";
    try {
      const sku = (row.sku ?? "").trim();
      const name = (row.name ?? "").trim();
      if (!sku || !name) { failed++; errors.push(line + "sku and name are required"); continue; }
      const existing = await db.product.findUnique({ where: { sku } });
      if (existing) { duplicates++; errors.push(line + "sku already exists (not overwritten) — " + sku); continue; }
      let supplierId: string | null = null;
      const supplierName = (row.supplierName ?? "").trim();
      if (supplierName) {
        const s = await db.supplier.findFirst({ where: { organisationId: org.id, name: supplierName } });
        if (s) supplierId = s.id;
      }
      await db.product.create({
        data: {
          organisationId: org.id,
          sku, name,
          category: (row.category ?? "").trim() || null,
          brand: (row.brand ?? "").trim() || null,
          unit: (row.unit ?? "").trim() || "unit",
          sellPriceSen: rmToSen(row.sellPrice),
          costPriceSen: rmToSen(row.costPrice),
          minStock: Math.round(num(row.minStock, 5)),
          safetyStock: Math.round(num(row.safetyStock, 2)),
          leadTimeDays: Math.round(num(row.leadTimeDays, 3)),
          barcode: (row.barcode ?? "").trim() || null,
          manufacturerPartNo: (row.manufacturerPartNo ?? "").trim() || null,
          compatibleModels: (row.compatibleModels ?? "").trim() || null,
          supplierId,
        },
      });
      imported++;
    } catch (e) {
      failed++;
      errors.push(line + String((e as Error).message).slice(0, 80));
    }
  }
  return NextResponse.json({ ok: true, imported, failed, duplicates, errors });
}
