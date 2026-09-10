// Trend ingestion helpers. These are the parts that must behave predictably without a
// model or a network: link parsing, identity, fallback scoring, and the digest that is
// handed to script generation.
import { describe, it, expect } from "vitest";
import { parseTrendUrl, dedupeKeyFor, heuristicRelevance, structureDigest } from "@/modules/marketing/trends";

describe("parseTrendUrl", () => {
  it("recognises the YouTube URL shapes", () => {
    expect(parseTrendUrl("https://www.youtube.com/watch?v=abc123XYZ_")).toMatchObject({ source: "YOUTUBE", videoId: "abc123XYZ_" });
    expect(parseTrendUrl("https://youtu.be/abc123XYZ_")).toMatchObject({ source: "YOUTUBE", videoId: "abc123XYZ_" });
    expect(parseTrendUrl("https://www.youtube.com/shorts/abc123XYZ_")).toMatchObject({ source: "YOUTUBE", videoId: "abc123XYZ_" });
    expect(parseTrendUrl("https://www.youtube.com/embed/abc123XYZ_")).toMatchObject({ source: "YOUTUBE", videoId: "abc123XYZ_" });
  });

  it("recognises TikTok", () => {
    expect(parseTrendUrl("https://www.tiktok.com/@someone/video/7123456789012345678")).toMatchObject({ source: "TIKTOK", videoId: "7123456789012345678" });
  });

  it("recognises Instagram reels and posts", () => {
    expect(parseTrendUrl("https://www.instagram.com/reel/Cx1y2Z3aBcD/")).toMatchObject({ source: "INSTAGRAM", videoId: "Cx1y2Z3aBcD" });
    expect(parseTrendUrl("https://www.instagram.com/p/Cx1y2Z3aBcD/")).toMatchObject({ source: "INSTAGRAM", videoId: "Cx1y2Z3aBcD" });
  });

  it("falls back to MANUAL for anything else", () => {
    expect(parseTrendUrl("https://example.com/some/video")).toEqual({ source: "MANUAL", videoId: null });
    expect(parseTrendUrl("not a url")).toEqual({ source: "MANUAL", videoId: null });
  });

  it("still identifies the platform when the id cannot be extracted", () => {
    expect(parseTrendUrl("https://www.tiktok.com/@someone")).toMatchObject({ source: "TIKTOK", videoId: null });
  });
});

describe("dedupeKeyFor", () => {
  it("is stable for the same input", () => {
    expect(dedupeKeyFor("TIKTOK", "https://x.com/a", "t")).toBe(dedupeKeyFor("TIKTOK", "https://x.com/a", "t"));
  });

  it("ignores query strings and trailing slashes", () => {
    expect(dedupeKeyFor("YOUTUBE", "https://y.com/a?t=5", "t")).toBe(dedupeKeyFor("YOUTUBE", "https://y.com/a", "t"));
    expect(dedupeKeyFor("YOUTUBE", "https://y.com/a/", "t")).toBe(dedupeKeyFor("YOUTUBE", "https://y.com/a", "t"));
  });

  it("is case-insensitive on the link", () => {
    expect(dedupeKeyFor("YOUTUBE", "https://Y.COM/A", "t")).toBe(dedupeKeyFor("YOUTUBE", "https://y.com/a", "t"));
  });

  it("separates different sources and different pieces", () => {
    expect(dedupeKeyFor("TIKTOK", "https://x.com/a", "t")).not.toBe(dedupeKeyFor("YOUTUBE", "https://x.com/a", "t"));
    expect(dedupeKeyFor("TIKTOK", "https://x.com/a", "t")).not.toBe(dedupeKeyFor("TIKTOK", "https://x.com/b", "t"));
  });

  it("falls back to the title when there is no link", () => {
    expect(dedupeKeyFor("MANUAL", null, "Tajuk satu")).toBe(dedupeKeyFor("MANUAL", null, "Tajuk satu"));
    expect(dedupeKeyFor("MANUAL", null, "Tajuk satu")).not.toBe(dedupeKeyFor("MANUAL", null, "Tajuk dua"));
  });
});

describe("heuristicRelevance", () => {
  it("scores motorcycle topics high", () => {
    expect(heuristicRelevance("Cara check minyak hitam motosikal anda", null)).toBeGreaterThanOrEqual(4);
    expect(heuristicRelevance("servis moto - tukar tayar dan brake", null)).toBe(5);
  });

  it("scores unrelated topics low", () => {
    expect(heuristicRelevance("Best pasta recipe for dinner", null)).toBe(2);
  });

  it("boosts very popular motorcycle content but never above 5", () => {
    expect(heuristicRelevance("moto tips", 5_000_000)).toBe(5);
    expect(heuristicRelevance("moto tips", 10)).toBeLessThanOrEqual(5);
    expect(heuristicRelevance("moto servis", 5_000_000)).toBe(5);
  });

  it("does not boost unrelated content on reach alone past the midpoint", () => {
    expect(heuristicRelevance("random viral clip", 1_500_000)).toBeLessThanOrEqual(3);
  });
});

describe("structureDigest", () => {
  const t = (relevance: number, hookPattern: string | null, format = "POV") => ({
    hookPattern, format, whyItWorks: "because", relevance,
  });

  it("excludes low-relevance trends so unrelated virality never reaches generation", () => {
    const digest = structureDigest([t(5, "cost-of-inaction question"), t(1, "music drop")]);
    expect(digest).toContain("cost-of-inaction");
    expect(digest).not.toContain("music drop");
  });

  it("excludes trends with no extracted hook", () => {
    expect(structureDigest([t(5, null)])).toBe("");
  });

  it("caps the digest so the prompt cannot balloon", () => {
    const many = Array.from({ length: 12 }, (_, i) => t(5, "hook" + i));
    expect(structureDigest(many).split("\n")).toHaveLength(6);
  });

  it("returns an empty string when nothing qualifies", () => {
    expect(structureDigest([])).toBe("");
  });

  it("never includes the original wording — only the shape", () => {
    const digest = structureDigest([t(5, "before/after comparison")]);
    expect(digest).toContain("before/after comparison");
    // the digest carries structure fields only; there is no field for source copy
    expect(digest).not.toMatch(/title|script|caption/i);
  });
});
