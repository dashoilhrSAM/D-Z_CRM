// Supabase Send SMS hook 的门槛与记账契约（真打路由，不是读源码断言）。
//
// 为什么必须真打：这个端点在 middleware 里是**公开路径**，而它收到的 payload 里有明文验证码。
// 只断言"源码里有 requireSmsHookSignature"证明不了它真的会拦——把调用删掉、把返回值忽略掉，
// 源码里那行字还在。所以这里用**真签名**发请求看状态码。
//
// 依 GoTrue 源码（hookshttp.go）实测的两条行为也在覆盖范围内：
//  · 鉴权是 Standard Webhooks 签名，**没有 Authorization 头**（第一版按 Bearer 写，会 100% 401）；
//  · 失败时重试 3 次且 payload 在循环外生成 → 同一验证码会重复到达，审计表必须只留一行。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { signStandardWebhook } from "@/lib/standard-webhooks";

const TEST_PHONE = "+60111111111"; // 测试段号：不与任何真实客户冲突
const SECRET = "v1,whsec_" + Buffer.from("integration-test-key-abcdef0123456789").toString("base64");
const OTHER_SECRET = "v1,whsec_" + Buffer.from("someone-elses-key-9876543210").toString("base64");
const OTP = "123456";

const saved = {
  databaseUrl: process.env.DATABASE_URL,
  secret: process.env.SMS_HOOK_SECRET,
  twilio: process.env.TWILIO_AUTH_TOKEN,
};

let POST: (req: NextRequest) => Promise<Response>;
let db: (typeof import("@/lib/db"))["db"];

/** 构造一次"像 GoTrue 那样"的调用：签名三个头 + 原始报文。 */
function call(body: unknown, opts: { sign?: "valid" | "none" | "wrong" | "stale" | "tampered"; withSecret?: string } = {}) {
  const raw = JSON.stringify(body);
  const kind = opts.sign ?? "valid";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (kind !== "none") {
    const id = "msg_" + Math.random().toString(36).slice(2, 10);
    const ts = Math.floor(Date.now() / 1000) - (kind === "stale" ? 3600 : 0);
    // "wrong" 必须真的换一把密钥签，否则签出来的还是合法签名（第一版漏了这层，断言就永远通过）
    const secret = opts.withSecret ?? (kind === "wrong" ? OTHER_SECRET : SECRET);
    headers["webhook-id"] = id;
    headers["webhook-timestamp"] = String(ts);
    headers["webhook-signature"] = signStandardWebhook(secret, id, ts, kind === "tampered" ? raw + " " : raw);
  }
  return POST(
    new NextRequest(
      new Request("https://example.com/api/hooks/send-sms", { method: "POST", headers, body: raw }),
    ),
  );
}
const payload = (phone = TEST_PHONE, otp = OTP) => ({ user: { id: "u1", phone }, sms: { otp } });

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
  await db.otpAttempt.deleteMany({ where: { phoneE164: "+8613800138000" } });
  await db.$disconnect();
  if (saved.databaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved.databaseUrl;
  if (saved.secret === undefined) delete process.env.SMS_HOOK_SECRET;
  else process.env.SMS_HOOK_SECRET = saved.secret;
  if (saved.twilio !== undefined) process.env.TWILIO_AUTH_TOKEN = saved.twilio;
});

describe("鉴权（fail-closed，签名而非 Bearer）", () => {
  it("没配 secret → 503，且一条短信都不发", async () => {
    delete process.env.SMS_HOOK_SECRET;
    const res = await call(payload());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("SMS_HOOK_SECRET");
    process.env.SMS_HOOK_SECRET = SECRET;
  });

  it("secret 格式不对（例如有人照 Bearer 习惯填了明文）→ 503，不是放行", async () => {
    process.env.SMS_HOOK_SECRET = "just-a-plain-secret";
    const res = await call(payload());
    expect(res.status).toBe(503);
    process.env.SMS_HOOK_SECRET = SECRET;
  });

  it("完全没有签名头 → 401（GoTrue 不发 Authorization，所以「只带 Bearer」一定过不了）", async () => {
    const res = await call(payload(), { sign: "none" });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toContain("missing_headers");
  });

  it("签名不匹配 → 401", async () => {
    expect((await call(payload(), { sign: "wrong" })).status).toBe(401);
    expect((await call(payload(), { withSecret: OTHER_SECRET })).status).toBe(401);
  });

  it("报文被篡改 → 401", async () => {
    expect((await call(payload(), { sign: "tampered" })).status).toBe(401);
  });

  it("时间戳过期 → 401（防重放）", async () => {
    expect((await call(payload(), { sign: "stale" })).status).toBe(401);
  });
});

describe("号段白名单（第二道，独立于 action）", () => {
  it("境外号码 → 403，并留下 BLOCKED 审计（签名合法也不放行）", async () => {
    const res = await call(payload("+8613800138000"));
    expect(res.status).toBe(403);
    const blocked = await db.otpAttempt.findFirst({ where: { phoneE164: "+8613800138000" }, orderBy: { createdAt: "desc" } });
    expect(blocked?.status).toBe("BLOCKED");
  });
});

describe("发送与记账", () => {
  it("非法号码/验证码 → 400（不要把垃圾参数丢给供应商）", async () => {
    expect((await call(payload("12345"))).status).toBe(400);
    expect((await call(payload(TEST_PHONE, "abc"))).status).toBe(400);
  });

  it("合法请求 → 200，且响应体里没有验证码；响应是 application/json（GoTrue 的要求）", async () => {
    const res = await call(payload());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.text()).not.toContain(OTP);
  });

  it("会把 action 预写的 REQUESTED 行更新掉，而不是新增一行", async () => {
    await db.otpAttempt.deleteMany({ where: { phoneE164: TEST_PHONE } });
    await db.otpAttempt.create({ data: { phoneE164: TEST_PHONE, purpose: "SIGNUP", status: "REQUESTED" } });

    const res = await call({ user: { id: "u2", phone: TEST_PHONE }, sms: { otp: "654321" } });
    expect(res.status).toBe(200);

    const rows = await db.otpAttempt.findMany({ where: { phoneE164: TEST_PHONE } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SENT");
    expect(rows[0].provider).toBe("mock-sms");
    expect(rows[0].externalId).toMatch(/^mock-sms-/);
    expect(rows[0].purpose).toBe("SIGNUP"); // 保留发起方写入的用途，便于区分注册/登录成本
  });

  it("已成功发送后的重复回调被 60 秒退避挡下，不会重复发同一条验证码", async () => {
    // GoTrue 只在**失败**时重试（源码：网络错误/超时/429/503 才 continue）。
    // 但有一种竞态：我们这边其实已经发出去了，只是响应没在 5 秒内回到 GoTrue，
    // 于是它重试。此时正确行为是**不重复发送**——用户手里已经有那条验证码，
    // 再发一条同样的码只是多花一次钱。所以第二条回调走 429。
    await db.otpAttempt.deleteMany({ where: { phoneE164: TEST_PHONE } });
    expect((await call(payload())).status).toBe(200);
    expect((await call(payload())).status).toBe(429);

    const rows = await db.otpAttempt.findMany({ where: { phoneE164: TEST_PHONE } });
    expect(rows.filter((r) => r.status === "SENT")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "THROTTLED")).toHaveLength(1);
  });

  it("每日预算用尽 → 503（换号刷量在经济上被截断，且留痕）", async () => {
    await db.otpAttempt.deleteMany({ where: { phoneE164: TEST_PHONE } });
    const savedBudget = process.env.OTP_DAILY_BUDGET;
    process.env.OTP_DAILY_BUDGET = "0";
    const res = await call(payload());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("budget");
    const row = await db.otpAttempt.findFirst({ where: { phoneE164: TEST_PHONE }, orderBy: { createdAt: "desc" } });
    expect(row?.error).toContain("budget");
    if (savedBudget === undefined) delete process.env.OTP_DAILY_BUDGET;
    else process.env.OTP_DAILY_BUDGET = savedBudget;
  });

  it("同一号码 60 秒内已成功发过 → 429（这是挡住「拿公开 anon key 直连 Supabase 刷短信」的那一层）", async () => {
    await db.otpAttempt.deleteMany({ where: { phoneE164: TEST_PHONE } });
    await db.otpAttempt.create({ data: { phoneE164: TEST_PHONE, purpose: "LOGIN", status: "SENT" } });

    const res = await call(payload());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeNull(); // 带上它会触发 GoTrue 立刻重试三次
    const rows = await db.otpAttempt.findMany({ where: { phoneE164: TEST_PHONE }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["SENT", "THROTTLED"]);
  });

  it("只有过**失败**的发送时不受限（否则 GoTrue 的重试会被自己挡住）", async () => {
    await db.otpAttempt.deleteMany({ where: { phoneE164: TEST_PHONE } });
    await db.otpAttempt.create({ data: { phoneE164: TEST_PHONE, purpose: "LOGIN", status: "FAILED" } });
    expect((await call(payload())).status).toBe(200);
  });

  it("已成功发过但已超过 60 秒 → 允许重发", async () => {
    await db.otpAttempt.deleteMany({ where: { phoneE164: TEST_PHONE } });
    await db.otpAttempt.create({
      data: { phoneE164: TEST_PHONE, purpose: "LOGIN", status: "SENT", createdAt: new Date(Date.now() - 70 * 1000) },
    });
    expect((await call(payload())).status).toBe(200);
  });

  it("没有对应 action 记录时（如仪表盘手动触发）也会留一条痕", async () => {
    await db.otpAttempt.deleteMany({ where: { phoneE164: TEST_PHONE } });
    // 超过 10 分钟窗口的历史行不应被复用
    await db.otpAttempt.create({
      data: { phoneE164: TEST_PHONE, purpose: "LOGIN", status: "SENT", createdAt: new Date(Date.now() - 20 * 60 * 1000) },
    });
    const res = await call(payload());
    expect(res.status).toBe(200);
    const rows = await db.otpAttempt.findMany({ where: { phoneE164: TEST_PHONE }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[1].purpose).toBe("HOOK");
  });
});
