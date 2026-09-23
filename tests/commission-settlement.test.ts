// P4 结算整合的测试：发薪时的佣金数字从哪来。
//
// 三条最容易被写错的规则，逐条钉住：
//  ① 按 **earnedAt**（计提时刻）取数 —— 上月的工单今天完工，钱要发在这个周期（设计稿 §4.4）；
//  ② 没有台账 → **保留旧口径，绝不当成 0**（P2 之前的历史工单没有台账行，
//     当成 0 就是把老账一键清零）；
//  ③ 已付款（PAID）→ 金额冻结，绝不再改。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { periodWindow } from "@/lib/period";
import { resolvePayoutCommission } from "@/modules/commission/settlement";

const saved = { databaseUrl: process.env.DATABASE_URL };
const tag = "s" + Date.now().toString(36);

let db: typeof import("@/lib/db")["db"];
let commissionFromLedger: typeof import("@/modules/commission/settlement")["commissionFromLedger"];
let commissionBreakdownFor: typeof import("@/modules/commission/settlement")["commissionBreakdownFor"];

let orgId = "";
let userId = "";
const PERIOD_START = new Date("2026-09-01T00:00:00Z");
const { start, end } = periodWindow("month", PERIOD_START);

/** 造一条台账行（直接写台账是合法的：这里测的是**结算读什么**，计提路径已有独立端到端测试）。 */
async function row(kind: string, amountSen: number, earnedAt: Date, windowKey: string, extra: Record<string, unknown> = {}) {
  return db.commissionLedger.create({
    data: { organisationId: orgId, userId, kind, amountSen, basis: "PERCENT", baseSen: 0, qty: 1, earnedAt, windowKey, ...extra },
  });
}

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  ({ db } = await import("@/lib/db"));
  ({ commissionFromLedger, commissionBreakdownFor } = await import("@/modules/commission/settlement"));

  const org = await db.organisation.create({ data: { name: "COMM-SETTLE-" + tag } });
  orgId = org.id;
  const branch = await db.branch.create({ data: { organisationId: org.id, name: "Settle Branch", city: "Petaling Jaya" } });
  const user = await db.user.create({
    data: { organisationId: org.id, branchId: branch.id, name: "Settle Mechanic", email: "settle-" + tag + "@dsh.test", role: "MECHANIC" },
  });
  userId = user.id;
});

afterAll(async () => {
  await db.commissionLedger.deleteMany({ where: { organisationId: orgId } });
  await db.staffPayout.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { organisationId: orgId } });
  await db.branch.deleteMany({ where: { organisationId: orgId } });
  await db.organisation.delete({ where: { id: orgId } });
});

describe("按周期取台账：四种 kind 的符号各不相同", () => {
  it("BASE + TIER_BONUS + ADJUSTMENT − REVERSAL（冲正是负号）", async () => {
    await row("BASE", 1000, new Date("2026-09-03T03:00:00Z"), "2026-09");
    await row("BASE", 400, new Date("2026-09-10T03:00:00Z"), "2026-09");
    await row("TIER_BONUS", 500, new Date("2026-09-12T03:00:00Z"), "2026-09");
    await row("ADJUSTMENT", 200, new Date("2026-09-15T03:00:00Z"), "2026-09");
    await row("REVERSAL", 300, new Date("2026-09-18T03:00:00Z"), "2026-09");
    // PENDING 是 0 元痕迹：参与不了金额，但算"这个周期有台账"
    await row("PENDING", 0, new Date("2026-09-19T03:00:00Z"), "2026-09");

    const w = await commissionFromLedger({ organisationId: orgId, userId, period: "month", periodStart: PERIOD_START });
    expect(w.windowKey).toBe("2026-09");
    expect(w.baseSen).toBe(1400);
    expect(w.tierBonusSen).toBe(500);
    expect(w.adjustmentSen).toBe(200);
    expect(w.reversalSen).toBe(300);
    expect(w.totalSen).toBe(1400 + 500 + 200 - 300);
    expect(w.rowCount).toBe(6);
    expect(w.lateRowCount).toBe(0);
  });

  it("周期之外的台账不算（上个月／下个月都不进来）", async () => {
    await row("BASE", 9999, new Date("2026-08-20T03:00:00Z"), "2026-08");
    await row("BASE", 8888, new Date("2026-10-02T03:00:00Z"), "2026-10");
    const w = await commissionFromLedger({ organisationId: orgId, userId, period: "month", periodStart: PERIOD_START });
    expect(w.baseSen).toBe(1400);
  });

  it("**迟到的计提**：时间落在本周期、归属窗口是上个月 → 计入本周期并标出来", async () => {
    // 8 月的工单 9 月 5 日才完工：钱发在 9 月，但窗口键仍是 2026-08
    await row("BASE", 700, new Date("2026-09-05T06:00:00Z"), "2026-08", { reason: "late-accrual for 2026-08" });
    const w = await commissionFromLedger({ organisationId: orgId, userId, period: "month", periodStart: PERIOD_START });
    expect(w.baseSen).toBe(2100); // 1400 + 700
    expect(w.lateSen).toBe(700);
    expect(w.lateRowCount).toBe(1);
    expect(w.lateWindowKeys).toEqual(["2026-08"]);
  });

  it("窗口边界按 +8 时区：9 月 1 日 00:00 MYT 之前那条属于上个月", async () => {
    const beforeMyMidnight = new Date(Date.UTC(2026, 7, 31, 15, 59)); // 8/31 23:59 MYT
    await row("BASE", 123, beforeMyMidnight, "2026-08");
    const w = await commissionFromLedger({ organisationId: orgId, userId, period: "month", periodStart: PERIOD_START });
    expect(w.baseSen).toBe(2100); // 没有被算进来
    expect(start.getTime()).toBe(Date.UTC(2026, 7, 31, 16, 0)); // 窗口起点 = 9/1 00:00 MYT
    expect(end.getTime()).toBe(Date.UTC(2026, 8, 30, 16, 0));
  });
});

describe("「为什么是这个数」的逐行明细", () => {
  it("把工单号、行描述、规则与金额都摊开，并标出迟到的计提", async () => {
    const b = await commissionBreakdownFor({ organisationId: orgId, userId, period: "month", periodStart: PERIOD_START });
    expect(b.windowKey).toBe("2026-09");
    // 8 月那笔迟到计提：时间在 9 月、窗口键是 2026-08 → 必须被标出来
    const late = b.lines.filter((l) => l.late);
    expect(late.length).toBeGreaterThanOrEqual(1);
    expect(late[0].windowKey).toBe("2026-08");
    // PENDING 是 0 元痕迹，但**必须显示**：它回答的是"这一行为什么没有钱"
    const pending = b.lines.filter((l) => l.kind === "PENDING");
    expect(pending.length).toBe(1);
    expect(pending[0].amountSen).toBe(0);
    // 金额与汇总一致（面板上的总数就是从这些行来的）
    const sum = b.lines
      .filter((l) => ["BASE", "TIER_BONUS", "ADJUSTMENT", "REVERSAL"].includes(l.kind))
      .reduce((s, l) => s + (l.kind === "REVERSAL" ? -l.amountSen : l.amountSen), 0);
    expect(sum).toBe(b.totals.totalSen);
  });
});

describe("用哪个数字发薪（纯函数）", () => {
  const ledgerSum = { baseSen: 2000, tierBonusSen: 0, adjustmentSen: 0, reversalSen: 0, totalSen: 2000, rowCount: 3 };

  it("有台账 → 以台账为准，并把差额留痕", () => {
    const d = resolvePayoutCommission({ ledger: ledgerSum, requestedSen: 1500, alreadyPaid: false });
    expect(d.source).toBe("LEDGER");
    expect(d.commissionSen).toBe(2000);
    expect(d.driftSen).toBe(500);
    expect(d.note).toContain("500");
  });

  it("**没有台账 → 保留提交的数，绝不当成 0**（否则会把历史工资清零）", () => {
    const empty = { baseSen: 0, tierBonusSen: 0, adjustmentSen: 0, reversalSen: 0, totalSen: 0, rowCount: 0 };
    const d = resolvePayoutCommission({ ledger: empty, requestedSen: 1234, alreadyPaid: false });
    expect(d.source).toBe("LEGACY");
    expect(d.commissionSen).toBe(1234);
    expect(d.note).toContain("not zeroed");
  });

  it("已付款 → 冻结（source = LOCKED）", () => {
    const d = resolvePayoutCommission({ ledger: ledgerSum, requestedSen: 999, alreadyPaid: true });
    expect(d.source).toBe("LOCKED");
    expect(d.commissionSen).toBe(999);
    expect(d.driftSen).toBe(0);
  });
});
