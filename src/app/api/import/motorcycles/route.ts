
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/api-auth";

/** Motorcycle CSV import. Columns: (see template in public/csv-templates). */
export async function POST(req: NextRequest) {
  const auth = await requireStaff();
  if ("response" in auth) return auth.response;

  const org = await db.organisation.findFirst();
  if (!org) return NextResponse.json({ ok: false, error: "No organisation" });
  const branch = await db.branch.findFirst({ where: { organisationId: org.id, isMain: true } });
  const body = await req.json();
  const rows = (body.rows ?? []) as Record<string, string>[];
  let imported = 0, failed = 0, duplicates = 0;
  const errors: string[] = [];
  const num = (v: string | undefined, def = 0) => { const n = Number((v ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : def; };
  const rmToSen = (v: string | undefined) => Math.round(num(v) * 100);
  for (const [i, row] of rows.entries()) {
    const line = "Row " + (i + 2) + ": ";
    try {
      // --- resolve owner by phone ---
      const phone = (row.customerPhone ?? "").trim();
      const customer = phone ? await db.customer.findFirst({ where: { organisationId: org.id, phone } }) : null;
      if (!customer) { failed++; errors.push(line + "customer not found for phone " + (phone || "(empty)")); continue; }
      const plate = (row.plate ?? "").trim().toUpperCase();
      const brand = (row.brand ?? "").trim();
      const model = (row.model ?? "").trim();
      if (!plate || !brand || !model) { failed++; errors.push(line + "plate, brand and model are required"); continue; }
      const existing = await db.motorcycle.findUnique({ where: { plate } });
      if (existing) { duplicates++; errors.push(line + "plate already exists (not overwritten) — " + plate); continue; }
      await db.motorcycle.create({
        data: {
          customerId: customer.id,
          brand, model,
          year: Math.round(num(row.year, 2024)),
          plate,
          vin: (row.vin ?? "").trim() || null,
          engineNo: (row.engineNo ?? "").trim() || null,
          color: (row.color ?? "").trim() || null,
          type: (row.type ?? "").trim() || "UNDERBONE",
          currentMileage: Math.round(num(row.currentMileage)),
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
