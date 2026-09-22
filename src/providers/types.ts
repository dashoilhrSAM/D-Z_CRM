// Provider abstractions (§11). Business modules depend on these interfaces,
// never on a specific vendor. Prototype = mock impls; production = real vendors.

export interface MessageSendResult {
  ok: boolean;
  externalId: string | null;
  status: "QUEUED" | "SENT" | "DELIVERED" | "FAILED";
}

export interface MessagingProvider {
  readonly name: string;
  send(to: string, body: string, opts?: { template?: string }): Promise<MessageSendResult>;
  /** Production: Meta WhatsApp Business API. Prototype: MockMessagingProvider. */
}

/** Raised when an AI call fails in strict mode, or returns unusable structured output. */
export class AiError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AiError";
  }
}

export interface AiChatOptions {
  maxTokens?: number;
  temperature?: number;
  /**
   * Strict mode. Default false, which is the historical behaviour: on a missing key,
   * a transport error, or an empty response the provider returns a canned fallback
   * string. That is fine for chat but catastrophic for structured generation, because
   * the caller silently receives prose where it expected data. Set strict to throw
   * AiError instead.
   */
  strict?: boolean;
}

export interface AiProvider {
  readonly name: string;
  generate(prompt: string, opts?: AiChatOptions): Promise<string>;
  /** Multi-turn chat with optional system message. Production: OpenAI. Prototype: MockAIProvider (rule-based canned text). */
  chat(messages: AiChatMessage[], opts?: AiChatOptions): Promise<string>;
  /**
   * Chat that must return a JSON value of shape T. Always strict: throws AiError when
   * the model is unreachable or the reply is not valid JSON, so a canned fallback can
   * never be mistaken for data. Never returns a partial or guessed object.
   */
  chatJson<T>(messages: AiChatMessage[], opts?: AiChatOptions & { retries?: number }): Promise<T>;
  /**
   * Read text out of an image. Used to verify that generated artwork actually contains
   * the words it was asked to render — an image model can produce a beautiful poster with
   * a subtly misspelled word, and nothing else in the pipeline would notice.
   * Always strict: a failed read must not look like a clean read.
   */
  chatVision(image: Buffer, prompt: string, opts?: { maxTokens?: number }): Promise<string>;
}

/** A chat message for the AiProvider.chat (system / user / assistant). */
export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * 私有对象的键前缀 —— **唯一定义**。
 *
 * 公共对象（海报、附件、商品图）走 /api/storage 直接对外给图；考勤自拍、证件这类
 * 个人数据不能走那条路：Supabase 的公共桶会把对象暴露成
 * /storage/v1/object/public/<bucket>/<key>，任何人拿到 URL 就能看。
 * 所以私有对象一律带这个前缀：既存到私有桶、又被 /api/storage 直接 404 掉，
 * 只能经应用层鉴权路由读出（见 src/app/api/attendance/photo/[id]/route.ts）。
 */
export const PRIVATE_OBJECT_PREFIX = "private/";

export function isPrivateObjectKey(key: string): boolean {
  return key.startsWith(PRIVATE_OBJECT_PREFIX);
}

export interface StorageProvider {
  readonly name: string;
  put(key: string, data: Uint8Array, contentType: string): Promise<string>;
  get(key: string): Promise<Uint8Array | null>;
  /** 存私有对象：**不返回**任何可公开访问的 URL（返回 void 是故意的）。 */
  putPrivate(key: string, data: Uint8Array, contentType: string): Promise<void>;
  /** 读私有对象：调用方必须先自己做鉴权，provider 不做权限判断。 */
  getPrivate(key: string): Promise<Uint8Array | null>;
  /** Production: Supabase Storage. Prototype: LocalStorageProvider (./storage). */
}

export interface PaymentProvider {
  readonly name: string;
  charge(amountSen: number, reference: string, method: string): Promise<{ ok: boolean; paidAt: Date }>;
  /** Production: Payment Gateway. Prototype: MockPaymentProvider (auto-succeed). */
}

export interface NotificationProvider {
  readonly name: string;
  notify(to: string, title: string, body: string): Promise<MessageSendResult>;
  /** Production: Push notifications. Prototype: LocalNotificationProvider. */
}

/** SMS 发送结果。与 MessageSendResult 分开：OTP 短信常常发生在 Customer 存在之前（首次注册），
 *  没有客户可挂账，因此它只回答"这条短信发出去了吗"。 */
export interface SmsSendResult {
  ok: boolean;
  externalId: string | null;
  status: "QUEUED" | "SENT" | "FAILED";
  /** 供应商返回的失败原因。**不得包含验证码**——这条会进日志与审计表。 */
  error?: string;
}

/**
 * SMS provider（§11 provider 抽象）。Supabase Auth 的 Send SMS Hook 拿到明文验证码后交给它真发。
 *
 * 与 MessagingProvider 的分工：MessagingProvider 服务于"给某个客户发消息"（有 Message 记账、
 * 有 opt-out 判定）；SmsProvider 只负责"把一段文本发到这个号码"，记账由调用方（OTP 审计表）做。
 */
export interface SmsProvider {
  readonly name: string;
  send(to: string, body: string): Promise<SmsSendResult>;
}
