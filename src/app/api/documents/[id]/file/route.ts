import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/api-auth";
import { canAccessDocument, readDocumentBytes } from "@/modules/documents/service";
import { audit } from "@/lib/auth/audit";

export const dynamic = "force-dynamic";

/**
 * 文档的**唯一出口**（P0）。
 *
 * 为什么不能给一个 URL 就完事：客户身份证、保险单属于个人数据，
 * 公开链接意味着"转发出去就再也收不回来"。这里每次读取都：
 *   ① 校验身份 → ② 校验组织 + 分行 + 模块权限 → ③ 从私有桶取字节 → ④ 写一条下载审计。
 * 响应头 private/no-store：这类文件不该躺在任何中间缓存里。
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff();
  if ("response" in auth) return auth.response;
  const user = auth.session.user!;

  const { id } = await ctx.params;
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc || doc.deletedAt) return new NextResponse("Not found", { status: 404 });

  const allowed = await canAccessDocument(
    { id: user.id, role: auth.session.role as string, organisationId: user.organisationId, branchId: user.branchId ?? null },
    doc,
  );
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  const bytes = await readDocumentBytes(doc);
  if (!bytes) return new NextResponse("Not found", { status: 404 });

  await audit({
    organisationId: doc.organisationId, branchId: doc.branchId, userId: user.id,
    action: "DOCUMENT_DOWNLOAD", entity: "Document", entityId: doc.id,
    after: { fileName: doc.fileName, kind: doc.kind },
  });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": 'inline; filename="' + doc.fileName.replace(/["\\\r\n]/g, "_") + '"',
      "Cache-Control": "private, no-store",
    },
  });
}
