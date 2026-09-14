import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/api-auth";

/** 保存 QR feature toggles（QR-001..003）。 */
export async function POST(req: NextRequest) {
  const auth = await requireStaff();
  if ("response" in auth) return auth.response;

  const org = await db.organisation.findFirst();
  if (!org) return NextResponse.json({ ok: false, error: "No organisation" }, { status: 404 });
  const body = (await req.json()) as {
    enableMotorcycleQr?: boolean;
    enableRiderProfileQr?: boolean;
    enableWorkshopQr?: boolean;
  };
  await db.organisation.update({
    where: { id: org.id },
    data: {
      enableMotorcycleQr: body.enableMotorcycleQr ?? org.enableMotorcycleQr,
      enableRiderProfileQr: body.enableRiderProfileQr ?? org.enableRiderProfileQr,
      enableWorkshopQr: body.enableWorkshopQr ?? org.enableWorkshopQr,
    },
  });
  return NextResponse.json({ ok: true });
}
