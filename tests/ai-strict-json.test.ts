// The strict structured-output path. This is the foundation of the content engine:
// before it existed, OpenAIProvider silently returned a canned Malay sentence whenever
// the key was missing or the request failed, so a caller asking for JSON would receive
// prose and happily treat it as data.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIProvider, extractJson } from "@/providers/ai/openai";
import { MockAIProvider } from "@/providers/ai/mock-ai";
import { AiError } from "@/providers/types";

const MSGS = [{ role: "user" as const, content: "give me json" }];

function openAiReply(content: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

describe("extractJson", () => {
  it("parses a bare object", () => {
    expect(JSON.parse(extractJson('{"a":1}'))).toEqual({ a: 1 });
  });

  it("unwraps markdown fences", () => {
    expect(JSON.parse(extractJson('\u0060\u0060\u0060json\n{"a":1}\n\u0060\u0060\u0060'))).toEqual({ a: 1 });
  });

  it("ignores prose around the value", () => {
    expect(JSON.parse(extractJson('Sure! Here you go:\n{"a":1}\nHope that helps.'))).toEqual({ a: 1 });
  });

  it("handles a top-level array", () => {
    expect(JSON.parse(extractJson('prefix [1,2,3] suffix'))).toEqual([1, 2, 3]);
  });

  it("keeps nested structures intact", () => {
    const raw = '{"scripts":[{"hook":"a"}]}';
    expect(JSON.parse(extractJson(raw))).toEqual({ scripts: [{ hook: "a" }] });
  });
});

describe("OpenAIProvider strict mode", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "gpt-4o-mini";
    vi.restoreAllMocks();
  });
  afterEach(() => {
    process.env.OPENAI_API_KEY = originalKey;
    process.env.OPENAI_MODEL = originalModel;
  });

  it("chat() without strict still returns the canned fallback (unchanged legacy behaviour)", async () => {
    delete process.env.OPENAI_API_KEY;
    const out = await new OpenAIProvider().chat(MSGS);
    expect(out).toContain("D&Z Smart Workshop");
  });

  it("chat({strict}) throws instead of returning the fallback when the key is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(new OpenAIProvider().chat(MSGS, { strict: true })).rejects.toThrow(AiError);
  });

  it("chatJson throws AiError on an HTTP error rather than returning prose", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(openAiReply("nope", 500));
    await expect(new OpenAIProvider().chatJson(MSGS)).rejects.toThrow(AiError);
  });

  it("chatJson throws AiError when the network call itself fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    await expect(new OpenAIProvider().chatJson(MSGS)).rejects.toThrow(AiError);
  });

  it("chatJson returns the parsed object on a good reply", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(openAiReply('{"scripts":[{"hook":"a"}]}'));
    const out = await new OpenAIProvider().chatJson<{ scripts: { hook: string }[] }>(MSGS);
    expect(out.scripts[0].hook).toBe("a");
  });

  it("chatJson parses a fenced reply", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(openAiReply('\u0060\u0060\u0060json\n{"ok":true}\n\u0060\u0060\u0060'));
    await expect(new OpenAIProvider().chatJson<{ ok: boolean }>(MSGS)).resolves.toEqual({ ok: true });
  });

  it("chatJson retries once on unparseable output and then succeeds", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(openAiReply("I cannot do that"))
      .mockResolvedValueOnce(openAiReply('{"ok":true}'));
    await expect(new OpenAIProvider().chatJson<{ ok: boolean }>(MSGS)).resolves.toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("chatJson throws after exhausting retries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(openAiReply("still not json"));
    await expect(new OpenAIProvider().chatJson(MSGS, { retries: 1 })).rejects.toThrow(/valid JSON/);
  });
});

describe("MockAIProvider", () => {
  it("refuses structured output instead of inventing a shape", async () => {
    await expect(new MockAIProvider().chatJson()).rejects.toThrow(AiError);
  });

  it("still serves plain chat for local development", async () => {
    await expect(new MockAIProvider().chat(MSGS)).resolves.toContain("Mock:");
  });
});
