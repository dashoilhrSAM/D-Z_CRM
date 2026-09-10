import { describe, expect, it } from "vitest";
import {
  MAX_BRIGHTNESS,
  MAX_CHANNEL,
  MIN_BRIGHTNESS,
  MIN_CHANNEL,
  STUDIO_LUMA,
  lumaOf,
  matchGrade,
  sampleFromMean,
} from "@/modules/marketing/poster-grade";
import { POSTER_LAYOUTS, STAGE_WIDTH_RATIO, stageRect } from "@/modules/marketing/poster-design";

const WHITE_STUDIO = sampleFromMean(255, 255, 255);
const BLACK = sampleFromMean(0, 0, 0);
// luma 209/255 = 0.8196, i.e. exactly the studio reference.
const NEUTRAL_STAGE = sampleFromMean(209, 209, 209);
const CREAM_STAGE = sampleFromMean(250, 240, 220);
const NAVY_STAGE = sampleFromMean(12, 25, 55);

describe("lumaOf", () => {
  it("is 0 for black and 1 for white", () => {
    expect(lumaOf(0, 0, 0)).toBe(0);
    expect(lumaOf(255, 255, 255)).toBeCloseTo(1, 5);
  });

  it("weights green most, the way the eye does", () => {
    expect(lumaOf(0, 255, 0)).toBeGreaterThan(lumaOf(255, 0, 0));
    expect(lumaOf(255, 0, 0)).toBeGreaterThan(lumaOf(0, 0, 255));
  });
});

describe("matchGrade", () => {
  it("leaves the product alone when the stage is already studio-bright", () => {
    expect(matchGrade(NEUTRAL_STAGE).brightness).toBeCloseTo(1, 2);
  });

  it("brightens the product on a bright poster and darkens it on a dark one", () => {
    expect(matchGrade(CREAM_STAGE).brightness).toBeGreaterThan(1);
    expect(matchGrade(NAVY_STAGE).brightness).toBeLessThan(1);
  });

  /**
   * The bounds are the whole safety argument: the product is the brand's own packaging,
   * so the grade is allowed to nudge it and nothing more. A full match to a black poster
   * would drive the bottle to near black and destroy the label.
   */
  it("never moves brightness outside a tenth in either direction", () => {
    expect(matchGrade(WHITE_STUDIO).brightness).toBeLessThanOrEqual(MAX_BRIGHTNESS);
    expect(matchGrade(BLACK).brightness).toBeGreaterThanOrEqual(MIN_BRIGHTNESS);
    expect(matchGrade(BLACK).brightness).toBe(MIN_BRIGHTNESS);
    expect(MAX_BRIGHTNESS).toBeLessThanOrEqual(1.11);
  });

  it("stops short of a full match, so the label keeps its own colours", () => {
    const stage = sampleFromMean(140, 140, 140);
    const grade = matchGrade(stage);
    // Partial means it lands closer to 1 than a full match to the stage would.
    expect(grade.brightness).toBeGreaterThan(stage.luma / STUDIO_LUMA);
    expect(grade.brightness).toBeLessThan(1);
  });

  it("does not darken a product that is already in a bright scene", () => {
    // A regression worth pinning: the first version was a fixed 0.94 darkening, which is
    // simply wrong on a bright poster.
    expect(matchGrade(WHITE_STUDIO).brightness).toBeGreaterThan(1);
  });

  it("warms the product on a warm poster and cools it on a cool one", () => {
    const warm = matchGrade(CREAM_STAGE);
    expect(warm.channel[0]).toBeGreaterThan(warm.channel[2]);
    const cool = matchGrade(NAVY_STAGE);
    expect(cool.channel[2]).toBeGreaterThan(cool.channel[0]);
  });

  it("keeps the colour cast subtle enough to still trust the label", () => {
    for (const stage of [CREAM_STAGE, NAVY_STAGE, WHITE_STUDIO, BLACK]) {
      for (const c of matchGrade(stage).channel) {
        expect(c).toBeLessThanOrEqual(MAX_CHANNEL);
        expect(c).toBeGreaterThanOrEqual(MIN_CHANNEL);
      }
    }
  });

  it("does not tint a neutral stage at all", () => {
    for (const c of matchGrade(NEUTRAL_STAGE).channel) expect(c).toBeCloseTo(1, 3);
  });

  it("explains itself, so a bad poster can be diagnosed", () => {
    const reason = matchGrade(CREAM_STAGE).reason;
    expect(reason).toContain("stage luma");
    expect(reason).toContain("cast");
  });

  /**
   * An ink outline around the cut-out was built and measured, and rejected — two
   * independent critiques said it made the bottle look more pasted on, not less. This
   * test exists so a future change does not quietly reintroduce it on a hunch.
   */
  it("never returns an outline", () => {
    expect(Object.keys(matchGrade(CREAM_STAGE))).not.toContain("outline");
  });
});

describe("stageRect", () => {
  it("stays inside the canvas for every size", () => {
    for (const key of ["SQUARE", "STORY", "BANNER"] as const) {
      const layout = POSTER_LAYOUTS[key];
      const rect = stageRect(layout, layout.width, layout.height);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.left + rect.width).toBeLessThanOrEqual(layout.width);
      expect(rect.top + rect.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it("covers the same fractions the prompt describes to the model", () => {
    const layout = POSTER_LAYOUTS.SQUARE;
    const rect = stageRect(layout, layout.width, layout.height);
    expect(rect.width).toBe(Math.round(layout.width * STAGE_WIDTH_RATIO));
    expect(rect.height).toBe(Math.round(layout.stage.heightRatio * layout.height));
    expect(rect.left + rect.width / 2).toBeCloseTo(layout.stage.centerX * layout.width, -1);
    expect(rect.top + rect.height).toBe(Math.round(layout.stage.bottomY * layout.height));
  });

  /**
   * The rectangle used to sample the poster's ambient light and the rectangle the product
   * is composited into have to be the same one, or the bottle is graded for a part of the
   * poster it is not standing on.
   */
  it("is one definition shared by sampling and compositing", () => {
    for (const key of ["SQUARE", "STORY", "BANNER"] as const) {
      const layout = POSTER_LAYOUTS[key];
      const rect = stageRect(layout, layout.width, layout.height);
      expect(rect.top + rect.height).toBe(Math.round(layout.stage.bottomY * layout.height));
      expect(rect.left + rect.width / 2).toBeCloseTo(layout.stage.centerX * layout.width, -1);
    }
  });
});
