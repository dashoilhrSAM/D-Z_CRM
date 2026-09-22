import type { SmsProvider, SmsSendResult } from "../types";

/**
 * TwilioSmsProvider —— Twilio Programmable Messaging（§11 provider 抽象，与 WhatsApp 同构）。
 *
 * env：
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN  — Twilio 控制台凭据
 *   TWILIO_FROM                             — 发送方：E.164 号码，或马来西亚已报备的
 *                                             alphanumeric Sender ID（如 "DZCRM"）
 *
 * 两个刻意的选择：
 *  1. **未配置凭据时返回 FAILED，绝不回落 mock**。回落 mock 会让生产"发送成功、没人收到"，
 *     是 OTP 链路最危险的一种失败（用户看不到任何错误，只会一直点重发）。
 *  2. **8 秒超时**。这个函数是被 Supabase 的 Send SMS Hook 同步调用的：挂着不返回，
 *     整个 signInWithOtp 请求就一起挂着。快速失败 + 让用户重试，比慢慢等更好。
 *
 * 失败原因会写进 OtpAttempt.error 与日志，因此**只保留供应商的技术信息**，
 * 绝不把短信正文或验证码带进去。
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";

  async send(to: string, body: string): Promise<SmsSendResult> {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (!sid || !token || !from) {
      return { ok: false, externalId: null, status: "FAILED", error: "twilio credentials are not configured" };
    }
    try {
      const res = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json", {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(sid + ":" + token).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
        signal: AbortSignal.timeout(8000),
      });
      const data = (await res.json()) as { sid?: string; status?: string; message?: string; code?: number };
      if (!res.ok) {
        // Twilio 的 message 是技术性描述（如 "The 'To' number is not a valid phone number"），
        // 不含 OTP，可安全落库；截断以防把整段响应写进审计表。
        return { ok: false, externalId: null, status: "FAILED", error: (data.message ?? "HTTP " + res.status).slice(0, 200) };
      }
      return { ok: true, externalId: data.sid ?? null, status: "QUEUED" };
    } catch (e) {
      const name = e instanceof Error ? e.name : "unknown";
      return { ok: false, externalId: null, status: "FAILED", error: "transport error: " + name };
    }
  }
}

export const smsProvider = new TwilioSmsProvider();
