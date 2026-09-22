// Supabase Auth Hook 的 HTTP 签名校验 —— Standard Webhooks 规范。
//
// 为什么是这个方案而不是 Authorization: Bearer（2026-09-22 依 GoTrue 源码更正）：
//   internal/hooks/hookshttp/hookshttp.go 实际只发四个头 —— Content-Type、
//   webhook-id、webhook-timestamp、webhook-signature（外加 Accept-Encoding），
//   **没有任何 Authorization 头**；配置结构体 ExtensibilityPointConfiguration 里
//   也只有 secrets 字段，根本没有存放 Bearer token 的地方。
//   所以"配一个 Bearer secret 让它发过来"这条经典做法在 Supabase 上不成立：
//   照那样写，真实回调会 100% 401。
//
// 规范要点：
//   secret 形如 v1,whsec_<base64>；v1=版本，whsec_=对称密钥前缀。
//   签名内容 = `${webhook-id}.${webhook-timestamp}.${原始请求体}`，
//   签名 = base64(HMAC-SHA256(base64解码后的密钥, 签名内容))，头里写成 `v1,<签名>`，
//   多把密钥时用空格分隔（签名轮换期）。
//
// 时间戳容差不是可选项：没有它，任何人抓到一次合法请求就能无限重放。
import { createHmac, timingSafeEqual } from "node:crypto";

/** 允许的时钟偏移（秒）。GoTrue 用当前时间签名，两边机器都走 NTP 时余量很足。 */
export const DEFAULT_TOLERANCE_SEC = 300;

export interface StandardWebhookInput {
  secret: string | undefined;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  /** 便于测试注入。默认取当前时间。 */
  nowSec?: number;
  toleranceSec?: number;
}

export type WebhookVerification =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "malformed_secret" | "missing_headers" | "bad_timestamp" | "stale_timestamp" | "no_match" };

/**
 * 解析 `v1,whsec_<base64>` → 密钥字节。
 * 返回 null 表示**没有密钥或格式不对** —— 两种情况都必须 fail-closed，绝不"跳过校验"。
 */
export function parseWebhookSecret(secret: string | undefined | null): Buffer | null {
  if (!secret) return null;
  const m = /^v1,whsec_([A-Za-z0-9+/]+={0,2})$/.exec(secret.trim());
  if (!m) return null;
  try {
    const key = Buffer.from(m[1], "base64");
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/** 签名内容：id.时间戳.原始体（顺序与分隔符都由规范固定，不能改）。 */
export function signedContent(id: string, timestamp: string, body: string): string {
  return id + "." + timestamp + "." + body;
}

/** 计算一条签名（测试与本地联调用；生产验签只用 verifyStandardWebhook）。 */
export function signStandardWebhook(secret: string, id: string, timestampSec: number, body: string): string {
  const key = parseWebhookSecret(secret);
  if (!key) throw new Error("invalid webhook secret format (expected v1,whsec_<base64>)");
  const mac = createHmac("sha256", key).update(signedContent(id, String(timestampSec), body)).digest("base64");
  return "v1," + mac;
}

/**
 * 校验一次回调。判定顺序是先"有没有密钥"再"头齐不齐"，最后才验签名——
 * 这样日志里留下的原因就是真正的原因（缺配置 vs 被伪造）。
 */
export function verifyStandardWebhook(input: StandardWebhookInput): WebhookVerification {
  const key = parseWebhookSecret(input.secret);
  if (!input.secret) return { ok: false, reason: "not_configured" };
  if (!key) return { ok: false, reason: "malformed_secret" };

  const { id, timestamp, signature } = input;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad_timestamp" };
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
  if (Math.abs(now - ts) > tolerance) return { ok: false, reason: "stale_timestamp" };

  const expected = Buffer.from(
    "v1," + createHmac("sha256", key).update(signedContent(id, timestamp, input.body)).digest("base64"),
  );
  // 头里可能有多条（空格分隔，签名轮换期）；任意一条匹配即通过。
  for (const raw of signature.split(" ")) {
    const candidate = Buffer.from(raw.trim());
    if (candidate.length !== expected.length) continue;
    if (timingSafeEqual(candidate, expected)) return { ok: true };
  }
  return { ok: false, reason: "no_match" };
}
