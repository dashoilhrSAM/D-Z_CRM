// Script candidate generation. The pure parts are covered here so the behaviour that
// guards against fabrication is tested without burning model calls.
import { describe, it, expect } from "vitest";
import {
  buildUserPrompt, renderFacts, normaliseCandidate, dedupeCandidates, reconcileProductFlag,
  MAX_CANDIDATE_COUNT, DEFAULT_CANDIDATE_COUNT,
} from "@/modules/marketing/content";
import type { FactSheet, GeneratedCandidate } from "@/modules/marketing/content";

const cand = (over: Partial<GeneratedCandidate> = {}): GeneratedCandidate => ({
  angle: "a", title: "t", hook: "h", body: "b", cta: "c",
  tone: "friendly", platform: "TIKTOK", language: "ms",
  includeProduct: false, productSku: null, score: 3, reasoning: "r",
  ...over,
});

describe("renderFacts", () => {
  const facts: FactSheet = {
    products: [{ sku: "E1300", name: "E1300+ V2", volume: "1.2L", facts: "1.2L · 10W40 · API SP", points: ["Maximum Performance"] }],
    services: [{ name: "General Service", priceSen: 6000, detail: "MAINTENANCE · RM60.00" }],
  };

  it("renders real services and products", () => {
    const out = renderFacts(facts);
    expect(out).toContain("General Service");
    expect(out).toContain("RM60.00");
    expect(out).toContain("E1300");
    expect(out).toContain("API SP");
  });

  it("says so explicitly when there is nothing to reference", () => {
    const out = renderFacts({ products: [], services: [] });
    expect(out).toContain("no product or service facts");
  });

  it("never renders a price that was not set", () => {
    const out = renderFacts({ products: [], services: [{ name: "X", priceSen: null, detail: "MAINTENANCE · price not set" }] });
    expect(out).toContain("price not set");
    expect(out).not.toMatch(/RM\d/);
  });
});

describe("buildUserPrompt", () => {
  const base = { brand: null, occasion: null, trendDigest: "", facts: "FACTS", request: {} };

  it("turns the product toggle ON in the instructions", () => {
    const p = buildUserPrompt({ ...base, request: { includeProduct: true } });
    expect(p).toContain("PRODUCT TOGGLE: ON");
    expect(p).not.toContain("PRODUCT TOGGLE: OFF");
  });

  it("turns the product toggle OFF in the instructions", () => {
    const p = buildUserPrompt({ ...base, request: { includeProduct: false } });
    expect(p).toContain("PRODUCT TOGGLE: OFF");
    expect(p).toContain("Do not mention the brand");
  });

  it("asks for the requested number of candidates and clamps absurd values", () => {
    expect(buildUserPrompt({ ...base, request: { count: 5 } })).toContain("Write 5 distinct");
    expect(buildUserPrompt({ ...base, request: { count: 999 } })).toContain("Write " + MAX_CANDIDATE_COUNT + " distinct");
    expect(buildUserPrompt({ ...base, request: {} })).toContain("Write " + DEFAULT_CANDIDATE_COUNT + " distinct");
  });

  it("includes the occasion angle when there is one", () => {
    const p = buildUserPrompt({ ...base, occasion: { name: "Hari Raya", angleHint: "balik kampung prep", daysUntil: 12 }, request: {} });
    expect(p).toContain("Hari Raya");
    expect(p).toContain("balik kampung prep");
    expect(p).toContain("12 days");
  });

  it("includes brand guardrails when a profile exists", () => {
    const p = buildUserPrompt({ ...base, brand: { name: "DASHOIL", voice: "confident", dos: ["state real ratings"], donts: ["never invent a cert"], samples: ["a sample"] }, request: {} });
    expect(p).toContain("never invent a cert");
    expect(p).toContain("state real ratings");
  });

  it("passes the trend structure but frames it as shape, not wording", () => {
    const p = buildUserPrompt({ ...base, trendDigest: "- hook: before/after", request: {} });
    expect(p).toContain("before/after");
    expect(p).toContain("never the wording");
  });
});

describe("normaliseCandidate", () => {
  it("drops entries with nothing usable", () => {
    expect(normaliseCandidate(null, "TIKTOK", "ms")).toBeNull();
    expect(normaliseCandidate({}, "TIKTOK", "ms")).toBeNull();
    expect(normaliseCandidate({ body: "   " }, "TIKTOK", "ms")).toBeNull();
  });

  it("fills defaults and clamps the score", () => {
    const c = normaliseCandidate({ body: "x", score: 99 }, "REELS", "en")!;
    expect(c.score).toBe(5);
    expect(c.platform).toBe("REELS");
    expect(c.language).toBe("en");
    expect(c.tone).toBe("friendly");
    expect(normaliseCandidate({ body: "x", score: -5 }, "A", "b")!.score).toBe(1);
  });

  it("only treats a literal true as the product flag", () => {
    expect(normaliseCandidate({ body: "x", includeProduct: "yes" }, "A", "b")!.includeProduct).toBe(false);
    expect(normaliseCandidate({ body: "x", includeProduct: true }, "A", "b")!.includeProduct).toBe(true);
  });

  it("keeps a candidate that has a hook but no body", () => {
    expect(normaliseCandidate({ hook: "just a hook" }, "A", "b")).not.toBeNull();
  });
});

describe("dedupeCandidates", () => {
  it("removes angles that are the same idea spelled differently", () => {
    const out = dedupeCandidates([cand({ angle: "Jimat Kos" }), cand({ angle: "jimat-kos!" }), cand({ angle: "Keselamatan" })]);
    expect(out).toHaveLength(2);
  });

  it("keeps genuinely different angles", () => {
    expect(dedupeCandidates([cand({ angle: "a" }), cand({ angle: "b" })])).toHaveLength(2);
  });
});

describe("reconcileProductFlag", () => {
  const skus = new Set(["H500", "E1300"]);
  const names = ["H500", "E1300+ V2"];

  it("turns the flag ON when the copy names the brand but the model left it off", () => {
    const c = reconcileProductFlag(cand({ body: "Guna DASHOIL untuk perlindungan.", includeProduct: false }), skus, names);
    expect(c.includeProduct).toBe(true);
  });

  it("turns the flag ON when the copy names a product", () => {
    const c = reconcileProductFlag(cand({ body: "Cuba H500 untuk enjin anda." }), skus, names);
    expect(c.includeProduct).toBe(true);
  });

  it("drops a sku that is not in the fact sheet, but keeps the flag when the copy mentions a product", () => {
    const c = reconcileProductFlag(cand({ body: "Guna DASHOIL.", includeProduct: true, productSku: "NOT-REAL" }), skus, names);
    expect(c.productSku).toBeNull();
    expect(c.includeProduct).toBe(true);
  });

  it("clears the flag when it is on but nothing in the copy refers to a product", () => {
    const c = reconcileProductFlag(cand({ body: "Servis berkala penting.", includeProduct: true, productSku: null }), skus, names);
    expect(c.includeProduct).toBe(false);
  });

  it("leaves a clean product-free candidate alone", () => {
    const c = reconcileProductFlag(cand({ body: "Check brake anda.", includeProduct: false }), skus, names);
    expect(c).toMatchObject({ includeProduct: false, productSku: null });
  });

  it("keeps a valid sku on a genuine product script", () => {
    const c = reconcileProductFlag(cand({ body: "Guna H500.", includeProduct: true, productSku: "H500" }), skus, names);
    expect(c).toMatchObject({ includeProduct: true, productSku: "H500" });
  });

  it("does not treat a short product name as a false positive", () => {
    // names shorter than 3 chars are ignored to avoid matching random substrings
    const c = reconcileProductFlag(cand({ body: "Ok je." }), new Set(["EF"]), ["EF"]);
    expect(c.includeProduct).toBe(false);
  });
});
