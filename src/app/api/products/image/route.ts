import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { storageProvider } from "@/providers";

/** 产品图上传：storageProvider.put（生产 Supabase dz-assets / 本地 ./storage），返回可用的 url 供 imageUrl 使用。 */
export async function POST(req: NextRequest) {
  const org = await db.organisation.findFirst();
  if (!org) return NextResponse.json({ ok: false, error: "No organisation" });
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file || !file.type.startsWith("image/")) return NextResponse.json({ ok: false, error: "An image file is required." }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ ok: false, error: "Image too large (max 5MB)." }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = "products/" + org.id.slice(-6) + "/" + Date.now() + "-" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const url = await storageProvider.put(key, bytes, file.type);
  return NextResponse.json({ ok: true, url });
}
