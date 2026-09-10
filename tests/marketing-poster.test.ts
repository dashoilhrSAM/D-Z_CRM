// Poster pipeline. The layout and text maths are pure, so they are tested without
// rendering an image or calling a model.
import { describe, it, expect } from "vitest";
import { measureText, wrapText, renderTextBlock, renderTextBlocks, getFont, esc } from "@/modules/marketing/poster-text";
import { px, footerBlocks } from "@/modules/marketing/poster";
import { SIZE_MAP, BACKGROUND_RULES, sceneFor } from "@/modules/marketing/images";
import { buildExpandPrompt, EXPAND_SYSTEM, normaliseHashtags, normalisePosterLine, PLATFORM_LIMITS, PLATFORMS } from "@/modules/marketing/expand";

describe("poster-text fonts", () => {
  it("loads both embedded fonts without touching the filesystem", () => {
    expect(getFont("bold").numGlyphs).toBeGreaterThan(100);
    expect(getFont("body").numGlyphs).toBeGreaterThan(100);
  });

  it("caches so repeated calls do not reparse", () => {
    expect(getFont("bold")).toBe(getFont("bold"));
  });

  it("covers the characters a Malaysian poster needs", () => {
    const font = getFont("bold");
    const needed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?:;()-/%&+@#'\"·—";
    const missing = [...needed].filter((ch) => ch !== " " && font.charToGlyphIndex(ch) === 0);
    expect(missing).toEqual([]);
  });
});

describe("measureText and wrapText", () => {
  const font = getFont("bold");

  it("measures a longer string as wider", () => {
    expect(measureText("SERVIS MOTO PANJANG", font, 40)).toBeGreaterThan(measureText("SERVIS", font, 40));
  });

  it("scales with font size", () => {
    expect(measureText("ABC", font, 80)).toBeGreaterThan(measureText("ABC", font, 40));
  });

  it("adds letter spacing between characters only", () => {
    const plain = measureText("ABC", font, 40, 0);
    expect(measureText("ABC", font, 40, 10)).toBeCloseTo(plain + 20, 5);
    expect(measureText("A", font, 40, 10)).toBeCloseTo(measureText("A", font, 40, 0), 5);
  });

  it("wraps so that no line exceeds the width", () => {
    const text = "Sebelum balik kampung pastikan brake dan tayar motosikal anda dalam keadaan terbaik";
    const lines = wrapText(text, font, 34, 560);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measureText(l, font, 34)).toBeLessThanOrEqual(560);
  });

  it("keeps every word — wrapping must not drop content", () => {
    const text = "satu dua tiga empat lima enam tujuh lapan";
    const joined = wrapText(text, font, 30, 200).join(" ");
    expect(joined.split(/\s+/)).toEqual(text.split(" "));
  });

  it("breaks a single word that cannot fit rather than overflowing", () => {
    const lines = wrapText("VERYLONGSKUCODE1234567890", font, 40, 100);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measureText(l, font, 40)).toBeLessThanOrEqual(100);
  });

  it("preserves explicit newlines", () => {
    expect(wrapText("a\nb", font, 30, 9999)).toEqual(["a", "b"]);
  });
});

describe("renderTextBlock", () => {
  it("emits vector paths, never a <text> element", () => {
    const r = renderTextBlock({ text: "SERVIS", x: 10, y: 50, size: 40 });
    expect(r.svg).toContain("<path");
    expect(r.svg).not.toContain("<text");
  });

  it("reports a height covering every line", () => {
    const one = renderTextBlock({ text: "a", x: 0, y: 0, size: 40 });
    const two = renderTextBlock({ text: "a\nb", x: 0, y: 0, size: 40 });
    expect(two.height).toBeGreaterThan(one.height);
  });

  it("right-aligns by shifting the start, not the paths", () => {
    const left = renderTextBlock({ text: "ABC", x: 100, y: 0, size: 40, align: "left" });
    const right = renderTextBlock({ text: "ABC", x: 100, y: 0, size: 40, align: "right" });
    expect(right.svg).not.toBe(left.svg);
  });

  it("uppercases only when asked", () => {
    const a = renderTextBlock({ text: "abc", x: 0, y: 0, size: 40 });
    const b = renderTextBlock({ text: "abc", x: 0, y: 0, size: 40, uppercase: true });
    expect(b.svg).not.toBe(a.svg);
  });

  it("adds fill-opacity only for translucent text", () => {
    expect(renderTextBlock({ text: "a", x: 0, y: 0, size: 20, opacity: 0.5 }).svg).toContain("fill-opacity");
    expect(renderTextBlock({ text: "a", x: 0, y: 0, size: 20 }).svg).not.toContain("fill-opacity");
  });

  it("never renders an empty line as a path", () => {
    expect(renderTextBlock({ text: "a\n\nb", x: 0, y: 0, size: 20 }).svg.match(/<path/g)!.length).toBe(2);
  });
});

describe("renderTextBlocks", () => {
  it("returns the lowest bottom edge so blocks can be stacked", () => {
    const { height } = renderTextBlocks([
      { text: "one", x: 0, y: 100, size: 40 },
      { text: "two", x: 0, y: 200, size: 40 },
    ]);
    expect(height).toBeGreaterThan(200);
  });
});

describe("esc", () => {
  it("escapes the characters that would break an SVG", () => {
    expect(esc('D&Z "Smart" <b>')).toBe("D&amp;Z &quot;Smart&quot; &lt;b&gt;");
  });
});

describe("px", () => {
  it("maps a fraction to canvas pixels and clamps to bounds", () => {
    expect(px(0.5, 1000)).toBe(500);
    expect(px(-1, 1000)).toBe(0);
    expect(px(2, 1000)).toBe(1000);
  });
});

describe("footerBlocks", () => {
  it("always includes the brand name", () => {
    const b = footerBlocks({ width: 1080, height: 1080, name: "D&Z Smart Workshop" });
    expect(b[0].text).toBe("D&Z Smart Workshop");
  });

  it("joins phone and tagline when present", () => {
    const b = footerBlocks({ width: 1080, height: 1080, name: "X", phone: "011-1", tagline: "Walk-in" });
    expect(b).toHaveLength(2);
    expect(b[1].text).toContain("011-1");
    expect(b[1].text).toContain("Walk-in");
  });

  it("omits the contact line entirely when there is nothing to show", () => {
    expect(footerBlocks({ width: 1080, height: 1080, name: "X" })).toHaveLength(1);
  });

  it("scales type with the canvas so it fits any poster size", () => {
    const small = footerBlocks({ width: 1080, height: 1080, name: "X" });
    const big = footerBlocks({ width: 1920, height: 1080, name: "X" });
    expect(big[0].size).toBeGreaterThan(small[0].size);
  });
});

describe("images", () => {
  it("maps every poster size to a generation size and a canvas", () => {
    for (const key of ["SQUARE", "STORY", "BANNER"] as const) {
      expect(SIZE_MAP[key].gen).toMatch(/^\d+x\d+$/);
      expect(SIZE_MAP[key].width).toBeGreaterThan(0);
    }
  });

  it("uses portrait generation for stories and landscape for banners", () => {
    const [sw, sh] = SIZE_MAP.STORY.gen.split("x").map(Number);
    const [bw, bh] = SIZE_MAP.BANNER.gen.split("x").map(Number);
    expect(sh).toBeGreaterThan(sw);
    expect(bw).toBeGreaterThan(bh);
  });

  it("forbids text in every background prompt", () => {
    expect(BACKGROUND_RULES).toMatch(/no text/i);
    expect(BACKGROUND_RULES).toMatch(/no logo/i);
  });

  it("describes a scene with no product in it — the product is composited", () => {
    for (const kind of ["product", "service", "occasion"] as const) {
      const s = sceneFor({ kind, subject: "oil" });
      expect(s.length).toBeGreaterThan(20);
      expect(s.toLowerCase()).not.toMatch(/bottle|label text/);
    }
  });
});

describe("expand", () => {
  it("tells the model the poster lines are drawn onto an image and must be short", () => {
    expect(EXPAND_SYSTEM).toContain("DRAWN ONTO AN IMAGE");
    expect(EXPAND_SYSTEM).toMatch(/at most 5 words/);
  });

  it("forbids reproducing wording from trend or competitor content", () => {
    expect(EXPAND_SYSTEM).toMatch(/never reproduce/i);
  });

  it("forbids text and product in the poster scene description", () => {
    expect(EXPAND_SYSTEM).toMatch(/must NOT mention any text, logo or product/i);
  });

  it("carries the hard facts rule", () => {
    expect(EXPAND_SYSTEM).toMatch(/Never invent a fact/i);
  });

  it("builds a prompt listing every requested platform", () => {
    const p = buildExpandPrompt({
      script: { hook: "h", body: "b", cta: "c", angle: "a", platform: "TIKTOK", language: "ms" },
      product: null, brandName: null, platforms: PLATFORMS,
    });
    for (const pl of PLATFORMS) expect(p).toContain(pl);
  });

  it("says so explicitly when there is no product", () => {
    const p = buildExpandPrompt({
      script: { hook: null, body: "b", cta: null, angle: null, platform: "TIKTOK", language: "ms" },
      product: null, brandName: null, platforms: ["TIKTOK"],
    });
    expect(p).toContain("PRODUCT: none");
  });

  it("passes real product facts and forbids inventing others", () => {
    const p = buildExpandPrompt({
      script: { hook: null, body: "b", cta: null, angle: null, platform: "TIKTOK", language: "ms" },
      product: { name: "E1300+ V2", volume: "1.2L", facts: "api: API SP", points: ["Maximum Performance"] },
      brandName: "DASHOIL", platforms: ["TIKTOK"],
    });
    expect(p).toContain("E1300+ V2");
    expect(p).toContain("API SP");
    expect(p).toContain("DASHOIL");
  });

  it("states the caption limit for each requested platform", () => {
    const p = buildExpandPrompt({
      script: { hook: null, body: "b", cta: null, angle: null, platform: "TIKTOK", language: "ms" },
      product: null, brandName: null, platforms: ["TIKTOK", "INSTAGRAM"],
    });
    expect(p).toContain(String(PLATFORM_LIMITS.TIKTOK.caption));
    expect(p).toContain(String(PLATFORM_LIMITS.INSTAGRAM.caption));
  });
});

describe("normaliseHashtags", () => {
  it("adds a hash when missing and de-duplicates", () => {
    expect(normaliseHashtags(["dashoil", "#dashoil", "moto"])).toEqual(["#dashoil", "#moto"]);
  });

  it("rejects non-strings and empty values", () => {
    expect(normaliseHashtags([1, null, "", "  ", "ok"])).toEqual(["#ok"]);
  });

  it("caps the list so a caption cannot be flooded", () => {
    expect(normaliseHashtags(Array.from({ length: 30 }, (_, i) => "tag" + i))).toHaveLength(12);
  });

  it("returns an empty array for junk input", () => {
    expect(normaliseHashtags("nope")).toEqual([]);
  });
});

describe("normalisePosterLine", () => {
  it("caps the word count", () => {
    expect(normalisePosterLine("one two three four five six seven", 3)).toBe("one two three");
  });

  it("strips trailing punctuation because it is drawn large", () => {
    expect(normalisePosterLine("Jaga Enjin!", 5)).toBe("Jaga Enjin");
    expect(normalisePosterLine("Betul.", 5)).toBe("Betul");
  });

  it("returns an empty string for missing or invalid values", () => {
    expect(normalisePosterLine(undefined, 5)).toBe("");
    expect(normalisePosterLine(123, 5)).toBe("");
  });
});
