/**
 * 消息渠道状态：现在到底是「真发给客户」还是「只记录不发」（mock）。
 *
 * 起因：老板还没拿到 WhatsApp API key，但界面上到处都是「发送 / 群发 / 自动化」按钮 ——
 * 点了会成功、消息表里也有记录，**但客户手机上什么都不会收到** ✗。
 * 这种「看起来发了其实没发」是这类系统最该杜绝的事，所以要在界面上明说。
 *
 * 为什么做成**自动判断**而不是写死一句说明：
 * 等 key 配好之后，写死的说明会变成错的（还写着「没配 key」），
 * 而自动判断会在配置生效的那一刻**自己消失** ✓。
 *
 * 判定与 src/providers/index.ts 的选择保持一致，但更严格一点：
 * 那边只看 WHATSAPP_API_TOKEN，而真正发消息还需要 WHATSAPP_PHONE_ID ——
 * 只配了一半会「provider 选成真的、发送时才发现缺 phone id」，
 * 所以这里两样都齐了才算 live。
 */

export interface MessagingStatus {
  /** true = 真通道（配齐了），false = 模拟通道（不会真的发到客户手机） */
  live: boolean;
  /** 还缺哪些环境变量（配齐了就是空数组） */
  missing: string[];
}

const REQUIRED = ["WHATSAPP_API_TOKEN", "WHATSAPP_PHONE_ID"] as const;
/** 有它才能验签接收回执（不是发消息的必需项，但没它收不到送达状态） */
const RECEIPTS = ["WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET"] as const;

export function readMessagingStatus(env: Record<string, string | undefined> = process.env): MessagingStatus {
  const missing = REQUIRED.filter((k) => !env[k]);
  return { live: missing.length === 0, missing: [...missing] };
}

/** 送达回执（已读/送达状态）能不能收到 —— 不影响发送，但影响「消息到底送到没」 */
export function receiptsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return RECEIPTS.every((k) => Boolean(env[k]));
}
