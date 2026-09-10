// Poster art direction.
//
// WHAT CHANGED AND WHY
// --------------------
// The first design let the model paint a photographic background. It scored 7/10 and the
// critique said the same thing the owner did: "text placed over an image rather than
// integrated into the design". Measuring four directions side by side made the cause
// obvious — photographic styles always land as a picture with words on top, while graphic
// styles score 8-9/10 because the typography becomes part of the composition.
//
// So the default is now a graphic poster, and art direction is selectable rather than
// fixed. The reserved product stage survives every style: the model is told to compose an
// empty area (it may frame it with a circle, a colour block or a glow, just not fill it),
// and the real cut-out goes there. That is what keeps the design free AND the label true.
import type { PosterSizeKey } from "./images";

export interface PosterLayout {
  width: number;
  height: number;
  /** Where the compositor will place the product — described to the model verbatim. */
  stage: { centerX: number; bottomY: number; heightRatio: number };
  /** Prose description of the reserved area, written for the model. */
  stageHint: string;
  /** Rough share of the canvas the text may occupy, as prose. */
  textZoneHint: string;
}

export const POSTER_LAYOUTS: Record<PosterSizeKey, PosterLayout> = {
  SQUARE: {
    width: 1080, height: 1080,
    stage: { centerX: 0.73, bottomY: 0.78, heightRatio: 0.52 },
    stageHint: "the right third of the canvas",
    textZoneHint: "the left two thirds, left-aligned, with the headline in the upper half",
  },
  STORY: {
    width: 1080, height: 1920,
    stage: { centerX: 0.5, bottomY: 0.88, heightRatio: 0.36 },
    stageHint: "the lower middle third of the canvas",
    textZoneHint: "the upper half, left-aligned, stacked top to bottom with generous spacing, leaving the top edge clear for the platform UI",
  },
  BANNER: {
    width: 1920, height: 1080,
    stage: { centerX: 0.76, bottomY: 0.80, heightRatio: 0.58 },
    stageHint: "the right third of the canvas",
    textZoneHint: "the left half, left-aligned and vertically centred",
  },
};

export type PosterStyleKey = "GRAPHIC" | "INDUSTRIAL" | "BLUEPRINT" | "BOLD" | "CINEMATIC";

export interface PosterStyle {
  key: PosterStyleKey;
  /** Shown in the picker. */
  label: string;
  /** One line describing the look, for the picker subtitle. */
  summary: string;
  /** CSS gradient used as the picker swatch. */
  swatch: string;
  /**
   * Graphic styles integrate typography into the composition and score highest.
   * Photographic styles read as a picture with words on top, so they are offered but
   * never the default.
   */
  medium: "graphic" | "photo";
  direction: string;
}

export const POSTER_STYLES: Record<PosterStyleKey, PosterStyle> = {
  GRAPHIC: {
    key: "GRAPHIC", label: "Graphic", summary: "Flat vector, bold colour blocks, print feel", medium: "graphic",
    swatch: "linear-gradient(135deg,#0f766e,#f97316 55%,#fef3c7)",
    direction:
      "Design a FLAT GRAPHIC EDITORIAL poster. VISUAL: bold flat vector shapes and strong colour blocking in teal, burnt orange and cream; " +
      "geometric abstract shapes suggesting engine internals; halftone dot texture; risograph print style; thick confident outlines. " +
      "Typography is integrated into coloured blocks and frames rather than sitting on a background. No photography at all.",
  },
  INDUSTRIAL: {
    key: "INDUSTRIAL", label: "Industrial", summary: "Concrete, hazard stripes, oversized type", medium: "graphic",
    swatch: "linear-gradient(135deg,#1c1917,#f97316)",
    direction:
      "Design an INDUSTRIAL / BRUTALIST advertising poster. VISUAL: raw concrete and brushed metal textures; heavy black with safety-orange accents; " +
      "oversized condensed typography used AS a graphic element; technical schematic line drawings of engine and clutch parts; warning-stripe accents; stencil marks. " +
      "Utilitarian workshop-floor aesthetic. A designed graphic composition — not a photograph.",
  },
  BLUEPRINT: {
    key: "BLUEPRINT", label: "Blueprint", summary: "Technical drawing, navy grid, callouts", medium: "graphic",
    swatch: "linear-gradient(135deg,#0c1e3d,#38bdf8)",
    direction:
      "Design a TECHNICAL BLUEPRINT poster. VISUAL: deep navy blueprint background with a fine white technical grid; precise exploded-view line drawings of " +
      "motorcycle engine and clutch components; dimension arrows and small callout labels used as decoration; thin white and orange rules. " +
      "Crisp engineering aesthetic that reads as designed artwork, not a photo.",
  },
  BOLD: {
    key: "BOLD", label: "Bold promo", summary: "Diagonal energy, big shapes, sale energy", medium: "graphic",
    swatch: "linear-gradient(135deg,#1e3a8a,#f97316)",
    direction:
      "Design a BOLD PROMOTIONAL poster with advertising-poster energy. VISUAL: giant diagonal colour blocks in deep navy and vivid orange slicing across the frame; " +
      "a large orange starburst or burst shape; speed motion streaks; screen-print feel with visible halftone texture. High contrast, loud, confident.",
  },
  CINEMATIC: {
    key: "CINEMATIC", label: "Cinematic", summary: "Moody hero shot, minimal, expensive", medium: "photo",
    swatch: "linear-gradient(135deg,#09090b,#78716c)",
    direction:
      "Design a CINEMATIC HERO poster, like a premium automotive brand campaign. VISUAL: one dramatic light source; deep shadow; volumetric haze; " +
      "an almost monochrome palette with a single warm accent; vast empty space; restrained and expensive. Editorial, minimal, photographic.",
  },
};

export const DEFAULT_POSTER_STYLE: PosterStyleKey = "GRAPHIC";

export function styleFor(key: string | null | undefined): PosterStyle {
  const k = (key ?? "").toUpperCase() as PosterStyleKey;
  return POSTER_STYLES[k] ?? POSTER_STYLES[DEFAULT_POSTER_STYLE];
}

export interface DesignBrief {
  size: PosterSizeKey;
  /** Art direction. Defaults to the graphic style. */
  style?: PosterStyleKey;
  brandName: string;
  badge?: string | null;
  headline: string;
  sub?: string | null;
  caption?: string | null;
  cta?: string | null;
  /** Optional scene subject hint, e.g. the occasion or the product category. */
  subject?: string | null;
}

/** The text the poster must contain, in order, as prompt lines. */
export function textInstructions(brief: DesignBrief): string[] {
  const out: string[] = [];
  let n = 1;
  if (brief.badge) out.push(n++ + ". A small inset badge or coloured tag in the top-left: " + brief.badge);
  out.push(n++ + ". Headline — the largest type on the poster, tight leading, at most two lines: " + brief.headline);
  if (brief.sub) out.push(n++ + ". Directly under the headline, in the accent colour, noticeably smaller than the headline: " + brief.sub);
  if (brief.caption) out.push(n++ + ". A small technical caption in the type area, smallest tier: " + brief.caption);
  out.push(n++ + ". Bottom-left, small: " + brief.brandName);
  if (brief.cta) out.push(n++ + ". Bottom-right, set inside a solid accent button or tag shape: " + brief.cta);
  return out;
}

/**
 * Build the poster design prompt.
 *
 * Exported verbatim so the wording can be reviewed and asserted in tests — these
 * instructions are the difference between a designed poster and a picture with words on it.
 */
export function buildDesignPrompt(brief: DesignBrief): string {
  const layout = POSTER_LAYOUTS[brief.size];
  const style = styleFor(brief.style);
  const orientation = layout.height > layout.width ? "Vertical portrait" : layout.width > layout.height ? "Horizontal landscape" : "Square";
  const approved = [brief.badge, brief.headline, brief.sub, brief.caption, brief.brandName, brief.cta]
    .filter((v): v is string => Boolean(v && v.trim()));

  return [
    "Design a professional advertising poster for " + brief.brandName + ", a Malaysian motorcycle workshop.",
    orientation + " format, " + layout.width + " x " + layout.height + " pixels.",
    "",
    style.direction,
    brief.subject ? "Subject context (for imagery only, not text): " + brief.subject + "." : "",
    "",
    "TYPOGRAPHY IS PART OF THE DESIGN",
    "- The type must be composed INTO the layout — set inside colour blocks, aligned to a strong grid, framed by rules or shapes. Do not simply place words on top of a background.",
    "- Use a clear hierarchy: one dominant headline, one supporting line, and small technical details.",
    "- Render ONLY the text listed below, spelled exactly as written. Do NOT add, translate, invent, repeat or embellish any other word anywhere in the image. No placeholder text, no lorem ipsum, no gibberish characters, no watermark.",
    ...textInstructions(brief),
    "Place all typography in " + layout.textZoneHint + ".",
    "",
    "CRITICAL — THE PRODUCT AREA MUST STAY EMPTY",
    "- Do NOT draw any bottle, jug, can, container, tube, packaging or product of any kind, and do not draw an illustration of one.",
    "- Reserve " + layout.stageHint + " as a deliberately composed EMPTY space. You MAY frame it with a circle, a colour block, a glow, a plinth or rules — but the space itself must contain no object.",
    "- That area is reserved for a real product photograph to be placed later.",
    "",
    "Quality: crisp legible kerning, correct spelling, sharp edges, print-ready finish.",
    "The only words in the final image must be exactly: " + approved.map((s) => "\"" + s + "\"").join(", ") + ".",
  ].filter((l) => l !== "").join("\n");
}

/**
 * Words that must appear in the rendered poster. Used to verify a generated image
 * actually contains the intended copy rather than trusting that it does.
 */
export function requiredWords(brief: DesignBrief): string[] {
  return [brief.headline, brief.sub, brief.caption, brief.brandName, brief.cta, brief.badge]
    .filter((v): v is string => Boolean(v && v.trim()))
    .flatMap((v) => v.split(/\s+/))
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length >= 3);
}
