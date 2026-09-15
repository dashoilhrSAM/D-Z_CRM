/**
 * 考勤判定与当日汇总 —— **纯函数**，没有 DB、没有网络。
 *
 * 为什么单独抽出来：这些规则（多远算越界、多不准算低精度、重复照片算可疑、一天干了多久）
 * 是考勤功能里唯一「算错了也看不出来」的部分——界面照样显示一个时间。
 * 抽成纯函数才能在单测里把每种组合钉死（见 tests/attendance.test.ts）。
 *
 * 判定权在服务端：客户端只能上报原始 lat/lng/accuracy，距离与结论都由这里算。
 */
import { haversineMeters, isValidLatLng, type LatLng } from "@/lib/geo";

/** 一次打卡的结论。除了 OK / NO_GEOFENCE，其余都会计入当日异常数。 */
export type PunchVerdict =
  | "OK"             // 在店里、精度够、照片没用过
  | "NO_GEOFENCE"    // 门店还没填坐标 —— 是配置缺口，不是员工的错，不计异常
  | "OUT_OF_RANGE"   // 距离超出围栏
  | "LOW_ACCURACY"   // 定位精度太差，判不了是否在店
  | "NO_LOCATION"    // 没拿到定位（室内、拒绝授权）
  | "SUSPECT_REUSE"; // 这张照片之前用过（同一张自拍反复打卡）

/** 全部结论（界面文案与它一一对应，tests/attendance.test.ts 会逐个检查有没有对应 i18n 键）。 */
export const PUNCH_VERDICTS: PunchVerdict[] = ["OK", "NO_GEOFENCE", "OUT_OF_RANGE", "LOW_ACCURACY", "NO_LOCATION", "SUSPECT_REUSE"];

/** 会计入「异常」的结论。NO_GEOFENCE 是配置问题，不该让员工背。 */
export const EXCEPTION_VERDICTS: PunchVerdict[] = ["OUT_OF_RANGE", "LOW_ACCURACY", "NO_LOCATION", "SUSPECT_REUSE"];

export function isException(verdict: string): boolean {
  return (EXCEPTION_VERDICTS as string[]).includes(verdict);
}

export interface AttendancePolicy {
  /** 必须有照片（缺照片直接拒绝打卡，不是记一笔） */
  photoRequired: boolean;
  /** 必须有定位；缺定位仍可打卡，但会记 NO_LOCATION 待主管确认 */
  geoRequired: boolean;
  /** 围栏半径（米） */
  geofenceM: number;
  /** 定位精度上限（米）；超过就判不了在不在店 */
  accuracyMaxM: number;
}

export interface GeoReading {
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
}

export interface VerdictInput {
  policy: AttendancePolicy;
  geo: GeoReading;
  /** 门店坐标；null = 还没配置 */
  branch: LatLng | null;
  /** 这张照片的哈希是否已经在这个人的历史打卡里出现过 */
  photoReused: boolean;
}

export interface VerdictResult {
  verdict: PunchVerdict;
  /** 服务端算出的距离；算不出来时为 null */
  distanceM: number | null;
}

/**
 * 结论的优先级（先命中先返回）：
 *   照片重复 > 没定位 > 越界 > 精度不够 > 门店没坐标 > 正常
 *
 * 顺序是有意的：照片重复是最强证据（人可能压根不在，照片是真的旧），
 * 所以即使距离正常也先报可疑；反过来「门店没坐标」最弱，它只说明我们判不了。
 */
export function decideVerdict(input: VerdictInput): VerdictResult {
  const { geo, branch, photoReused, policy } = input;
  const hasFix = isValidLatLng(geo.lat, geo.lng);
  const distanceM = hasFix && branch ? haversineMeters({ lat: geo.lat as number, lng: geo.lng as number }, branch) : null;

  if (photoReused) return { verdict: "SUSPECT_REUSE", distanceM };

  if (!hasFix) {
    // 没定位：开关说"必须定位"时记成异常待确认；说"不强制"时（例如外勤销售）
    // 就正常打卡 —— 但 lat/lng 仍留空，原始事实不会被抹掉。
    return { verdict: policy.geoRequired ? "NO_LOCATION" : "OK", distanceM: null };
  }

  if (!branch) return { verdict: "NO_GEOFENCE", distanceM: null };

  if (distanceM !== null && distanceM > policy.geofenceM) return { verdict: "OUT_OF_RANGE", distanceM };

  // 精度太差时即使距离看起来没问题也不可信（基站定位能差几公里）
  if (geo.accuracyM !== null && geo.accuracyM > policy.accuracyMaxM) return { verdict: "LOW_ACCURACY", distanceM };

  return { verdict: "OK", distanceM };
}

export interface PunchLite {
  kind: string;
  at: Date;
  verdict: string;
}

export interface DayRollup {
  checkInAt: Date | null;
  checkOutAt: Date | null;
  workedMinutes: number;
  exceptionCount: number;
  status: "PRESENT" | "INCOMPLETE";
}

/**
 * 把一天的打卡明细汇总成一行。
 *
 * 成对计算在岗时长：IN 开一个区间，OUT 关掉它。**未闭合的区间不计入**
 * （人还在上班时不该显示一个"已经干了 3 小时"的数字），多段进出会累加。
 */
export function rollupDay(punches: PunchLite[]): DayRollup {
  const sorted = [...punches].sort((a, b) => a.at.getTime() - b.at.getTime());
  let openIn: Date | null = null;
  let workedMs = 0;
  let firstInAt: Date | null = null;
  let lastOutAt: Date | null = null;
  let exceptionCount = 0;

  for (const p of sorted) {
    if (isException(p.verdict)) exceptionCount++;
    if (p.kind === "IN") {
      if (!openIn) openIn = p.at;
      if (!firstInAt) firstInAt = p.at;
    } else if (p.kind === "OUT") {
      if (openIn) {
        workedMs += p.at.getTime() - openIn.getTime();
        openIn = null;
      }
      lastOutAt = p.at;
    }
  }

  return {
    checkInAt: firstInAt,
    checkOutAt: lastOutAt,
    workedMinutes: Math.max(0, Math.round(workedMs / 60000)),
    exceptionCount,
    // 打了上班卡还没打下班卡 = INCOMPLETE，看板据此把"还在岗"和"今天结束了"分开
    status: openIn ? "INCOMPLETE" : "PRESENT",
  };
}
