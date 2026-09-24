import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { storageProvider } from "@/providers";
import { requireStaff } from "@/lib/api-auth";
import { jobService } from "@/modules/service-jobs/service";

export const dynamic = "force-dynamic";

type JobPhotoAngle = "FRONT" | "BACK" | "LEFT" | "RIGHT" | "METER";
const ANGLES: JobPhotoAngle[] = ["FRONT", "BACK", "LEFT", "RIGHT", "METER"];

/** Pre-service SOP photo upload (SOP-001): mechanic captures 5 condition photos before starting a job. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // 统一到 requireStaff()：这个路由本来就校验得对，改成同一入口是为了让
  // 「每个非公开 API 都用同一个门禁」成为可 grep、可断言的不变量（见 tests/api-auth.test.ts）。
  const auth = await requireStaff();
  if ("response" in auth) return auth.response;

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const angleRaw = String(form.get("angle") ?? "").toUpperCase();
  if (!ANGLES.includes(angleRaw as JobPhotoAngle)) return NextResponse.json({ ok: false, error: "Invalid angle" }, { status: 400 });
  if (!file) return NextResponse.json({ ok: false, error: "file required" }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ ok: false, error: "Image required" }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ ok: false, error: "File too large (max 8MB)" }, { status: 400 });

  const job = await db.serviceJob.findUnique({ where: { id }, select: { id: true, mechanicId: true, status: true } });
  if (!job) return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
  if (job.mechanicId !== auth.session.user!.id) return NextResponse.json({ ok: false, error: "Not your job" }, { status: 403 });
  if (job.status !== "WAITING") return NextResponse.json({ ok: false, error: "Only before service starts" }, { status: 400 });

  const angle = angleRaw as JobPhotoAngle;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = ((file.name.split(".").pop() ?? "jpg").replace(/[^a-z0-9]/gi, "") || "jpg").toLowerCase();
  const key = "job-photos/" + id + "/" + angle.toLowerCase() + "-" + Date.now() + "." + ext;
  const url = await storageProvider.put(key, bytes, file.type);
  await db.serviceJobPhoto.upsert({
    where: { jobId_angle: { jobId: id, angle } },
    create: { jobId: id, angle, photoUrl: url, capturedById: auth.session.user!.id },
    update: { photoUrl: url, capturedById: auth.session.user!.id, capturedAt: new Date() },
  });

  // **拍齐 5 张 = 接单完成 → 直接开工**（老板反馈：点了 accept order 之后应当变成 in progress）。
  // 以前必须先在别的页拍完照、再回来重新点接单，中间那一趟看起来像「接了但没接上」。
  // 报价门禁（QUOT-001）仍由 service 把关：过不了就静静留待，卡片上会写明在等客户确认。
  let started = false;
  const photoCount = await db.serviceJobPhoto.count({ where: { jobId: id } });
  if (photoCount >= 5) {
    try {
      await jobService.transition(id, "IN_PROGRESS");
      started = true;
    } catch {
      // 报价未确认 / 非法状态等都走这里；不影响照片已经存好这件事
    }
  }
  return NextResponse.json({ ok: true, url, started, photoCount });
}
