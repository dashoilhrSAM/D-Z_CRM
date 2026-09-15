import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/api-auth";
import { recordPunch } from "@/modules/attendance/service";

export const dynamic = "force-dynamic";

/** 取真实客户端 IP（Vercel 会带 x-forwarded-for）——审计与异常排查用。 */
function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}

/**
 * HRM 考勤打卡（拍照 + 定位）。
 *
 * 客户端只被允许上报**原始读数**（照片字节、lat/lng/accuracy）；时间、距离、结论
 * 全部在服务端产生——见 src/modules/attendance/service.ts 的三条不可让步规则。
 */
export async function POST(req: NextRequest) {
  const auth = await requireStaff();
  if ("response" in auth) return auth.response;
  const user = auth.session.user!;

  const form = await req.formData();
  const kind = String(form.get("kind") ?? "").toUpperCase();
  if (kind !== "IN" && kind !== "OUT") {
    return NextResponse.json({ ok: false, error: "kind must be IN or OUT" }, { status: 400 });
  }

  const num = (v: FormDataEntryValue | null): number | null => {
    if (v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const file = form.get("photo");
  const photoFile = file instanceof File ? file : null;

  const result = await recordPunch({
    actor: { id: user.id, organisationId: user.organisationId, branchId: user.branchId },
    kind,
    photo: photoFile ? { bytes: new Uint8Array(await photoFile.arrayBuffer()), mime: photoFile.type } : null,
    geo: { lat: num(form.get("lat")), lng: num(form.get("lng")), accuracyM: num(form.get("accuracyM")) },
    source: String(form.get("source") ?? "WEB") === "MOBILE" ? "MOBILE" : "WEB",
    deviceId: String(form.get("deviceId") ?? "") || null,
    userAgent: req.headers.get("user-agent"),
    ip: clientIp(req),
  });

  if (!result.ok) {
    const status = result.code === "NO_PHOTO" || result.code === "BAD_PHOTO" ? 400 : 409;
    return NextResponse.json({ ok: false, code: result.code, error: result.message }, { status });
  }
  return NextResponse.json(result);
}
