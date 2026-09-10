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

export interface StorageProvider {
  readonly name: string;
  put(key: string, data: Uint8Array, contentType: string): Promise<string>;
  get(key: string): Promise<Uint8Array | null>;
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
