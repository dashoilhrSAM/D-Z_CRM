// Poster design prompts and the read-back verification.
//
// Both matter more than they look: the prompt wording is the difference between a
// designed poster and a photo with words on it, and the verification is the only thing
// standing between a model-written typo and a published poster.
import { describe, it, expect } from "vitest";
import { buildDesignPrompt, textInstructions, requiredWords, POSTER_LAYOUTS, POSTER_STYLES, DEFAULT_POSTER_STYLE, styleFor, stageRect } from "@/modules/marketing/poster-design";
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
    expect(prompt).toMatch(/Do NOT draw any bottle/i);
    expect(prompt).toMatch(/do not draw an illustration of one/i);
  });

  it("reserves a product area and keeps it empty", () => {
    expect(prompt).toMatch(/RESERVED PRODUCT AREA/i);
    expect(prompt).toMatch(/deliberately empty/i);
    expect(prompt).toMatch(/no text, no logo and no busy pattern/i);
  });

  /**
   * The window the model used to be asked for is what produced the complaint: a distinct
   * panel around the bottle reads as an inset and separates the product from the scene.
   * The product is now print-treated (poster-print.ts) so it no longer needs a
   * photographic home — the reserved area should simply be part of the artwork.
   */
  it("asks for the reserved area to continue the artwork rather than be a panel", () => {
    expect(prompt).toMatch(/must NOT read as a separate panel, inset, frame, box, plate or contrasting block/i);
    expect(prompt).toMatch(/must simply continue through it, at the same colour, lighting and texture/i);
    expect(prompt).toContain(POSTER_STYLES.GRAPHIC.stageLook);
  });

  it("still asks for a ground shadow, so the product does not float", () => {
    expect(prompt).toMatch(/soft shadow a standing object would cast/i);
  });

  it("gives the model the window position in the same percentages the compositor uses", () => {
    // Two sources of truth here would put the bottle beside the window, not in it.
    const rect = stageRect(POSTER_LAYOUTS.SQUARE, POSTER_LAYOUTS.SQUARE.width, POSTER_LAYOUTS.SQUARE.height);
    const pc = (n: number, total: number) => Math.round((n / total) * 100) + "%";
    expect(prompt).toContain(
      "left " + pc(rect.left, POSTER_LAYOUTS.SQUARE.width) +
      ", top " + pc(rect.top, POSTER_LAYOUTS.SQUARE.height) +
      ", width " + pc(rect.width, POSTER_LAYOUTS.SQUARE.width) +
      ", height " + pc(rect.height, POSTER_LAYOUTS.SQUARE.height),
    );
  });

  /**
   * The product is a photograph of real packaging, so its colours are fixed. The palette
   * is the thing that can move — but only if the model is told what it is designing
   * around. Without this line it picks a palette and the bottle has to fight it.
   */
  it("tells the model the product's palette when one will be composited", () => {
    const withProduct = buildDesignPrompt({ ...brief, productColours: ["navy", "red"] });
    expect(withProduct).toMatch(/PRODUCT PALETTE/);
    expect(withProduct).toContain("predominantly navy and red");
    expect(withProduct).toMatch(/never recolour or repaint the product itself/i);
  });

  it("omits the palette line entirely when no product is placed", () => {
    expect(prompt).not.toMatch(/PRODUCT PALETTE/);
  });

  it("demands the typography be composed into the layout, not laid over a background", () => {
    // This is the difference the owner reported between a real poster and words on a photo.
    expect(prompt).toMatch(/composed INTO the layout/i);
    expect(prompt).toMatch(/Do not simply place words on top of a background/i);
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

  it("includes the chosen art direction", () => {
    const graphic = buildDesignPrompt({ ...brief, style: "GRAPHIC" });
    expect(graphic).toContain(POSTER_STYLES.GRAPHIC.direction);
    const industrial = buildDesignPrompt({ ...brief, style: "INDUSTRIAL" });
    expect(industrial).toContain(POSTER_STYLES.INDUSTRIAL.direction);
  });

  it("passes the subject through for imagery only", () => {
    const p = buildDesignPrompt({ ...brief, subject: "Hari Malaysia road trip" });
    expect(p).toContain("Hari Malaysia road trip");
    expect(p).toMatch(/for imagery only, not text/i);
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

describe("POSTER_STYLES", () => {
  it("defaults to a graphic style, because photographic ones read as a picture with words on it", () => {
    expect(DEFAULT_POSTER_STYLE).toBe("GRAPHIC");
    expect(POSTER_STYLES[DEFAULT_POSTER_STYLE].medium).toBe("graphic");
  });

  it("offers both graphic and photographic directions", () => {
    const media = new Set(Object.values(POSTER_STYLES).map((s) => s.medium));
    expect(media.has("graphic")).toBe(true);
    expect(media.has("photo")).toBe(true);
  });

  it("gives every style a direction, label, summary and swatch", () => {
    for (const s of Object.values(POSTER_STYLES)) {
      expect(s.direction.length).toBeGreaterThan(60);
      expect(s.label.length).toBeGreaterThan(2);
      expect(s.summary.length).toBeGreaterThan(10);
      expect(s.swatch).toMatch(/gradient/);
    }
  });

  it("resolves an unknown or absent style to the default rather than failing", () => {
    expect(styleFor("NOPE").key).toBe(DEFAULT_POSTER_STYLE);
    expect(styleFor(null).key).toBe(DEFAULT_POSTER_STYLE);
    expect(styleFor(undefined).key).toBe(DEFAULT_POSTER_STYLE);
    expect(styleFor("industrial").key).toBe("INDUSTRIAL");
  });
});

describe("textInstructions", () => {
  it("numbers the lines in reading order with the badge first", () => {
    const lines = textInstructions(brief);
    expect(lines[0]).toMatch(/badge/i);
    expect(lines[0]).toContain("Hari Malaysia");
    expect(lines[1]).toContain("Headline");
    expect(lines[lines.length - 1]).toMatch(/button or tag shape/i);
  });

  it("names the headline as the largest type", () => {
    expect(textInstructions(brief)[1]).toMatch(/largest type on the poster/i);
  });

  it("puts each line in a distinct visual tier", () => {
    const joined = textInstructions(brief).join("\n");
    expect(joined).toMatch(/noticeably smaller than the headline/i);
    expect(joined).toMatch(/smallest tier/i);
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
