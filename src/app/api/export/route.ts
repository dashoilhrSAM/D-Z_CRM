import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/api-auth";

/** CSV export (EXPORT-001..008): customers / leads / products / bookings. */
export async function GET(req: NextRequest) {
  const auth = await requireStaff();
  if ("response" in auth) return auth.response;

  const type = req.nextUrl.searchParams.get("type") ?? "customers";
  // 2026-09-30 多租户修正（P0）：原来是 db.organisation.findFirst() —— 即"库里第一家公司"。
  // 单租户时完全看不出来；一旦有第二家门店，**任何登录用户导出的都是第一家店的客户/线索/产品**，
  // 而 products 这一路还带成本价（costPriceSen）。租户只能来自会话。
  const org = { id: auth.session.orgId };
  if (!org.id) return NextResponse.json({ error: "no org" }, { status: 500 });
  let csv = "";
  if (type === "customers") {
    const rows = await db.customer.findMany({ where: { organisationId: org.id }, orderBy: { createdAt: "desc" } });
    csv = "name,phone,email,address,tags,source,joined\n" + rows.map((r) => [r.name, r.phone ?? "", r.email ?? "", (r.address ?? "").replace(/,/g, " "), r.tags ?? "", r.source ?? "", r.joinedAt.toISOString().slice(0, 10)].join(",")).join("\n");
  } else if (type === "leads") {
    const rows = await db.lead.findMany({ where: { organisationId: org.id }, orderBy: { createdAt: "desc" } });
    csv = "leadNumber,customerName,phone,email,status,estimatedValueSen,nextFollowUpAt\n" + rows.map((r) => [r.leadNumber, r.customerName, r.phone ?? "", r.email ?? "", r.status, r.estimatedValueSen ?? "", r.nextFollowUpAt ? r.nextFollowUpAt.toISOString().slice(0, 10) : ""].join(",")).join("\n");
  } else if (type === "products") {
    const rows = await db.product.findMany({ where: { organisationId: org.id } });
    csv = "sku,name,category,brand,costPriceSen,sellPriceSen,minStock,manufacturerPartNo\n" + rows.map((r) => [r.sku, r.name, r.category ?? "", r.brand ?? "", r.costPriceSen, r.sellPriceSen, r.minStock, r.manufacturerPartNo ?? ""].join(",")).join("\n");
  } else if (type === "bookings") {
    const rows = await db.booking.findMany({ where: { branch: { organisationId: org.id } }, include: { customer: true } });
    csv = "customer,serviceType,date,timeSlot,status,source\n" + rows.map((r) => [r.customer.name, r.serviceType, r.date.toISOString().slice(0, 10), r.timeSlot, r.status, r.source].join(",")).join("\n");
  }
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="' + type + '.csv"' } });
}
