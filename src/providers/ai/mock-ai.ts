import { AiError, type AiProvider, type AiChatMessage } from "../types";

/** MockAIProvider — deterministic canned generation (no LLM in prototype). */
export class MockAIProvider implements AiProvider {
  readonly name = "mock-ai";

  async generate(prompt: string): Promise<string> {
    const p = prompt.toLowerCase();
    if (p.includes("sales script") || p.includes("recommend"))
      return "Abang, part ni dah lama tak tukar. Kalau tukar sekali dengan servis hari ni, memang lebih jimat dan selamat. Nak saya masukkan?";
    if (p.includes("reminder"))
      return "Hi, motosikal awak dah sampai masa servis seterusnya. Nak saya bookingkan slot?";
    if (p.includes("poster") || p.includes("marketing"))
      return "Servis musim ini — jaga enjin, jimat minyak. D&Z Smart Workshop.";
    if (p.includes("summary"))
      return "Pelanggan setia sejak 2019. Servis berkala konsisten, minyak hitam setiap 3,000 km.";
    return "D&Z Smart Workshop — servis berkualiti untuk motosikal anda.";
  }

  async chat(messages: AiChatMessage[]): Promise<string> {
    // Deterministic mock: echo the last tool-provided context or a canned reply.
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const hasCtx = lastUser.includes("【上下文】");
    if (hasCtx) {
      const m = lastUser.match(/【上下文】([\s\S]*?)(?:\n\n|$)/);
      if (m && m[1]) return "Mock: " + m[1].trim().slice(0, 160);
    }
    if (lastUser.toLowerCase().includes("booking")) return "Mock: 今日预约数据已拉取。请配置 OPENAI_API_KEY 以启用真实 AI 回答。";
    return "Mock: 已分析。请配置 OPENAI_API_KEY 以启用真实 AI 回答。";
  }

  /**
   * Deliberately refuses rather than inventing a shape.
   *
   * A canned object here would recreate exactly the silent-failure trap the strict
   * path exists to prevent: callers would persist fabricated scripts believing the
   * model had produced them.
   */
  async chatJson<T>(): Promise<T> {
    throw new AiError(
      "MockAIProvider cannot produce structured output. Configure OPENAI_API_KEY to enable the content engine.",
    );
  }

  /** Refuses rather than pretending a poster was verified. */
  async chatVision(): Promise<string> {
    throw new AiError("MockAIProvider cannot read images. Configure OPENAI_API_KEY.");
  }
}

export const aiProvider = new MockAIProvider();
