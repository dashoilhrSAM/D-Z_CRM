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
import { decideVerdict, rollupDay, PUNCH_VERDICTS, type AttendancePolicy } from "@/modules/attendance/policy";
import {
  MAX_RANGE_DAYS,
  addDaysKey,
  endOfMonthKey,
  parseDayKey,
  resolveRange,
} from "@/modules/attendance/range";
import { buildLedger, latestReviews, REVIEW_DECISIONS } from "@/modules/attendance/ledger";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/**
 * 取函数体：从名字起按花括号配对数到函数结束。
 *
 * 不用 concurrency-guards 里那套"找顶格两空格闭合花括号"的写法——它会被**函数内的
 * if/for 块**提前截断（updateBranch 里就有 `  }` 开头的内层块）。
 * 截断的后果正是本项目的老毛病：断言看起来在测那个函数，其实只测了前半段。
 */
const fnBody = (src: string, name: string): string => {
  const start = src.indexOf(name);
  if (start < 0) return "";
  // ① 先配对**参数列表的圆括号**：参数里常写内联对象类型（{ photoRequired?: boolean }），
  //    直接从第一个 { 开始数会在参数类型那里就归零，只切出签名——第一版就是这么假通过的。
  const parenOpen = src.indexOf("(", start);
  if (parenOpen < 0) return src.slice(start);
  let pdepth = 0;
  let afterParams = -1;
  for (let i = parenOpen; i < src.length; i++) {
    if (src[i] === "(") pdepth++;
    else if (src[i] === ")") {
      pdepth--;
      if (pdepth === 0) { afterParams = i; break; }
    }
  }
  if (afterParams < 0) return src.slice(start);
  // ② 从参数列表之后的第一个 { 开始数花括号，配对归零即函数结束
  const braceOpen = src.indexOf("{", afterParams);
  if (braceOpen < 0) return src.slice(start);
  let depth = 0;
  for (let i = braceOpen; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
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

describe("区间：看哪一段（日期算术最容易悄悄偏一天）", () => {
  const NOW = new Date("2026-09-17T02:00:00Z"); // 吉隆坡 2026-09-17 10:00（周四）

  it("默认看今天，区间含首尾", () => {
    const r = resolveRange({ now: NOW });
    expect(r.preset).toBe("today");
    expect(r.fromKey).toBe("2026-09-17");
    expect(r.toKey).toBe("2026-09-17");
    expect(r.days).toBe(1);
    expect(r.from.toISOString()).toBe("2026-09-17T00:00:00.000Z");
  });

  it("时区决定「今天是哪天」：UTC 还是 16 号、吉隆坡已经是 17 号", () => {
    const late = new Date("2026-09-16T18:00:00Z"); // +8 → 17 日 02:00
    expect(resolveRange({ now: late, timezone: "Asia/Kuala_Lumpur" }).fromKey).toBe("2026-09-17");
    expect(resolveRange({ now: late, timezone: "UTC" }).fromKey).toBe("2026-09-16");
  });

  it("本周从周一算起：周日属于上一个自然周（不是新一周的第一天）", () => {
    expect(resolveRange({ preset: "week", now: NOW }).fromKey).toBe("2026-09-14"); // 周四 → 周一
    expect(resolveRange({ preset: "week", now: new Date("2026-09-20T02:00:00Z") }).fromKey).toBe("2026-09-14"); // 周日
    expect(resolveRange({ preset: "week", now: new Date("2026-09-21T02:00:00Z") }).fromKey).toBe("2026-09-21"); // 周一
  });

  it("本月从 1 号起，且以今天收尾（未来几天没有数据，多查只是空行）", () => {
    const r = resolveRange({ preset: "month", now: NOW });
    expect(r.fromKey).toBe("2026-09-01");
    expect(r.toKey).toBe("2026-09-17");
    expect(r.days).toBe(17);
  });

  it("月末按真实天数算（2 月 28/29、30 天与 31 天）", () => {
    expect(endOfMonthKey("2026-02-01")).toBe("2026-02-28");
    expect(endOfMonthKey("2028-02-10")).toBe("2028-02-29"); // 闰年
    expect(endOfMonthKey("2026-04-15")).toBe("2026-04-30");
    expect(endOfMonthKey("2026-12-31")).toBe("2026-12-31");
  });

  it("非法日期必须拒绝，而不是悄悄滚到别的日子", () => {
    // new Date("2026-02-30T00:00:00Z") 不报错，它会滚成 3 月 2 日 —— 静默换天最危险
    expect(parseDayKey("2026-02-30")).toBeNull();
    expect(parseDayKey("2026-13-01")).toBeNull();
    expect(parseDayKey("26-01-01")).toBeNull();
    expect(parseDayKey("")).toBeNull();
    expect(parseDayKey(null)).toBeNull();
    expect(parseDayKey("2026-02-28")?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("自定义区间：坏参数退回今天；反着填的两个日期交换而不是给空结果", () => {
    const fallback = resolveRange({ preset: "custom", from: "oops", to: "2026-02-30", now: NOW });
    expect(fallback.fromKey).toBe("2026-09-17");
    expect(fallback.toKey).toBe("2026-09-17");

    const reversed = resolveRange({ preset: "custom", from: "2026-09-10", to: "2026-09-01", now: NOW });
    expect(reversed.fromKey).toBe("2026-09-01");
    expect(reversed.toKey).toBe("2026-09-10");
    expect(reversed.days).toBe(10);
    expect(reversed.clamped, "交换过就要让界面说清楚，不能静默给另一段数据").toBe(true);
  });

  it("超长区间被夹到上限并标记 clamped", () => {
    const r = resolveRange({ preset: "custom", from: "2020-01-01", to: "2026-09-17", now: NOW });
    expect(r.days).toBe(MAX_RANGE_DAYS);
    expect(r.toKey).toBe("2026-09-17");
    expect(r.fromKey).toBe(addDaysKey("2026-09-17", -(MAX_RANGE_DAYS - 1)));
    expect(r.clamped).toBe(true);
  });

  it("未知 preset 退回今天（URL 参数是用户可改的）", () => {
    expect(resolveRange({ preset: "../../etc/passwd", now: NOW }).preset).toBe("today");
    expect(resolveRange({ preset: null, now: NOW }).preset).toBe("today");
  });
});

describe("台账：把多天多人压成一张报表", () => {
  const at = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 8, day, h, m));
  const bizDay = (day: number) => new Date(Date.UTC(2026, 8, day));
  const punch = (id: string, userId: string, day: number, kind: string, h: number, verdict = "OK") => ({
    id, userId, kind, at: at(day, h), businessDate: bizDay(day), verdict,
  });

  it("跨天不串：按天配对，工时等于各天之和", () => {
    const led = buildLedger([
      punch("p1", "u1", 15, "IN", 1), punch("p2", "u1", 15, "OUT", 9),
      punch("p3", "u1", 16, "IN", 2), punch("p4", "u1", 16, "OUT", 6),
    ], []);
    expect(led.staff).toHaveLength(1);
    expect(led.staff[0].presentDays).toBe(2);
    expect(led.staff[0].workedMinutes).toBe(8 * 60 + 4 * 60);
    // 15 日 9 点下班不能被当成 16 日那段的结束（那会算出 29 小时）
    expect(led.staff[0].days.map((x) => x.dateKey)).toEqual(["2026-09-15", "2026-09-16"]);
    expect(led.staff[0].days[1].workedMinutes).toBe(4 * 60);
  });

  it("未闭合的那一段不计工时，但算作「今天还在岗」", () => {
    const led = buildLedger([
      punch("p1", "u1", 15, "IN", 1), punch("p2", "u1", 15, "OUT", 4),
      punch("p3", "u1", 15, "IN", 5),
    ], []);
    expect(led.staff[0].workedMinutes).toBe(3 * 60);
    expect(led.staff[0].days[0].open).toBe(true);
  });

  it("处置过的异常不再「待处置」，但仍计入异常数（事实不能被抹掉）", () => {
    const punches = [
      punch("p1", "u1", 15, "IN", 1, "OUT_OF_RANGE"),
      punch("p2", "u1", 15, "OUT", 9, "SUSPECT_REUSE"),
      punch("p3", "u1", 16, "IN", 1, "NO_LOCATION"),
    ];
    const before = buildLedger(punches, []);
    expect(before.staff[0].exceptionCount).toBe(3);
    expect(before.staff[0].pendingCount).toBe(3);
    expect(before.pendingPunchIds).toEqual(["p3", "p2", "p1"]); // 最新在前

    const after = buildLedger(punches, [
      { punchId: "p1", decision: "DISMISSED", reviewedBy: "m1", createdAt: at(15, 12) },
      { punchId: "p2", decision: "CONFIRMED", reviewedBy: "m1", createdAt: at(15, 12) },
    ]);
    expect(after.staff[0].exceptionCount, "异常数是系统当时的判定，处置不改它").toBe(3);
    expect(after.staff[0].pendingCount).toBe(1);
    expect(after.pendingPunchIds).toEqual(["p3"]);
  });

  it("同一笔处置两次取最新；同一毫秒的两条与查询顺序无关", () => {
    const reviews = [
      { punchId: "p1", decision: "DISMISSED", reviewedBy: "m1", createdAt: at(15, 10) },
      { punchId: "p1", decision: "CONFIRMED", reviewedBy: "m2", createdAt: at(15, 12) },
    ];
    expect(latestReviews(reviews).get("p1")?.decision).toBe("CONFIRMED");
    // 反过来查一次，结果必须一样
    expect(latestReviews([...reviews].reverse()).get("p1")?.decision).toBe("CONFIRMED");

    const sameMs = [
      { punchId: "p1", decision: "CONFIRMED", reviewedBy: "m1", createdAt: at(15, 12) },
      { punchId: "p1", decision: "DISMISSED", reviewedBy: "m2", createdAt: at(15, 12) },
    ];
    const a = latestReviews(sameMs).get("p1")?.decision;
    const b = latestReviews([...sameMs].reverse()).get("p1")?.decision;
    expect(a, "同刻并列必须定序，否则结果取决于数据库返回顺序").toBe(b);
  });

  it("NO_GEOFENCE 不算异常（门店没坐标是配置问题），也不进待处置队列", () => {
    const led = buildLedger([punch("p1", "u1", 15, "IN", 1, "NO_GEOFENCE")], []);
    expect(led.staff[0].exceptionCount).toBe(0);
    expect(led.staff[0].pendingCount).toBe(0);
    expect(led.pendingPunchIds).toEqual([]);
  });

  it("没有打卡记录的人不出现在台账里（零行由调用方决定补不补）", () => {
    const led = buildLedger([punch("p1", "u2", 15, "IN", 1)], []);
    expect(led.staff.map((s) => s.userId)).toEqual(["u2"]);
  });

  it("总数是各人之和，不是各自再算一遍", () => {
    const led = buildLedger([
      punch("p1", "u1", 15, "IN", 1), punch("p2", "u1", 15, "OUT", 5),
      punch("p3", "u2", 16, "IN", 1, "LOW_ACCURACY"), punch("p4", "u2", 16, "OUT", 4),
    ], []);
    expect(led.totals.presentDays).toBe(2);
    expect(led.totals.workedMinutes).toBe(7 * 60);
    expect(led.totals.punchCount).toBe(4);
    expect(led.totals.exceptionCount).toBe(1);
    expect(led.totals.pendingCount).toBe(1);
    // 各人之和 == 总数
    expect(led.totals.workedMinutes).toBe(led.staff.reduce((n, s) => n + s.workedMinutes, 0));
  });

  it("乱序输入不影响结果（服务端不该依赖查询顺序）", () => {
    const input = [
      punch("p3", "u1", 16, "IN", 2), punch("p1", "u1", 15, "IN", 1),
      punch("p4", "u1", 16, "OUT", 6), punch("p2", "u1", 15, "OUT", 9),
    ];
    const a = buildLedger(input, []);
    const b = buildLedger([...input].reverse(), []);
    expect(b.staff[0].workedMinutes).toBe(a.staff[0].workedMinutes);
    expect(b.staff[0].days.map((d) => d.dateKey)).toEqual(a.staff[0].days.map((d) => d.dateKey));
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

  it("政策由业务方在界面决定：动作会夹取合理区间并留痕", () => {
    const act = strip(read("src/actions/settings.ts"));
    const body = fnBody(act, "export async function updateAttendancePolicy");
    expect(body, "updateAttendancePolicy 找不到（断言会空跑）").not.toBe("");
    // 只有 org 级能改（这些值对所有门店生效）
    expect(body).toContain("auth.orgLevel");
    // 0 或负数会让"在店里"失去意义，所以必须夹区间
    expect(body, "围栏半径必须夹到合理区间").toMatch(/clamp\(input\.geofenceM/);
    expect(body, "精度上限必须夹到合理区间").toMatch(/clamp\(input\.accuracyMaxM/);
    expect(body, "改政策要进审计").toContain("audit(");

    // 围栏半径必须是"读出来的"，不是写死的常数
    const svc = strip(read("src/modules/attendance/service.ts"));
    expect(svc).toContain("attendanceGeofenceM");
    expect(svc, "不许在服务端写死 150 米").not.toMatch(/geofenceM:\s*150/);
  });

  it("门店坐标是要留痕的改动（挪一下围栏就能让越界变正常）", () => {
    const act = strip(read("src/actions/settings.ts"));
    const body = fnBody(act, "export async function updateBranch");
    expect(body).toContain("isValidLatLng(");
    expect(body, "经纬度必须成对").toContain("Latitude and longitude must be set together");
    expect(body, "改要围栏坐标要进审计").toContain("ATTENDANCE_GEOFENCE_SET");
  });

  it("考勤界面用到的每个 i18n 键都真的存在", () => {
    // 这条守卫是因为一次真实的疏忽：新面板引用了 att.policy-* / att.branch-coords 等键，
    // 但 i18n.ts 忘了提交（git status 里它还是未暂存的 M）——tsc、build、e2e 全绿，
    // 因为 t() 找不到键时只是把键名显示出来，没有任何东西会失败。
    const dict = read("src/lib/i18n.ts");
    const files = [
      "src/components/shared/attendance-punch.tsx",
      "src/components/workshop/attendance-panel.tsx",
      "src/components/workshop/attendance-policy-panel.tsx",
      "src/app/workshop/attendance/page.tsx",
      "src/app/mechanic-app/profile/page.tsx",
      "src/app/workshop/settings/page.tsx",
      "src/components/workshop/settings-forms.tsx",
      "src/components/workshop/attendance-review-queue.tsx",
      "src/components/workshop/attendance-range-picker.tsx",
    ];
    const used = new Set<string>();
    for (const f of files) {
      const src = read(f);
      // 注意是 (?:pl)? 而不是 tpl?：后者是"t + p + 可选的 l"，只匹配 tpl(，
      // 于是 t( 的键一个也扫不到——第一版就是这么写的，守卫"通过"了两轮都没发现。
      // 结尾必须是字母/数字：t("att.verdict-" + verdict) 这种**动态拼键**不能被当成一个键，
      // 否则守卫会去要一个永远不存在的 att.verdict-
      for (const m of src.matchAll(/\bt(?:pl)?\("((?:att|mech|nav|common|ws)\.[a-z0-9.-]*[a-z0-9])"/g)) used.add(m[1]);
    }
    expect(used.size, "没扫到任何 i18n 键——正则失效了，守卫会空跑").toBeGreaterThan(20);
    // 防空跑：挑一个**只用 t() 调用**的键，它必须被扫到（tpl( 那批扫到了也不说明问题）
    expect(used.has("att.policy-title"), "t() 形式的键没被扫到——正则又只匹配了 tpl(").toBe(true);
    const missing = [...used].filter((k) => !dict.includes('"' + k + '":'));
    expect(missing, "这些键在 i18n.ts 里不存在，界面上会直接显示键名：" + missing.join(", ")).toEqual([]);

    // 动态拼出来的那批（att.verdict-<verdict>）单独钉：每个结论都必须有人话可显示，
    // 否则新加一个 verdict 时界面会直接显示 "att.verdict-xxx"。
    for (const v of PUNCH_VERDICTS) {
      const key = "att.verdict-" + v.toLowerCase().replace(/_/g, "-");
      expect(dict.includes('"' + key + '":'), "结论 " + v + " 没有对应文案（" + key + "）").toBe(true);
    }
  });


  it("处置只追加：原始行与当日汇总都不许被改写（P2）", () => {
    const report = strip(read("src/modules/attendance/report.ts"));
    const body = fnBody(report, "export async function reviewPunch");
    expect(body, "reviewPunch 找不到——断言会空跑").not.toBe("");

    // 只 create，不许 update/delete/upsert：那会篡改证据链
    expect(body).toContain("attendanceReview.create(");
    expect(body, "AttendanceReview 只能追加").not.toMatch(/attendanceReview\.(update|delete|upsert)/);
    expect(body, "AttendancePunch 不许被改写").not.toMatch(/attendancePunch\.(update|delete|upsert)/);
    expect(body, "Attendance 汇总不许在处置里重算").not.toMatch(/attendance\.(update|upsert)|recomputeDay\(/);

    // 打卡服务（写入路径）不该知道处置的存在
    const svc = strip(read("src/modules/attendance/service.ts"));
    expect(svc, "打卡写入不该读处置状态——事实与看法必须分开").not.toContain("attendanceReview");
  });

  it("处置是「谁、能对哪一行做」：权限 + 分行 + 审计，一个都不能少（P2）", () => {
    const act = strip(read("src/actions/attendance-review.ts"));
    expect(act, "动作层必须自己校验权限，不能只靠页面门禁").toContain('"ATTENDANCE"');
    expect(act).toContain('"edit"');
    expect(act, "必须从会话取身份，不接受客户端传 actor").toContain("getSessionUser(");

    const report = strip(read("src/modules/attendance/report.ts"));
    const body = fnBody(report, "export async function reviewPunch");
    // 跨店处置必须被挡住，否则分行隔离在这个入口破功
    expect(body, "必须校验这笔打卡的归属分行").toContain("input.actor.branchId");
    expect(body, "必须校验组织归属").toContain("organisationId");
    // 只有被标记的才需要判断：否则这个入口就成了给任意打卡贴备注的后门
    expect(body).toContain("isException(");
    expect(body, "处置要留痕").toContain("audit(");
  });

  it("CSV 导出是「带走数据」，门禁比'能看'更严（P2）", () => {
    const route = strip(read("src/app/api/attendance/export/route.ts"));
    expect(route, "API 默认必须登录且是员工").toContain("requireStaff(");
    expect(route, "导出要额外的 export 权限").toContain('"export"');
    expect(route, "必须按分行收窄").toContain("scopedBranchId(");
    expect(route, "报表含姓名与行踪，不许有公开缓存").toContain("private, no-store");
    // 时间要按组织时区渲染：服务器时区在本地(+8)与 Vercel(UTC) 不同，工资表会差 8 小时
    expect(route, "时间必须显式按时区格式化").toContain("Intl.DateTimeFormat");
    expect(route).toContain("timeZone");
  });

  it("异常队列上的每个结论与每个失败码都有人话可显示（P2）", () => {
    const dict = read("src/lib/i18n.ts");
    // 动态拼出来的键：删掉一条就会在界面上直接显示 att.review-xxx
    for (const d of REVIEW_DECISIONS) {
      expect(dict.includes('"att.review-' + d.toLowerCase() + '":'), "缺少 " + d + " 的展示文案").toBe(true);
    }
    for (const code of [
      "NOT_FOUND", "OUT_OF_SCOPE", "NOT_AN_EXCEPTION", "BAD_DECISION", "NOTE_TOO_LONG",
      "UNAUTHORIZED", "FORBIDDEN", "UNKNOWN",
    ]) {
      const key = "att.review-err-" + code.toLowerCase().replace(/_/g, "-");
      expect(dict.includes('"' + key + '":'), "失败码 " + code + " 没有对应文案（" + key + "）").toBe(true);
    }
    // 动作返回的码必须与界面认得的码一致（少一个就会显示成 unknown）
    const act = read("src/actions/attendance-review.ts");
    for (const code of ["NOT_FOUND", "OUT_OF_SCOPE", "NOT_AN_EXCEPTION", "BAD_DECISION", "NOTE_TOO_LONG"]) {
      expect(act, "动作没有透出失败码 " + code).toContain('"' + code + '"');
    }
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
