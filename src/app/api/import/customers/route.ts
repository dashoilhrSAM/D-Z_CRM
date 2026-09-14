import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/api-auth";

/** Customer CSV import (IMPORT-001..013). Expects columns: name, phone, email, address, tags, notes. */
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
  for (const [i, row] of rows.entries()) {
    const name = (row.name ?? "").trim();
    const phone = (row.phone ?? "").trim();
    if (!name || !phone) { failed++; errors.push("Row " + (i + 2) + ": name and phone are required"); continue; }
    const existing = await db.customer.findFirst({ where: { organisationId: org.id, phone } });
    if (existing) { duplicates++; errors.push("Row " + (i + 2) + ": phone already exists (not overwritten) — " + name); continue; }
    try {
      await db.customer.create({
        data: {
          organisationId: org.id,
          branchId: branch?.id ?? null,
          name, phone,
          email: (row.email ?? "").trim() || null,
          address: (row.address ?? "").trim() || null,
          tags: (row.tags ?? "").trim() || null,
          notes: (row.notes ?? "").trim() || null,
          source: "CSV Import",
        },
      });
      imported++;
    } catch (e) {
      failed++;
      errors.push("Row " + (i + 2) + ": " + String((e as Error).message).slice(0, 80));
    }
  }
  return NextResponse.json({ ok: true, imported, failed, duplicates, errors });
}
