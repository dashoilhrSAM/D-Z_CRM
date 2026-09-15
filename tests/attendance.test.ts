// 考勤（HRM P1）的守卫。
//
// 分两层：
//  1. **纯函数**：业务日、距离、结论、当日汇总。这些是"算错了也看不出来"的部分——
//     界面照样显示一个时间，所以只能在单测里把每种组合钉死。
//  2. **源码守卫**：打卡的证据链是"服务端说了算 + 照片不可公开"两件事，
//     它们靠写法维持，所以这里断言写法（并做过反向验证）。
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { businessDayKey, businessDayUtc, safeTimezone } from "@/lib/business-day";
import { haversineMeters, isValidLatLng } from "@/lib/geo";
import { decideVerdict, rollupDay, type AttendancePolicy } from "@/modules/attendance/policy";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** 取函数体：从 name 起，到顶格两空格闭合花括号为止（与 concurrency-guards 同一套小心思）。 */
const fnBody = (src: string, name: string): string => {
  const start = src.indexOf(name);
  if (start < 0) return "";
  const end = src.slice(start).search(/\n  \}\n/);
  return end < 0 ? src.slice(start) : src.slice(start, start + end);
};

const POLICY: AttendancePolicy = { photoRequired: true, geoRequired: true, geofenceM: 150, accuracyMaxM: 100 };
const BRANCH = { lat: 3.1390, lng: 101.6869 }; // 吉隆坡

describe("业务日：按组织时区算，而不是服务器时区", () => {
  it("UTC 还是昨天、吉隆坡已经是今天 —— 这正是历史上两端日期对不上的原因", () => {
    const at = new Date("2026-09-14T18:30:00Z"); // +8 → 2026-09-15 02:30
    expect(businessDayKey(at, "Asia/Kuala_Lumpur")).toBe("2026-09-15");
    expect(businessDayKey(at, "UTC")).toBe("2026-09-14");
    expect(businessDayUtc(at, "Asia/Kuala_Lumpur").toISOString()).toBe("2026-09-15T00:00:00.000Z");
  });

  it("业务日存的是 UTC 零点（与项目既有约定一致）", () => {
    const day = businessDayUtc(new Date("2026-09-15T05:00:00Z"), "Asia/Kuala_Lumpur");
    expect(day.toISOString()).toBe("2026-09-15T00:00:00.000Z");
  });

  it("时区字符串坏掉时退回默认值，而不是让页面崩掉", () => {
    expect(safeTimezone("Not/AZone")).toBe("Asia/Kuala_Lumpur");
    expect(safeTimezone(null)).toBe("Asia/Kuala_Lumpur");
    expect(safeTimezone("Asia/Kuala_Lumpur")).toBe("Asia/Kuala_Lumpur");
  });
});

describe("坐标与距离", () => {
  it("同一点距离为 0，纬度 0.001° 约 111 米", () => {
    expect(haversineMeters(BRANCH, BRANCH)).toBe(0);
    const north = haversineMeters(BRANCH, { lat: BRANCH.lat + 0.001, lng: BRANCH.lng });
    expect(Math.round(north)).toBeGreaterThan(105);
    expect(Math.round(north)).toBeLessThan(118);
  });

  it("(0,0) 当作无效坐标——它是「没有定位」最经典的伪装值", () => {
    expect(isValidLatLng(0, 0)).toBe(false);
    expect(isValidLatLng(null, 101.6)).toBe(false);
    expect(isValidLatLng(NaN, 101.6)).toBe(false);
    expect(isValidLatLng(91, 101.6)).toBe(false);
    expect(isValidLatLng(3.139, 101.6869)).toBe(true);
  });
});

describe("结论判定：优先级与每种组合", () => {
  const inRange = { lat: BRANCH.lat + 0.0004, lng: BRANCH.lng }; // ~45m
  const farAway = { lat: BRANCH.lat + 0.02, lng: BRANCH.lng }; // ~2.2km

  it("范围内 + 精度够 → OK，并给出服务端算的距离", () => {
    const r = decideVerdict({ policy: POLICY, geo: { lat: inRange.lat, lng: inRange.lng, accuracyM: 12 }, branch: BRANCH, photoReused: false });
    expect(r.verdict).toBe("OK");
    expect(r.distanceM).toBeGreaterThan(30);
    expect(r.distanceM).toBeLessThan(60);
  });

  it("超出围栏 → OUT_OF_RANGE", () => {
    const r = decideVerdict({ policy: POLICY, geo: { lat: farAway.lat, lng: farAway.lng, accuracyM: 10 }, branch: BRANCH, photoReused: false });
    expect(r.verdict).toBe("OUT_OF_RANGE");
  });

  it("精度太差 → LOW_ACCURACY（即使距离看起来正常）", () => {
    const r = decideVerdict({ policy: POLICY, geo: { lat: inRange.lat, lng: inRange.lng, accuracyM: 900 }, branch: BRANCH, photoReused: false });
    expect(r.verdict).toBe("LOW_ACCURACY");
  });

  it("没定位：开关说必须定位就记异常，说不强制就正常打卡", () => {
    const missing = { lat: null, lng: null, accuracyM: null };
    expect(decideVerdict({ policy: POLICY, geo: missing, branch: BRANCH, photoReused: false }).verdict).toBe("NO_LOCATION");
    expect(decideVerdict({ policy: { ...POLICY, geoRequired: false }, geo: missing, branch: BRANCH, photoReused: false }).verdict).toBe("OK");
  });

  it("门店还没填坐标 → NO_GEOFENCE（是配置缺口，不是员工的错）", () => {
    const r = decideVerdict({ policy: POLICY, geo: { lat: 3.2, lng: 101.7, accuracyM: 10 }, branch: null, photoReused: false });
    expect(r.verdict).toBe("NO_GEOFENCE");
    expect(r.distanceM).toBeNull();
  });

  it("照片重复优先于其它一切——即使人在店里、定位很准", () => {
    const r = decideVerdict({ policy: POLICY, geo: { lat: inRange.lat, lng: inRange.lng, accuracyM: 5 }, branch: BRANCH, photoReused: true });
    expect(r.verdict).toBe("SUSPECT_REUSE");
  });

  it("围栏半径是可配置的：同样的坐标，150m 通过、50m 不通过", () => {
    const geo = { lat: BRANCH.lat + 0.0008, lng: BRANCH.lng, accuracyM: 10 }; // ~89m
    expect(decideVerdict({ policy: { ...POLICY, geofenceM: 150 }, geo, branch: BRANCH, photoReused: false }).verdict).toBe("OK");
    expect(decideVerdict({ policy: { ...POLICY, geofenceM: 50 }, geo, branch: BRANCH, photoReused: false }).verdict).toBe("OUT_OF_RANGE");
  });
});

describe("当日汇总", () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 15, h, m));

  it("一次进出算出在岗分钟", () => {
    const day = rollupDay([
      { kind: "IN", at: at(1), verdict: "OK" },
      { kind: "OUT", at: at(10, 30), verdict: "OK" },
    ]);
    expect(day.workedMinutes).toBe(570);
    expect(day.checkInAt?.toISOString()).toBe(at(1).toISOString());
    expect(day.checkOutAt?.toISOString()).toBe(at(10, 30).toISOString());
    expect(day.status).toBe("PRESENT");
  });

  it("多段进出累加（午饭外出不算工时）", () => {
    const day = rollupDay([
      { kind: "IN", at: at(1), verdict: "OK" },
      { kind: "OUT", at: at(4), verdict: "OK" },
      { kind: "IN", at: at(5), verdict: "OK" },
      { kind: "OUT", at: at(10), verdict: "OK" },
    ]);
    expect(day.workedMinutes).toBe(8 * 60);
  });

  it("还没打下班卡：状态是 INCOMPLETE，且未闭合的那段不计入工时", () => {
    const day = rollupDay([
      { kind: "IN", at: at(1), verdict: "OK" },
      { kind: "OUT", at: at(4), verdict: "OK" },
      { kind: "IN", at: at(5), verdict: "OK" },
    ]);
    expect(day.status).toBe("INCOMPLETE");
    expect(day.workedMinutes).toBe(3 * 60);
  });

  it("异常数只数「要人看的」：NO_GEOFENCE 是配置缺口，不该算到员工头上", () => {
    const day = rollupDay([
      { kind: "IN", at: at(1), verdict: "OK" },
      { kind: "OUT", at: at(9), verdict: "NO_GEOFENCE" },
    ]);
    expect(day.exceptionCount).toBe(0);
    const flagged = rollupDay([
      { kind: "IN", at: at(1), verdict: "OUT_OF_RANGE" },
      { kind: "OUT", at: at(9), verdict: "SUSPECT_REUSE" },
    ]);
    expect(flagged.exceptionCount).toBe(2);
  });

  it("明细乱序也能算对（按时间排序后再配对）", () => {
    const day = rollupDay([
      { kind: "OUT", at: at(9), verdict: "OK" },
      { kind: "IN", at: at(1), verdict: "OK" },
    ]);
    expect(day.workedMinutes).toBe(8 * 60);
  });
});

describe("源码守卫：证据链靠写法维持", () => {
  it("打卡服务只信服务端时间与自己的判定", () => {
    const svc = strip(read("src/modules/attendance/service.ts"));
    expect(svc).toContain("decideVerdict(");
    // 客户端不许通过表单指定结论或距离
    expect(svc).not.toMatch(/input\.verdict|input\.distanceM/);
    const route = strip(read("src/app/api/attendance/punch/route.ts"));
    expect(route, "路由不该接受客户端传来的结论/距离").not.toContain('form.get("verdict")');
    expect(route).not.toContain('form.get("distanceM")');
    expect(route, "打卡路由必须走统一门禁").toContain("requireStaff(");
  });

  it("旧的两份 max+1 式打卡已经不存在（upsert 覆盖当天上班时间那个 bug）", () => {
    expect(existsSync(path.join(process.cwd(), "src/actions/attendance.ts")), "旧的打卡 action 必须删掉").toBe(false);
    const actions = strip(read("src/modules/attendance/service.ts"));
    // 唯一允许写 checkInAt 的地方是 recomputeDay（由明细推导）
    const writes = actions.split("\n").filter((l) => /checkInAt:/.test(l) && !/day\.checkInAt|attendance: \{/.test(l));
    expect(writes.length, "checkInAt 只应来自 rollup，不该由入参决定").toBeLessThanOrEqual(1);
    expect(actions).toContain("recomputeDay(");
  });

  it("考勤照片只能走私有桶 + 鉴权路由", () => {
    const svc = strip(read("src/modules/attendance/service.ts"));
    expect(svc, "照片必须存进私有对象").toContain("putPrivate(");
    expect(svc, "不许用会返回公开 URL 的 put()").not.toMatch(/storageProvider\.put\(/);
    expect(svc).toContain("PRIVATE_OBJECT_PREFIX");

    const pub = strip(read("src/app/api/storage/[...key]/route.ts"));
    expect(pub, "公共出口必须挡掉私有对象").toContain("isPrivateObjectKey(");

    const photo = strip(read("src/app/api/attendance/photo/[id]/route.ts"));
    expect(photo).toContain("requireStaff(");
    expect(photo).toContain("getPrivate(");
    expect(photo, "私有照片不能有公开缓存").toContain("private, no-store");
  });

  it("两个 storage provider 都实现了私有读写，且私有写入不返回 URL", () => {
    for (const f of ["src/providers/storage/local.ts", "src/providers/storage/supabase.ts"]) {
      const src = read(f);
      expect(src, f + " 缺少 putPrivate").toContain("putPrivate(");
      expect(src, f + " 缺少 getPrivate").toContain("getPrivate(");
      const body = fnBody(src, "async putPrivate");
      expect(body, f + " 的 putPrivate 找不到").not.toBe("");
      expect(body, f + " 的 putPrivate 不许返回可公开访问的 URL").not.toContain("object/public");
      expect(body, f + " 的 putPrivate 必须拒绝非私有前缀").toContain("isPrivateObjectKey(");
    }
    const supabase = read("src/providers/storage/supabase.ts");
    expect(supabase, "私有桶与公共桶必须是两个").toContain("privateBucket");
  });

  it("考勤照片路由不在 API 公开白名单里", () => {
    const mw = read("src/middleware.ts");
    const list = mw.slice(mw.indexOf("API_PUBLIC"), mw.indexOf("API_PUBLIC") + 1200);
    expect(list, "attendance 不能出现在 API 公开白名单").not.toContain("attendance");
  });

  it("考勤页不再只列技师，且用同一个打卡组件", () => {
    // 注意 strip：注释里正好写着"原来硬过滤 role: MECHANIC"这句解释，
    // 不剥注释的话这条守卫会被自己的注释喂饱（第一版就是这么假通过的）。
    const page = strip(read("src/app/workshop/attendance/page.tsx"));
    expect(page, "不许再按 role: MECHANIC 过滤").not.toContain('role: "MECHANIC"');
    expect(page).toContain("scopedBranchId(");
    const nav = read("src/lib/nav-registry.ts");
    expect(nav, "考勤有独立的权限模块").toContain('module: "ATTENDANCE"');
    expect(nav, "柜台/销售也要能打卡").toMatch(/key: "attendance"[^\n]*COUNTER_STAFF/);
    // 三个入口共用一个组件
    expect(read("src/components/workshop/attendance-panel.tsx")).toContain("AttendancePunch");
    expect(read("src/app/mechanic-app/profile/page.tsx")).toContain("AttendancePunch");
  });
});
