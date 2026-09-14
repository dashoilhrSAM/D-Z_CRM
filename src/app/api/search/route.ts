import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/api-auth";

/** Global search endpoint (§18): customers, motorcycles, jobs, products. */
export async function GET(req: NextRequest) {
  const auth = await requireStaff();
  if ("response" in auth) return auth.response;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q) return NextResponse.json({ hits: [] });
  const hits: { type: string; label: string; sub: string; href: string }[] = [];

  const customers = await db.customer.findMany({
    where: { OR: [{ name: { contains: q } }, { phone: { contains: q } }, { motorcycles: { some: { plate: { contains: q } } } }] },
    include: { motorcycles: true },
    take: 5,
  });
  for (const c of customers) {
    hits.push({ type: "customer", label: c.name, sub: (c.phone ?? "") + " · " + c.motorcycles.map((m) => m.plate).join(", "), href: "/workshop/customers/" + c.id });
  }

  const bikes = await db.motorcycle.findMany({
    where: { OR: [{ plate: { contains: q } }, { model: { contains: q } }, { brand: { contains: q } }] },
    include: { customer: true },
    take: 5,
  });
  for (const b of bikes) {
    hits.push({ type: "motorcycle", label: b.brand + " " + b.model + " · " + b.plate, sub: b.customer.name + " · " + b.currentMileage.toLocaleString() + " km", href: "/workshop/customers/" + b.customerId });
  }

  const jobs = await db.serviceJob.findMany({ where: { jobNumber: { contains: q.toUpperCase() } }, include: { customer: true }, take: 5 });
  for (const j of jobs) {
    hits.push({ type: "job", label: j.jobNumber + " · " + (j.packageName ?? "Service"), sub: j.customer.name + " · " + j.status, href: "/workshop/jobs/" + j.id });
  }

  const products = await db.product.findMany({ where: { OR: [{ name: { contains: q } }, { sku: { contains: q.toUpperCase() } }, { barcode: { contains: q.toUpperCase() } }] }, take: 5 });
  for (const p of products) {
    hits.push({ type: "product", label: p.name, sub: p.sku + " · RM" + (p.sellPriceSen / 100), href: "/workshop/inventory/stock" });
  }

  // email search (SEARCH-004)
  const byEmail = await db.customer.findMany({ where: { email: { contains: q } }, take: 3 });
  for (const c of byEmail) {
    hits.push({ type: "customer", label: c.name, sub: "email · " + (c.email ?? ""), href: "/workshop/customers/" + c.id });
  }
  // VIN search (SEARCH-006)
  const byVin = await db.motorcycle.findMany({ where: { vin: { contains: q.toUpperCase() } }, include: { customer: true }, take: 3 });
  for (const b of byVin) {
    hits.push({ type: "motorcycle", label: b.brand + " " + b.model, sub: "VIN " + b.vin + " · " + b.customer.name, href: "/workshop/customers/" + b.customerId });
  }
  // leads (SEARCH-007)
  const leads = await db.lead.findMany({ where: { OR: [{ customerName: { contains: q } }, { phone: { contains: q } }, { leadNumber: { contains: q.toUpperCase() } }] }, take: 5 });
  for (const l of leads) {
    hits.push({ type: "lead", label: l.customerName, sub: l.leadNumber + " · " + (l.phone ?? ""), href: "/workshop/leads/" + l.id });
  }
  // bookings (SEARCH-008)
  const bookings = await db.booking.findMany({ where: { customer: { name: { contains: q } } }, include: { customer: true }, take: 5 });
  for (const bk of bookings) {
    hits.push({ type: "booking", label: bk.customer.name + " · " + bk.serviceType, sub: bk.date.toISOString().slice(0, 10) + " " + bk.timeSlot + " · " + bk.status, href: "/workshop/bookings" });
  }

  return NextResponse.json({ hits });
}
