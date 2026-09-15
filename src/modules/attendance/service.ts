import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { storageProvider } from "@/providers";
import { PRIVATE_OBJECT_PREFIX } from "@/providers/types";
import { businessDayUtc, safeTimezone } from "@/lib/business-day";
import { audit } from "@/lib/auth/audit";
import {
  decideVerdict,
  rollupDay,
  type AttendancePolicy,
  type DayRollup,
  type GeoReading,
  type PunchVerdict,
} from "./policy";

/**
 * 考勤打卡（HRM P1）。
 *
 * 三条不会让步的规则：
 *  1. **时间只取服务端**——客户端报上来的时间一律忽略（改手机时间无效）。
 *  2. **判定只在服务端**——客户端只上传原始 lat/lng/accuracy，距离与结论在这里算。
 *  3. **记录只追加**——打卡行没有 update/delete 入口；要改只能走 AttendanceCorrection + AuditLog。
 *
 * 另外修掉一个旧缺陷：原来的实现用 upsert 写当天的行，重复打卡会把**早上那次的时间覆盖掉**。
 * 现在一天可以有多次进出，明细在 AttendancePunch，Attendance 只是当日汇总。
 */

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export interface PunchActor {
  id: string;
  organisationId: string;
  branchId: string | null;
}

export interface PunchInput {
  actor: PunchActor;
  kind: "IN" | "OUT";
  photo: { bytes: Uint8Array; mime: string } | null;
  geo: GeoReading;
  source: "WEB" | "MOBILE";
  deviceId?: string | null;
  userAgent?: string | null;
  ip?: string | null;
  /** 测试可注入；默认取真实当前时间 */
  now?: Date;
}

export interface PunchOk {
  ok: true;
  punchId: string;
  kind: "IN" | "OUT";
  at: string;
  verdict: PunchVerdict;
  distanceM: number | null;
  workedMinutes: number;
  status: "PRESENT" | "INCOMPLETE";
}

export interface PunchFail {
  ok: false;
  code: "NO_PHOTO" | "BAD_PHOTO" | "ALREADY_IN" | "NOT_IN" | "NO_USER";
  message: string;
}

export type PunchResult = PunchOk | PunchFail;

/** 组织的考勤政策（存 DB，业务方在界面决定；不写死源码常量）。 */
export async function attendancePolicyFor(organisationId: string): Promise<AttendancePolicy> {
  const org = await db.organisation.findUnique({
    where: { id: organisationId },
    select: {
      attendancePhotoRequired: true,
      attendanceGeoRequired: true,
      attendanceGeofenceM: true,
      attendanceAccuracyMaxM: true,
    },
  }).catch(() => null);
  return {
    photoRequired: org?.attendancePhotoRequired ?? true,
    geoRequired: org?.attendanceGeoRequired ?? true,
    geofenceM: org?.attendanceGeofenceM ?? 150,
    accuracyMaxM: org?.attendanceAccuracyMaxM ?? 100,
  };
}

/** 组织时区（"今天是哪天"必须按它算，不能按服务器时区）。 */
export async function organisationTimezone(organisationId: string): Promise<string> {
  const org = await db.organisation.findUnique({ where: { id: organisationId }, select: { timezone: true } }).catch(() => null);
  return safeTimezone(org?.timezone);
}

function extensionFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/**
 * 记录一次打卡。
 *
 * 顺序：先校验（照片/状态）→ 再算结论 → 再存照片 → 再落库 → 最后重算当日汇总。
 * 汇总由明细推导，不做增量加减——这样即使某一笔被更正，另一次重算就能自愈。
 */
export async function recordPunch(input: PunchInput): Promise<PunchResult> {
  const { actor, kind, geo } = input;
  const now = input.now ?? new Date();
  const policy = await attendancePolicyFor(actor.organisationId);

  if (policy.photoRequired && !input.photo) {
    return { ok: false, code: "NO_PHOTO", message: "Photo is required" };
  }
  if (input.photo && !input.photo.mime.startsWith("image/")) {
    return { ok: false, code: "BAD_PHOTO", message: "Photo must be an image" };
  }
  if (input.photo && input.photo.bytes.byteLength > MAX_PHOTO_BYTES) {
    return { ok: false, code: "BAD_PHOTO", message: "Photo too large (max 5MB)" };
  }

  const tz = await organisationTimezone(actor.organisationId);
  const businessDate = businessDayUtc(now, tz);

  // 当天的进出状态：不允许连打两次上班卡，也不允许没上班就打下班卡
  const todayPunches = await db.attendancePunch.findMany({
    where: { userId: actor.id, businessDate },
    select: { kind: true, at: true, verdict: true, photoSha256: true },
    orderBy: { at: "asc" },
  });
  const openIn = lastOpenIn(todayPunches);
  if (kind === "IN" && openIn) return { ok: false, code: "ALREADY_IN", message: "Already checked in" };
  if (kind === "OUT" && !openIn) return { ok: false, code: "NOT_IN", message: "Not checked in" };

  // 照片哈希：既用于完整性，也用于"同一张自拍反复打卡"的判定
  const photoSha256 = input.photo ? createHash("sha256").update(input.photo.bytes).digest("hex") : "";
  let photoReused = false;
  if (photoSha256) {
    const seen = await db.attendancePunch.findFirst({ where: { userId: actor.id, photoSha256 }, select: { id: true } });
    photoReused = !!seen;
  }

  // 门店坐标：没有坐标时记 NO_GEOFENCE，而不是判员工越界
  const branch = actor.branchId
    ? await db.branch.findUnique({ where: { id: actor.branchId }, select: { latitude: true, longitude: true } })
    : null;
  const branchLatLng = branch?.latitude != null && branch?.longitude != null
    ? { lat: branch.latitude, lng: branch.longitude }
    : null;

  const { verdict, distanceM } = decideVerdict({ policy, geo, branch: branchLatLng, photoReused });

  let photoKey = "";
  if (input.photo) {
    const stamp = now.toISOString().replace(/[-:T.]/g, "").slice(0, 14);
    photoKey = PRIVATE_OBJECT_PREFIX + "attendance/" + actor.id + "/" + businessDate.toISOString().slice(0, 10) + "-" + kind.toLowerCase() + "-" + stamp + "-" + photoSha256.slice(0, 8) + "." + extensionFor(input.photo.mime);
    await storageProvider.putPrivate(photoKey, input.photo.bytes, input.photo.mime);
  }

  const punch = await db.attendancePunch.create({
    data: {
      userId: actor.id,
      branchId: actor.branchId,
      kind,
      at: now,
      businessDate,
      photoKey,
      photoSha256,
      photoMime: input.photo?.mime ?? "",
      photoBytes: input.photo?.bytes.byteLength ?? 0,
      lat: geo.lat,
      lng: geo.lng,
      accuracyM: geo.accuracyM,
      distanceM,
      source: input.source,
      deviceId: input.deviceId ?? null,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
      verdict,
    },
  });

  const rollup = await recomputeDay(actor.id, businessDate, actor.branchId);

  await audit({
    organisationId: actor.organisationId,
    branchId: actor.branchId,
    userId: actor.id,
    action: "ATTENDANCE_" + kind,
    entity: "AttendancePunch",
    entityId: punch.id,
    after: { verdict, distanceM, accuracyM: geo.accuracyM, source: input.source },
    ip: input.ip ?? null,
  });

  return {
    ok: true,
    punchId: punch.id,
    kind,
    at: punch.at.toISOString(),
    verdict,
    distanceM,
    workedMinutes: rollup.workedMinutes,
    status: rollup.status,
  };
}

/** 最后一次"开了没关"的上班打卡；没有则返回 null。 */
function lastOpenIn(punches: { kind: string; at: Date }[]): Date | null {
  let open: Date | null = null;
  for (const p of punches) {
    if (p.kind === "IN") open = p.at;
    else if (p.kind === "OUT") open = null;
  }
  return open;
}

/**
 * 由明细重算当日汇总并 upsert 到 Attendance。
 * 注意保留 checkInAt/checkOutAt 两个旧字段——历史的看板与 mechanic-app 读的就是它们。
 */
export async function recomputeDay(userId: string, businessDate: Date, branchId: string | null): Promise<DayRollup> {
  const punches = await db.attendancePunch.findMany({
    where: { userId, businessDate },
    select: { kind: true, at: true, verdict: true },
    orderBy: { at: "asc" },
  });
  const day = rollupDay(punches);
  const data = {
    branchId,
    checkInAt: day.checkInAt,
    checkOutAt: day.checkOutAt,
    firstInAt: day.checkInAt,
    lastOutAt: day.checkOutAt,
    workedMinutes: day.workedMinutes,
    exceptionCount: day.exceptionCount,
    status: day.status,
  };
  await db.attendance.upsert({
    where: { userId_date: { userId, date: businessDate } },
    create: { userId, date: businessDate, ...data },
    update: data,
  });
  // 返回算出来的 rollup（而不是 DB 回读的宽类型），调用方才能拿到精确的联合类型
  return day;
}
