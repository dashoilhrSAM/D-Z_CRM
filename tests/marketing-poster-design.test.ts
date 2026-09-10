// Poster design prompts and the read-back verification.
//
// Both matter more than they look: the prompt wording is the difference between a
// designed poster and a photo with words on it, and the verification is the only thing
// standing between a model-written typo and a published poster.
import { describe, it, expect } from "vitest";
import { buildDesignPrompt, textInstructions, requiredWords, POSTER_LAYOUTS } from "@/modules/marketing/poster-design";
import { comparePosterText, normaliseWord, words } from "@/modules/marketing/poster-verify";

const brief = {
  size: "SQUARE" as const,
  brandName: "D&Z Smart Workshop",
  badge: "Hari Malaysia",
  headline: "Jalan Jauh, Enjin Selamat",
  sub: "Cutikan hati, jagakan enjin",
  caption: "DASHOIL E300+ V2 · 10W40 · API SP",
  cta: "Check sebelum jalan",
};

describe("POSTER_LAYOUTS", () => {
  it("reserves a stage inside the canvas for every size", () => {
    for (const key of ["SQUARE", "STORY", "BANNER"] as const) {
      const l = POSTER_LAYOUTS[key];
      expect(l.stage.centerX).toBeGreaterThan(0);
      expect(l.stage.centerX).toBeLessThan(1);
      expect(l.stage.bottomY).toBeGreaterThan(0);
      expect(l.stage.bottomY).toBeLessThanOrEqual(1);
      expect(l.stage.heightRatio).toBeGreaterThan(0);
      expect(l.stage.heightRatio).toBeLessThan(1);
    }
  });

  it("keeps the product clear of the bottom edge so its shadow fits", () => {
    for (const key of ["SQUARE", "STORY", "BANNER"] as const) {
      expect(POSTER_LAYOUTS[key].stage.bottomY).toBeLessThanOrEqual(0.9);
    }
  });

  it("matches the generation sizes it is used with", () => {
    expect(POSTER_LAYOUTS.SQUARE.width).toBe(POSTER_LAYOUTS.SQUARE.height);
    expect(POSTER_LAYOUTS.STORY.height).toBeGreaterThan(POSTER_LAYOUTS.STORY.width);
    expect(POSTER_LAYOUTS.BANNER.width).toBeGreaterThan(POSTER_LAYOUTS.BANNER.height);
  });
});

describe("buildDesignPrompt", () => {
  const prompt = buildDesignPrompt(brief);

  it("forbids drawing a product, so the real one can be composited", () => {
    expect(prompt).toMatch(/Do NOT draw any bottle, can, jug, container/i);
  });

  it("describes the same area the compositor will use", () => {
    // The prompt and POSTER_LAYOUTS must not drift — the bottle would land on the headline.
    expect(prompt).toContain(POSTER_LAYOUTS.SQUARE.stageHint);
  });

  it("bans inventing text", () => {
    expect(prompt).toMatch(/Do NOT add, translate, invent, repeat or embellish/i);
    expect(prompt).toMatch(/no lorem ipsum/i);
  });

  it("lists exactly the approved words", () => {
    expect(prompt).toContain("Jalan Jauh, Enjin Selamat");
    expect(prompt).toContain("Check sebelum jalan");
    expect(prompt).toContain("Hari Malaysia");
  });

  it("asks for design language, not just a photograph", () => {
    expect(prompt).toMatch(/badge/i);
    expect(prompt).toMatch(/accent rule/i);
    expect(prompt).toMatch(/gradient/i);
  });

  it("states the canvas size and orientation", () => {
    expect(prompt).toContain("1080 x 1080");
    expect(prompt).toContain("Square format");
    expect(buildDesignPrompt({ ...brief, size: "STORY" })).toContain("Vertical portrait");
    expect(buildDesignPrompt({ ...brief, size: "BANNER" })).toContain("Horizontal landscape");
  });

  it("works with the optional fields omitted", () => {
    const minimal = buildDesignPrompt({ size: "SQUARE", brandName: "X", headline: "H" });
    expect(minimal).toContain("H");
    expect(minimal).not.toContain("badge shape");
    expect(minimal).not.toContain("pill button");
  });
});

describe("textInstructions", () => {
  it("numbers the lines in reading order with the badge first", () => {
    const lines = textInstructions(brief);
    expect(lines[0]).toContain("Top-left");
    expect(lines[0]).toContain("Hari Malaysia");
    expect(lines[1]).toContain("Headline");
    expect(lines[lines.length - 1]).toContain("WhatsApp".replace("WhatsApp", "pill button"));
  });

  it("puts the brand bottom-left and the CTA bottom-right", () => {
    const joined = textInstructions(brief).join("\n");
    expect(joined).toMatch(/Bottom-left[\s\S]*D&Z Smart Workshop/);
    expect(joined).toMatch(/Bottom-right[\s\S]*Check sebelum jalan/);
  });

  it("skips absent optional lines", () => {
    expect(textInstructions({ size: "SQUARE", brandName: "X", headline: "H" })).toHaveLength(2);
  });
});

describe("requiredWords", () => {
  it("collects the words that must appear", () => {
    const w = requiredWords(brief);
    expect(w).toContain("Jalan");
    expect(w).toContain("Selamat");
  });

  it("drops short and punctuation-only tokens", () => {
    expect(requiredWords({ size: "SQUARE", brandName: "X", headline: "A, of to i" }).every((x) => x.length >= 3)).toBe(true);
  });
});

describe("normaliseWord and words", () => {
  it("strips punctuation and lowercases", () => {
    expect(normaliseWord("Selamat!,")).toBe("selamat");
    expect(normaliseWord("E300+")).toBe("e300");
  });

  it("drops tokens too short to be meaningful", () => {
    expect(words("a of the enjin")).toEqual(["the", "enjin"]);
  });
});

describe("comparePosterText", () => {
  it("passes when every expected word is present", () => {
    const r = comparePosterText("Jalan Jauh, Enjin Selamat", ["Jalan Jauh Enjin Selamat"]);
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("is insensitive to punctuation and case", () => {
    expect(comparePosterText("CHECK SEBELUM JALAN!", ["Check sebelum jalan"]).ok).toBe(true);
  });

  it("catches a misspelling as a missing word", () => {
    // The exact failure this exists for: a one-letter typo the model introduced.
    const r = comparePosterText("JASO MA2 Untuk Cuti Lancer", ["JASO MA2 Untuk Cuti Lancar"]);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("lancar");
  });

  it("catches a line that was dropped entirely", () => {
    const r = comparePosterText("Jalan Jauh", ["Jalan Jauh", "Check sebelum jalan"]);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["check", "sebelum", "jalan"].filter((w) => w !== "jalan"));
  });

  it("reports extra words without treating them as failure", () => {
    // Product-label text is legitimately not briefed, so it must not fail the check.
    const r = comparePosterText("Jalan Jauh SELAMAT SYNTHETIC TECHNOLOGY", ["Jalan Jauh Selamat"]);
    expect(r.ok).toBe(true);
    expect(r.unexpected).toContain("synthetic");
  });

  it("fails on an empty transcription", () => {
    expect(comparePosterText("", ["Jalan Jauh"]).ok).toBe(false);
  });

  it("passes trivially when nothing was expected", () => {
    expect(comparePosterText("anything", []).ok).toBe(true);
  });

  it("matches words regardless of their position or order", () => {
    expect(comparePosterText("Selamat Jalan Jauh", ["Jalan Jauh Selamat"]).ok).toBe(true);
  });
});
