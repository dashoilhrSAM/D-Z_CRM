import { NextResponse, type NextRequest } from "next/server";
import { platformService } from "@/modules/platform/service";
import { requirePlatformAdmin } from "@/lib/platform/guard";

export const dynamic = "force-dynamic";

/**
 * 按租户导出（P4 收尾）：下载这家店的数据副本。
 *
 * 为什么是 **route handler** 而不是按钮 + server action：导出是一份**文件**，
 * 需要 `Content-Disposition: attachment` 才能落到店主的下载目录里；
 * server action 只能返回一个值，还得再想办法把它变成文件。
 *
 * ⚠️ 与所有平台入口一样，**自己判一次**管理员身份（layout 挡不住直接 GET 这个 URL）。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) {
    // 未登录 → 去登录；登录了但不是管理员 → 404（不确认这个路由存在）
    if (guard.reason === "anonymous") {
      return NextResponse.redirect(new URL("/login?next=" + encodeURIComponent(req.nextUrl.pathname), req.url));
    }
    return new NextResponse("Not found", { status: 404 });
  }

  const { slug } = await params;
  const detail = await platformService.tenantDetail(slug);
  if (!detail) return new NextResponse("Not found", { status: 404 });

  const res = await platformService.exportTenant({
    organisationId: detail.tenant.id,
    actor: { authId: guard.admin.authId, email: guard.admin.email },
  });
  if (!res.ok) return new NextResponse(res.error, { status: 400 });

  return new NextResponse(JSON.stringify(res.data, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="' + res.filename + '"',
      // 导出的是个人数据，别让中间层缓存
      "cache-control": "no-store",
    },
  });
}
