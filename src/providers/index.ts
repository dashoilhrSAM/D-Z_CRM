// Provider registry — single composition root (§11).
// Selection: real vendors when their env key is present; otherwise mocks
// (deterministic, safe). Adding a real provider = create impl + flip the env.
import { messagingProvider as mockMessaging } from "./messaging/mock-whatsapp";
import { messagingProvider as whatsappBusiness } from "./messaging/whatsapp-business";
import { smsProvider as mockSms } from "./sms/mock-sms";
import { smsProvider as twilioSms } from "./sms/twilio";
import { aiProvider as mockAi } from "./ai/mock-ai";
import { aiProvider as openai } from "./ai/openai";
import { paymentProvider } from "./payment/mock-payment";
import { storageProvider as localStorage } from "./storage/local";
import { storageProvider as supabaseStorage } from "./storage/supabase";
import { notificationProvider } from "./notification/local";
export type {
  MessagingProvider,
  SmsProvider,
  AiProvider,
  StorageProvider,
  PaymentProvider,
  NotificationProvider,
  MessageSendResult,
} from "./types";

// Storage: Vercel 平台（VERCEL=1 自动注入）→ Supabase Storage（云函数无本地盘）；
// 本地 next start（无 VERCEL env）→ local filesystem（读 ./storage）。
// 注意不能按 NODE_ENV 判断——next start 恒 production，本地服务也会命中。
export const storageProvider =
  process.env.VERCEL === "1" ? supabaseStorage : localStorage;

// Messaging: real WhatsApp Business API when WHATSAPP_API_TOKEN configured,
// else mock (record-only). 拿到 Meta 密钥后只需在 Vercel env 配置，代码零改动。
export const messagingProvider =
  process.env.WHATSAPP_API_TOKEN ? whatsappBusiness : mockMessaging;

// SMS: real Twilio when TWILIO_AUTH_TOKEN configured, else mock.
// 注意与上面两条不同：那个 mock 在 production 会**主动失败**（见 mock-sms.ts）——
// OTP 走 mock 等于"发送成功但没人收到"，不许静默发生。
export const smsProvider = process.env.TWILIO_AUTH_TOKEN ? twilioSms : mockSms;

// AI: real OpenAI when OPENAI_API_KEY configured, else mock (canned text).
export const aiProvider =
  process.env.OPENAI_API_KEY ? openai : mockAi;

export { paymentProvider, notificationProvider };
