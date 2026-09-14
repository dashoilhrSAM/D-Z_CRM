import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generatePoster } from "@/modules/marketing/poster-gen";
import { requireStaff } from "@/lib/api-auth";

/** Delete a poster asset. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  await db.marketingAsset.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

/** Regenerate an existing poster with new requirements (edit → regenerate). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const asset = await db.marketingAsset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ ok: false, error: "Poster not found" }, { status: 404 });
  const body = await req.json();
  const title = String(body.title ?? asset.title).trim() || asset.title;
  const results = await generatePoster({
    branchId: asset.branchId,
    title,
    subtitle: body.subtitle ? String(body.subtitle) : undefined,
    promo: body.promo ? String(body.promo) : undefined,
    tone: body.tone ?? "brand",
    size: body.size ?? "SQUARE",
    visual: body.visual ?? "poster",
    assetUrl: body.assetUrl ? String(body.assetUrl) : undefined,
  });
  const { url } = results[0];
  const updated = await db.marketingAsset.update({
    where: { id },
    data: { title, url, description: "AI-generated · " + (body.size ?? "SQUARE") + " · " + (body.tone ?? "brand") },
  });
  return NextResponse.json({ ok: true, id: updated.id, url });
}
