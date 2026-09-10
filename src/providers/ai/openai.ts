import { AiError, type AiProvider, type AiChatMessage, type AiChatOptions } from "../types";

/**
 * OpenAIProvider — OpenAI chat completions (§31 provider 换真 B 阶段)。
 *
 * 使用（需要 OPENAI_API_KEY 后）：
 *   OPENAI_API_KEY  — platform.openai.com 生成的密钥
 *   OPENAI_MODEL    — 模型名（缺省 gpt-4o-mini；Workshop AI Assistant 用多轮 chat，非单发 generate）
 *
 * 两种失败模式，刻意区分：
 *   - 默认（strict 未开）：缺 key / 请求失败 / 空回复 → 返回兜底文案。聊天场景无害。
 *   - strict: true 或 chatJson：同样情况**抛 AiError**。结构化生成必须走这条，
 *     否则调用方会把一句马来语兜底当成数据，静默产出垃圾。
 * 业务层不感知，只替换 providers/index.ts 的导出。
 */
export class OpenAIProvider implements AiProvider {
  readonly name = "openai";

  private get apiKey() { return process.env.OPENAI_API_KEY; }
  private get model() { return process.env.OPENAI_MODEL || "gpt-4o-mini"; }

  private fallback() {
    return "D&Z Smart Workshop — servis berkualiti untuk motosikal anda.";
  }

  async generate(prompt: string, opts?: AiChatOptions): Promise<string> {
    return this.chat([{ role: "user", content: prompt }], opts);
  }

  async chat(messages: AiChatMessage[], opts?: AiChatOptions): Promise<string> {
    const key = this.apiKey;
    if (!key) {
      if (opts?.strict) throw new AiError("OPENAI_API_KEY is not configured");
      return this.fallback();
    }
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: opts?.maxTokens ?? 500,
          temperature: opts?.temperature ?? 0.4,
        }),
      });
      const data = await res.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
      if (!res.ok || data.error) {
        if (opts?.strict) throw new AiError("OpenAI request failed: " + (data.error?.message ?? "HTTP " + res.status));
        return this.fallback();
      }
      const text = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) {
        if (opts?.strict) throw new AiError("OpenAI returned an empty response");
        return this.fallback();
      }
      return text;
    } catch (e) {
      if (e instanceof AiError) throw e;
      if (opts?.strict) throw new AiError("OpenAI request threw: " + (e as Error).message, e);
      return this.fallback();
    }
  }

  /**
   * Structured output. Always strict — a fallback string must never be parsed as data.
   * Retries once on an unparseable reply, telling the model what went wrong.
   */
  async chatJson<T>(messages: AiChatMessage[], opts?: AiChatOptions & { retries?: number }): Promise<T> {
    const retries = opts?.retries ?? 1;
    let lastRaw = "";
    let lastError = "";

    for (let attempt = 0; attempt <= retries; attempt++) {
      const conversation: AiChatMessage[] = attempt === 0
        ? messages
        : [
            ...messages,
            { role: "assistant", content: lastRaw.slice(0, 2000) },
            { role: "user", content: "That was not valid JSON (" + lastError + "). Reply with ONLY the raw JSON value — no prose, no markdown fences." },
          ];

      const raw = await this.chat(conversation, { ...opts, strict: true });
      lastRaw = raw;
      try {
        return JSON.parse(extractJson(raw)) as T;
      } catch (e) {
        lastError = (e as Error).message;
      }
    }
    throw new AiError("OpenAI did not return valid JSON after " + (retries + 1) + " attempt(s): " + lastError);
  }
}

/**
 * Pull a JSON value out of a model reply. Models often wrap it in markdown fences or
 * add a sentence before it, so narrow to the outermost object/array before parsing.
 */
export function extractJson(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();

  const firstObj = s.indexOf("{");
  const firstArr = s.indexOf("[");
  const candidates = [firstObj, firstArr].filter((i) => i >= 0);
  if (candidates.length === 0) return s;
  const start = Math.min(...candidates);
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (end > start) s = s.slice(start, end + 1);
  return s.trim();
}

export const aiProvider = new OpenAIProvider();
