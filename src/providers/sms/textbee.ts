import type { SmsProvider, SmsSendResult } from "../types";

/**
 * TextbeeSmsProvider —— 用**自己的安卓手机 + SIM 卡**当短信网关（textbee.dev，开源、可自建）。
 *
 * 为什么会有这个 provider：D&Z 没有 Twilio 预算、也没有 Meta 的 WhatsApp Business 凭据，
 * 但有一台手机和一张 SIM 卡。textbee 把手机变成网关：它提供 REST API，实际发送由那台
 * 安卓手机上的 App 用本机 SIM 完成 —— **没有平台费、没有 Sender ID 报备、没有服务商审核**，
 * 而且因为是从马来西亚本地号码发出，到达率通常比国际网关更好（收件人看到的是门店自己的号码）。
 *
 * env：
 *   TEXTBEE_API_KEY    —— 仪表盘生成的 API key（必填；缺它时本 provider 不参与选型）
 *   TEXTBEE_DEVICE_ID  —— 可选：指定用哪台设备发（不填则用账号默认/最近活跃设备）
 *
 * 免费档限额（官方定价页）：50 条/天、300 条/月、1 台设备、含 webhook。按骑手注册量够起步。
 *
 * 与 Twilio 实现同样的两条规矩：
 *  1. 缺配置时返回 FAILED，**绝不回落 mock**（"显示已发送但没人收到"是本项目最忌讳的失败）。
 *  2. 超时 3.5 秒：Supabase hook 只给 5 秒（GoTrue defaultHTTPHookTimeout），
 *     我们必须在这之前给出结果，否则它先报错、我们这边还在跑。
 *
 * 语义提醒：textbee 的 API 返回成功只代表**网关已接受**，真正的送达由那台手机完成。
 * 因此审计行里的 SENT = "已交给网关"；要拿到真实送达回执，需要接它的 webhook（后续可做）。
 */
export class TextbeeSmsProvider implements SmsProvider {
  readonly name = "textbee";

  async send(to: string, body: string): Promise<SmsSendResult> {
    const apiKey = process.env.TEXTBEE_API_KEY;
    if (!apiKey) {
      return { ok: false, externalId: null, status: "FAILED", error: "textbee api key is not configured" };
    }
    const deviceId = process.env.TEXTBEE_DEVICE_ID;
    try {
      const res = await fetch("https://api.textbee.dev/api/v1/gateway/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
          recipients: [to],
          message: body,
          ...(deviceId ? { deviceId } : {}),
        }),
        signal: AbortSignal.timeout(3500),
      });
      const raw = await res.text();
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // 非 JSON 响应：下面按 HTTP 状态处理，错误信息只保留截断后的原文。
      }
      if (!res.ok) {
        // 只保留技术原因、截断，**绝不回显请求体**（那里面有验证码）。
        const detail =
          (typeof data.message === "string" && data.message) ||
          (typeof data.error === "string" && data.error) ||
          "HTTP " + res.status;
        return { ok: false, externalId: null, status: "FAILED", error: String(detail).slice(0, 200) };
      }
      const nested = (data.data ?? {}) as Record<string, unknown>;
      const externalId =
        (typeof nested.id === "string" && nested.id) ||
        (typeof data.id === "string" && data.id) ||
        (typeof data.messageId === "string" && data.messageId) ||
        null;
      return { ok: true, externalId: externalId || null, status: "QUEUED" };
    } catch (e) {
      const name = e instanceof Error ? e.name : "unknown";
      return { ok: false, externalId: null, status: "FAILED", error: "transport error: " + name };
    }
  }
}

export const smsProvider = new TextbeeSmsProvider();
