// Standard Webhooks 验签的护栏。
//
// 为什么这些断言重要：这是 hook 端点**唯一**的防线（它在 middleware 公开名单里，
// payload 里还有明文验证码）。而它的失败方式是静默的——
//  · 验签写松 → 任何人可 POST 一个 {phone, otp} 让系统给任意号码发短信（短信是花钱的）；
//  · 验签写紧（例如漏掉时间戳容差）→ 真实回调全 401，用户永远收不到验证码。
// 两种都不会有别的测试发现，所以正反两个方向都要钉住。
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOLERANCE_SEC,
  parseWebhookSecret,
  signStandardWebhook,
  signedContent,
  verifyStandardWebhook,
} from "@/lib/standard-webhooks";

const SECRET = "v1,whsec_" + Buffer.from("unit-test-signing-key-0123456789").toString("base64");
const OTHER = "v1,whsec_" + Buffer.from("another-key-0987654321").toString("base64");
const BODY = JSON.stringify({ user: { id: "u1", phone: "+60131252832" }, sms: { otp: "123456" } });
const NOW = 1_800_000_000;

function headers(id: string, ts: number, body: string, secret = SECRET) {
  return { id, timestamp: String(ts), signature: signStandardWebhook(secret, id, ts, body), body };
}
// 注意：这里刻意不给 secret 参数设默认值——设了之后传 undefined 会回落到 SECRET，
// "没配密钥"那条断言就会变成"验签通过"（第一版就是这么把自己骗过去的）。
const verify = (h: { id: string | null; timestamp: string | null; signature: string | null; body: string }, secret?: string) =>
  verifyStandardWebhook({ secret: secret === undefined ? SECRET : secret, ...h, nowSec: NOW });
const verifyWithoutSecret = (h: { id: string | null; timestamp: string | null; signature: string | null; body: string }) =>
  verifyStandardWebhook({ secret: undefined, ...h, nowSec: NOW });

describe("密钥解析", () => {
  it("只接受 v1,whsec_<base64>", () => {
    expect(parseWebhookSecret(SECRET)).not.toBeNull();
    expect(parseWebhookSecret("whsec_" + Buffer.from("k").toString("base64"))).toBeNull(); // 缺 v1,
    expect(parseWebhookSecret("v1,whsec_not base64!")).toBeNull();
    expect(parseWebhookSecret("v1,whsec_")).toBeNull();
    expect(parseWebhookSecret(undefined)).toBeNull();
  });

  it("签名内容格式固定为 id.时间戳.原始体（改一个字符就对不上）", () => {
    expect(signedContent("msg_1", "123", "{}")).toBe("msg_1.123.{}");
  });
});

describe("验签", () => {
  it("合法签名通过", () => {
    expect(verify(headers("msg_1", NOW, BODY))).toEqual({ ok: true });
  });

  it("报文被改一个字节就失败（签名绑的是 body 本身）", () => {
    const h = headers("msg_1", NOW, BODY);
    expect(verify({ ...h, body: BODY.replace("123456", "654321") })).toEqual({ ok: false, reason: "no_match" });
  });

  it("换一把密钥签名失败", () => {
    expect(verify(headers("msg_1", NOW, BODY, OTHER))).toEqual({ ok: false, reason: "no_match" });
  });

  it("缺任何一个签名头都失败", () => {
    const h = headers("msg_1", NOW, BODY);
    expect(verify({ ...h, id: null })).toEqual({ ok: false, reason: "missing_headers" });
    expect(verify({ ...h, timestamp: null })).toEqual({ ok: false, reason: "missing_headers" });
    expect(verify({ ...h, signature: null })).toEqual({ ok: false, reason: "missing_headers" });
  });

  it("时间戳超出容差即拒绝（防重放：抓到一次合法请求不能无限重发）", () => {
    const stale = NOW - DEFAULT_TOLERANCE_SEC - 1;
    expect(verify(headers("msg_1", stale, BODY))).toEqual({ ok: false, reason: "stale_timestamp" });
    const fresh = NOW - DEFAULT_TOLERANCE_SEC + 1;
    expect(verify(headers("msg_1", fresh, BODY))).toEqual({ ok: true });
  });

  it("时间戳不是数字 → bad_timestamp（不是当成 0 静默通过）", () => {
    const h = headers("msg_1", NOW, BODY);
    expect(verify({ ...h, timestamp: "not-a-number" })).toEqual({ ok: false, reason: "bad_timestamp" });
  });

  it("没配密钥 / 配错格式分别给出可行动的原因（都要 fail-closed）", () => {
    const h = headers("msg_1", NOW, BODY);
    expect(verifyWithoutSecret(h)).toEqual({ ok: false, reason: "not_configured" });
    expect(verify(h, "plain-bearer-looking-secret")).toEqual({ ok: false, reason: "malformed_secret" });
  });

  it("多把密钥（轮换期，空格分隔）时任意一条匹配即通过", () => {
    const h = headers("msg_1", NOW, BODY);
    const other = signStandardWebhook(OTHER, "msg_1", NOW, BODY);
    expect(verify({ ...h, signature: other + " " + h.signature })).toEqual({ ok: true });
    expect(verify({ ...h, signature: other })).toEqual({ ok: false, reason: "no_match" });
  });
});
