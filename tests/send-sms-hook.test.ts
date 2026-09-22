// Supabase Send SMS hook 的门槛与记账契约（真打路由，不是读源码断言）。
//
// 为什么必须真打：这个端点在 middleware 里是**公开路径**，而它收到的 payload 里有明文验证码。
// 只断言"源码里有 requireSmsHookSecret"证明不了它真的会拦——把调用删掉、把返回值忽略掉，
// 源码里那行字还在。所以这里直接发请求看状态码。
//
// 覆盖四条真实会出事的路径：
//  ① 没配 secret → 必须 503（fail-closed），不是"跳过校验照常发短信"；
//  ② 配了 secret 但没带/带错 → 401；
//  ③ 境外号码 → 403（短信按条计费，SMS pumping 是这条链路上最真实的损失）；
//  ④ 合法请求 → 200，且**把 action 预写的 REQUESTED 行更新成 SENT**（不新增一行）——
//     这是 action 与 hook 之间的记账契约，断了就会出现"限流数不到已发出的短信"。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

const TEST_PHONE = "+60111111111"; // 测试段号：不与任何真实客户冲突
const SECRET = "test-hook-secret-0123456789";
const OTP = "123456";

const saved = {
  databaseUrl: process.env.DATABASE_URL,
  secret: process.env.SMS_HOOK_SECRET,
  twilio: process.env.TWILIO_AUTH_TOKEN,
};

let POST: (req: NextRequest) => Promise<Response>;
let db: (typeof import("@/lib/db"))["db"];

function call(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest(
      new Request("https://example.com/api/hooks/send-sms", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    ),
  );
}
const payload = (phone = TEST_PHONE, otp = OTP) => ({ user: { id: "u1", phone }, sms: { otp } });
const authed = { authorization: "Bearer " + SECRET };

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  delete process.env.TWILIO_AUTH_TOKEN; // 强制走 mock provider：测试绝不真发短信
  ({ db } = await import("@/lib/db"));
  ({ POST } = await import("@/app/api/hooks/send-sms/route"));
  await db.otpAttempt.deleteMany({ where: { phoneE164: TEST_PHONE } });
  process.env.SMS_HOOK_SECRET = SECRET;
});

afterAll(async () => {
  await db.otpAttempt.deleteMany({ where: { phoneE164: TEST_PHONE } });
  await db.$disconnect();
  if (saved.databaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved.databaseUrl;
  if (saved.secret === undefined) delete process.env.SMS_HOOK_SECRET;
  else process.env.SMS_HOOK_SECRET = saved.secret;
  if (saved.twilio !== undefined) process.env.TWILIO_AUTH_TOKEN = saved.twilio;
});

describe("鉴权（fail-closed）", () => {
  it("没配 SMS_HOOK_SECRET → 503，且一条短信都不发", async () => {
    delete process.env.SMS_HOOK_SECRET;
    const res = await call(payload(), authed);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("not configured");
    process.env.SMS_HOOK_SECRET = SECRET;
  });

  it("没带 Authorization → 401", async () => {
    const res = await call(payload());
    expect(res.status).toBe(401);
  });

  it("带错 secret → 401", async () => {
    const res = await call(payload(), { authorization: "Bearer wrong-secret" });
    expect(res.status).toBe(401);
  });

  it("长度不同也不崩（恒定时间比较前先比长度是必要的）", async () => {
    const res = await call(payload(), { authorization: "Bearer x" });
    expect(res.status).toBe(401);
  });
});

describe("号段白名单（第二道，独立于 action）", () => {
  it("境外号码 → 403，并留下 BLOCKED 审计", async () => {
    const res = await call(payload("+8613800138000"), authed);
    expect(res.status).toBe(403);
    const blocked = await db.otpAttempt.findFirst({ where: { phoneE164: "+8613800138000" }, orderBy: { createdAt: "desc" } });
    expect(blocked?.status).toBe("BLOCKED");
    await db.otpAttempt.deleteMany({ where: { phoneE164: "+8613800138000" } });
  });
});

describe("发送与记账", () => {
  it("非法号码/验证码 → 400（不要把垃圾参数丢给供应商）", async () => {
    expect((await call(payload("12345"), authed)).status).toBe(400);
    expect((await call(payload(TEST_PHONE, "abc"), authed)).status).toBe(400);
  });

  it("合法请求 → 200，且响应体里没有验证码", async () => {
    const res = await call(payload(), authed);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(OTP);
  });

  it("会把 action 预写的 REQUESTED 行更新掉，而不是新增一行", async () => {
    await db.otpAttempt.deleteMany({ where: { phoneE164: TEST_PHONE } });
    await db.otpAttempt.create({ data: { phoneE164: TEST_PHONE, purpose: "SIGNUP", status: "REQUESTED" } });

    const res = await call({ user: { id: "u2", phone: TEST_PHONE }, sms: { otp: "654321" } }, authed);
    expect(res.status).toBe(200);

    const rows = await db.otpAttempt.findMany({ where: { phoneE164: TEST_PHONE } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SENT");
    expect(rows[0].provider).toBe("mock-sms");
    expect(rows[0].externalId).toMatch(/^mock-sms-/);
    expect(rows[0].purpose).toBe("SIGNUP"); // 保留发起方写入的用途，便于区分注册/登录成本
  });

  it("没有对应 REQUESTED 行时（如仪表盘手动触发）也会留一条痕", async () => {
    await db.otpAttempt.deleteMany({ where: { phoneE164: TEST_PHONE } });
    const res = await call(payload(), authed);
    expect(res.status).toBe(200);
    const rows = await db.otpAttempt.findMany({ where: { phoneE164: TEST_PHONE } });
    expect(rows).toHaveLength(1);
    expect(rows[0].purpose).toBe("HOOK");
  });
});
