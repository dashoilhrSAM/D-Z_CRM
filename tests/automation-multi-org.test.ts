// 多租户时间触发器扫描：**不能只扫第一家门店，也不能把别家的数据喂给这一家**。
//
// 为什么有这些测试（2026-09-29 容量评估，500 家门店场景）：
//   src/modules/automation/scan.ts 原实现是单租户的，且不只是「少扫几家」：
//     · db.organisation.findFirst() → 只看第一家门店的规则；
//     · 三个 findMany 完全没有租户过滤 → 把别家的提醒/预约/客户喂进**第一家门店**的
//       自动化规则（跨租户发消息）；
//     · take: 200/500/2000 是全平台共享窗口 → 门店一多，后面的永远轮不到。
//   生产现在只有 1 个 Organisation，所以这些在界面上完全看不出来。
//
// 断言分三层，每层都能失败：
//   ① 集成：A 的扫描只看得到 A 的提醒（**并带对照组**——全表确实有 2 条，否则等于没测）；
//   ② 规则判定按门店：B 有规则不影响 A；
//   ③ 结构：scan.ts / reminders.ts 里不许再出现 organisation.findFirst，且必须带租户收窄与截断自报。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import {
  hasActiveServiceDueRule,
  rotateForDay,
  scanOrganisation,
  utcDayIndex,
} from "@/modules/automation/scan";

const ORG_A = "test_scan_org_a";
const ORG_B = "test_scan_org_b";
const PLATE_A = "TESTSCAN-A";
const PLATE_B = "TESTSCAN-B";
const NOW = new Date("2026-09-29T02:00:00Z");

async function cleanup() {
  const orgs = [ORG_A, ORG_B];
  await db.automationRule.deleteMany({ where: { organisationId: { in: orgs } } });
  // AutomationExecution 没有 organisationId 列，经 rule 关系清（与 scan 里收窄提醒同一类问题）
  await db.automationExecution.deleteMany({ where: { rule: { organisationId: { in: orgs } } } });
  await db.serviceReminder.deleteMany({ where: { customer: { organisationId: { in: orgs } } } });
  await db.motorcycle.deleteMany({ where: { customer: { organisationId: { in: orgs } } } });
  await db.customer.deleteMany({ where: { organisationId: { in: orgs } } });
  await db.organisation.deleteMany({ where: { id: { in: orgs } } });
}

beforeAll(async () => {
  await cleanup();
  for (const [orgId, tag, plate] of [[ORG_A, "A", PLATE_A], [ORG_B, "B", PLATE_B]] as const) {
    await db.organisation.create({ data: { id: orgId, name: "Scan isolation " + tag } });
    const customer = await db.customer.create({ data: { organisationId: orgId, name: "Scan cust " + tag } });
    const moto = await db.motorcycle.create({
      data: { organisationId: orgId, customerId: customer.id, brand: "Honda", model: "Wave", year: 2020, plate },
    });
    await db.serviceReminder.create({
      data: {
        customerId: customer.id,
        motorcycleId: moto.id,
        status: "DUE",
        lastServiceMileage: 1000,
        intervalKm: 3000,
        nextServiceMileage: 4000,
        estimatedDate: new Date("2026-09-01T00:00:00Z"),
      },
    });
  }
});

afterAll(cleanup);

describe("按租户扫描（跨租户串数据是本项目最难发现的 bug 类）", () => {
  it("A 的扫描只看得到 A 的提醒；对照组证明库里确实有两家", async () => {
    const dueWhere = {
      closedAt: null,
      OR: [{ status: "DUE" as const }, { status: "OVERDUE" as const }, { estimatedDate: { lte: NOW } }],
    };
    // 对照组：不按租户收窄时，两家门店的提醒都在 —— 若这条不是 2，
    // 下面的 toBe(1) 就可能是「只有一条」而不是「被正确收窄」，断言失去意义。
    const raw = await db.serviceReminder.count({
      where: { ...dueWhere, customer: { organisationId: { in: [ORG_A, ORG_B] } } },
    });
    expect(raw, "对照组：两家门店各一条待发提醒").toBe(2);
    // 旧实现正是**没有**这个租户过滤（全表扫）—— 这条断言把「对照组」钉死：
    // 不加过滤就必然看到不止一条，所以上面的 toBe(1) 测的是收窄，不是「库里只有一条」。
    const unscoped = await db.serviceReminder.count({ where: dueWhere });
    expect(unscoped, "不按租户收窄时能看到不止一条（旧实现的行为）").toBeGreaterThan(1);

    const a = await scanOrganisation(ORG_A, NOW);
    const b = await scanOrganisation(ORG_B, NOW);
    expect(a.builtInRemindersInstead, "A 只该看到自己那一条").toBe(1);
    expect(b.builtInRemindersInstead, "B 也只该看到自己那一条").toBe(1);
  });

  it("「有没有 SERVICE_DUE 规则」按门店判断，不是看第一家", async () => {
    await db.automationRule.create({
      data: {
        organisationId: ORG_B,
        name: "B 的服务到期规则",
        triggerType: "TIME",
        trigger: "SERVICE_DUE",
        actions: "[]",
        active: true,
      },
    });
    expect(await hasActiveServiceDueRule(ORG_B), "B 有规则").toBe(true);
    expect(await hasActiveServiceDueRule(ORG_A), "A 没有规则——旧实现会跟着第一家一起变").toBe(false);
    // A 的扫描结果不受 B 的规则影响
    const a = await scanOrganisation(ORG_A, NOW);
    expect(a.builtInRemindersInstead).toBe(1);
  });
});

describe("跑不完时要轮转 + 如实自报（不能静默截断）", () => {
  it("rotateForDay：按天换起点，保证尾部门店不会被永远饿死", () => {
    const orgs = ["a", "b", "c", "d"];
    expect(rotateForDay(orgs, 0)).toEqual(["a", "b", "c", "d"]);
    expect(rotateForDay(orgs, 1)).toEqual(["b", "c", "d", "a"]);
    expect(rotateForDay(orgs, 5)).toEqual(["b", "c", "d", "a"]);
    expect(rotateForDay(orgs, 4)).toEqual(["a", "b", "c", "d"]);
    expect(rotateForDay([], 3)).toEqual([]);
    expect(rotateForDay(orgs, -1), "负数天也要落在合法下标上").toEqual(["d", "a", "b", "c"]);
  });

  it("轮转覆盖所有门店：连续 N 天扫「前两家」，每家都被扫到过", () => {
    const orgs = ["a", "b", "c", "d", "e"];
    const seen = new Set<string>();
    for (let day = 0; day < orgs.length; day++) {
      for (const id of rotateForDay(orgs, day).slice(0, 2)) seen.add(id);
    }
    expect(seen.size, "五天下来五家都轮到过——旧实现每天从队首开始，c/d/e 永远轮不到").toBe(5);
  });

  it("utcDayIndex 按 UTC 天递增", () => {
    expect(utcDayIndex(new Date("2026-09-29T00:00:00Z"))).toBe(utcDayIndex(new Date("2026-09-29T23:59:59Z")));
    expect(utcDayIndex(new Date("2026-09-30T00:00:00Z"))).toBe(utcDayIndex(new Date("2026-09-29T00:00:00Z")) + 1);
  });
});

describe("结构：单租户写法不许回来", () => {
  const root = process.cwd();
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const scan = stripComments(readFileSync(path.join(root, "src/modules/automation/scan.ts"), "utf8"));
  const reminders = stripComments(readFileSync(path.join(root, "src/actions/reminders.ts"), "utf8"));

  it("scan.ts 不再用 organisation.findFirst 决定规则归属", () => {
    expect(scan).not.toContain("organisation.findFirst");
    expect(scan).toContain("scanOrganisation");
  });

  it("每一类查询都按租户收窄（ServiceReminder/Booking 没有 organisationId 列，必须走关系）", () => {
    expect(scan, "提醒经 customer 收窄").toContain("customer: { organisationId }");
    expect(scan, "预约经 branch 收窄").toContain("branch: { organisationId }");
    expect(scan, "客户直接按 organisationId 收窄").toContain("where: { organisationId }");
  });

  it("跑不完要报出来，而不是看起来像「今天没事」", () => {
    for (const src of [scan, reminders]) {
      expect(src).toContain("orgsRemaining");
      expect(src).toContain("truncated");
    }
  });

  it("内置提醒不再看第一家门店、不再全平台共享 50 条配额", () => {
    expect(reminders).not.toContain("organisation.findFirst");
    expect(reminders).toContain("customer: { organisationId: org.id }");
    expect(reminders, "模板也要按门店取").toContain("organisationId: reminder.customer.organisationId");
  });
});
