import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/api-auth";
import { storageProvider } from "@/providers";
import { can, isHeadOfficeRole } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

/**
 * 考勤照片的**唯一**出口。
 *
 * 自拍是个人数据，所以它不走公开的 /api/storage（那条路任何人拿到 URL 就能看）。
 * 这里的规则：本人可以看自己；有 ATTENDANCE:view 的人可以看本店；org 级角色看全部。
 * 响应头带 no-store —— 员工照片不该躺在任何中间缓存里。
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff();
  if ("response" in auth) return auth.response;
  const user = auth.session.user!;

  const { id } = await ctx.params;
  const punch = await db.attendancePunch.findUnique({
    where: { id },
    select: { userId: true, branchId: true, photoKey: true, photoMime: true },
  });
  if (!punch || !punch.photoKey) return new NextResponse("Not found", { status: 404 });

  let allowed = punch.userId === user.id;
  if (!allowed) {
    const role = auth.session.role;
    const seesModule = await can({ id: user.id, role: role as never, organisationId: user.organisationId }, "ATTENDANCE", "view");
    const sameBranch = punch.branchId !== null && punch.branchId === user.branchId;
    allowed = seesModule && (isHeadOfficeRole(role) || sameBranch);
  }
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  const bytes = await storageProvider.getPrivate(punch.photoKey);
  if (!bytes) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": punch.photoMime || "image/jpeg",
      "Cache-Control": "private, no-store",
    },
  });
}
