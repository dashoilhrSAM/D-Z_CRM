import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { storageProvider } from "@/providers";
import { requireStaff } from "@/lib/api-auth";

/** Attachment upload (FILE-001..010): stores via storage provider, records Attachment row. */
export async function POST(req: NextRequest) {
  const auth = await requireStaff();
  if ("response" in auth) return auth.response;

  const org = await db.organisation.findFirst();
  if (!org) return NextResponse.json({ ok: false, error: "No organisation" });
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const relatedType = String(form.get("relatedType") ?? "CUSTOMER");
  const relatedId = String(form.get("relatedId") ?? "");
  if (!file || !relatedId) return NextResponse.json({ ok: false, error: "file and relatedId required" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ ok: false, error: "File too large (max 10MB)" }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = "attachments/" + org.id.slice(-6) + "/" + relatedType.toLowerCase() + "/" + Date.now() + "-" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const url = await storageProvider.put(key, bytes, file.type);
  await db.attachment.create({
    data: { organisationId: org.id, relatedType, relatedId, fileName: file.name, mimeType: file.type, sizeBytes: file.size, url },
  });
  return NextResponse.json({ ok: true, url });
}
