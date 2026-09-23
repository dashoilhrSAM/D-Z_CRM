// verifiedAt 标注的护栏。
//
// 这条测试的由来是一次**线上抓到的假标注**：旧实现只按 phoneE164 + verifiedAt:null 过滤，
// 于是客户验证成功时，同一号码下那条"因为网关设备离线而根本没发出去"的 FAILED 行
// 也被盖上了 verified: True。审计行是这条链路的唯一真相来源，假标注会让事故归因跑偏。
//
// 所以这里同时断言两个方向：该标的（SENT/REQUESTED）要标，不该标的（FAILED/拒绝类）绝不能标。
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PHONE = "+60199990001";
const saved = { databaseUrl: process.env.DATABASE_URL };
let db: typeof import("@/lib/db")["db"];
let markOtpVerified: typeof import("@/lib/otp-attempt")["markOtpVerified"];

async function seed(statuses: string[]) {
  await db.otpAttempt.deleteMany({ where: { phoneE164: PHONE } });
  for (const [i, status] of statuses.entries()) {
    await db.otpAttempt.create({
      data: {
        phoneE164: PHONE,
        purpose: "HOOK",
        status,
        createdAt: new Date(Date.now() - (statuses.length - i) * 60_000),
      },
    });
  }
}

async function stamped() {
  const rows = await db.otpAttempt.findMany({ where: { phoneE164: PHONE }, orderBy: { createdAt: "asc" } });
  return rows.filter((r) => r.verifiedAt).map((r) => r.status);
}

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  ({ db } = await import("@/lib/db"));
  ({ markOtpVerified } = await import("@/lib/otp-attempt"));
});

afterAll(async () => {
  await db.otpAttempt.deleteMany({ where: { phoneE164: PHONE } });
});

describe("验证成功后的标注", () => {
  it("只标最近一条投递成功的记录", async () => {
    await seed(["SENT", "SENT"]);
    const id = await markOtpVerified(PHONE);
    expect(id).toBeTruthy();
    const rows = await db.otpAttempt.findMany({ where: { phoneE164: PHONE }, orderBy: { createdAt: "desc" } });
    expect(rows[0].verifiedAt, "最近那条要标上").toBeTruthy();
    expect(rows[1].verifiedAt, "更早那条不该被连带标注").toBeNull();
  });

  it("**没发出去的 FAILED 行绝不能被标成已验证**（这次线上踩到的就是它）", async () => {
    await seed(["FAILED", "SENT"]);
    await markOtpVerified(PHONE);
    expect(await stamped(), "只有 SENT 那条配被标注").toEqual(["SENT"]);
  });

  it("拒绝类记录同样不标（BLOCKED / THROTTLED / REJECTED）", async () => {
    await seed(["REJECTED", "BLOCKED", "THROTTLED"]);
    const id = await markOtpVerified(PHONE);
    expect(id, "没有可标注的行时应返回 null").toBeNull();
    expect(await stamped()).toEqual([]);
  });

  it("只有 FAILED 时返回 null，且不产生任何标注", async () => {
    await seed(["FAILED"]);
    expect(await markOtpVerified(PHONE)).toBeNull();
    expect(await stamped()).toEqual([]);
  });

  it("重复调用不会重复标注（第二次找不到未标注的行）", async () => {
    await seed(["SENT"]);
    expect(await markOtpVerified(PHONE)).toBeTruthy();
    expect(await markOtpVerified(PHONE)).toBeNull();
  });
});
