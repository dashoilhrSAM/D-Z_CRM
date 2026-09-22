import type { SmsProvider, SmsSendResult } from "../types";

/**
 * MockSmsProvider —— 本地开发用：不发真短信，把验证码打到服务端控制台。
 *
 * 与 mock-whatsapp 有一个**关键区别：生产环境必须失败**。
 * mock-whatsapp 在生产被误用时只是"没发通知"；OTP 走 mock 会变成
 * "发送成功但没人收到短信"——用户永远拿不到验证码，而系统里一切正常。
 * 这正是本项目最忌讳的一类静默失败（参见 AiProvider 的兜底文案事故），
 * 所以这里对 production 显式返回 FAILED，让调用方（和监控）看见。
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = "mock-sms";

  async send(to: string, body: string): Promise<SmsSendResult> {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, externalId: null, status: "FAILED", error: "no SMS provider configured in production" };
    }
    // 本地开发：验证码只进服务端控制台。**只允许在非生产打印**——
    // 它等同于账号本身，进了生产日志就等于泄露。
    console.log("[mock-sms] -> " + to + " :: " + body);
    return { ok: true, externalId: "mock-sms-" + Date.now().toString(36), status: "SENT" };
  }
}

export const smsProvider = new MockSmsProvider();
