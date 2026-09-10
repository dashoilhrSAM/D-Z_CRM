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
import { describeColours } from "./product-colours";

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

/** Width of the reserved stage as a fraction of the canvas width. */
export const STAGE_WIDTH_RATIO = 0.3;

/**
 * The reserved stage as pixels on the finished canvas.
 *
 * The one definition of where the product goes. It is used for three things that must
 * never disagree: the rectangle sampled for ambient light, the rectangle described to
 * the model, and the rectangle the cut-out is composited into. Deriving them from the
 * same entry is what stops the bottle landing on the headline.
 */
export function stageRect(
  layout: PosterLayout,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  const w = Math.max(1, Math.round(width * STAGE_WIDTH_RATIO));
  const h = Math.max(1, Math.round(layout.stage.heightRatio * height));
  const cx = Math.round(layout.stage.centerX * width);
  const bottom = Math.round(layout.stage.bottomY * height);
  const left = Math.max(0, Math.min(width - w, cx - Math.round(w / 2)));
  const top = Math.max(0, Math.min(height - h, bottom - h));
  return { left, top, width: w, height: h };
}

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
  /**
   * How the reserved product window should be built.
   *
   * The composited product is a photograph. Inside a flat illustrated poster it reads as
   * pasted on no matter how well it is lit, because a photograph surrounded by flat
   * shapes is a style clash. The fix is not to fake the product's style but to stop the
   * clash being accidental: the model is told to reserve a clearly delineated
   * PHOTOGRAPHIC WINDOW, so a photograph sitting there is what the design asked for.
   */
  stageLook: string;
  direction: string;
}

export const POSTER_STYLES: Record<PosterStyleKey, PosterStyle> = {
  GRAPHIC: {
    key: "GRAPHIC", label: "Graphic", summary: "Flat vector, bold colour blocks, print feel", medium: "graphic",
    stageLook: "a clean flat panel in the poster's own palette with a crisp edge and a small corner radius, as if a product photo had been pasted into a print layout",
    swatch: "linear-gradient(135deg,#0f766e,#f97316 55%,#fef3c7)",
    direction:
      "Design a FLAT GRAPHIC EDITORIAL poster. VISUAL: bold flat vector shapes and strong colour blocking in teal, burnt orange and cream; " +
      "geometric abstract shapes suggesting engine internals; halftone dot texture; risograph print style; thick confident outlines. " +
      "Typography is integrated into coloured blocks and frames rather than sitting on a background. No photography at all.",
  },
  INDUSTRIAL: {
    key: "INDUSTRIAL", label: "Industrial", summary: "Concrete, hazard stripes, oversized type", medium: "graphic",
    stageLook: "a hard rectangle framed by a stencilled border or thin hazard-stripe edge, like a spec plate mounted on the layout",
    swatch: "linear-gradient(135deg,#1c1917,#f97316)",
    direction:
      "Design an INDUSTRIAL / BRUTALIST advertising poster. VISUAL: raw concrete and brushed metal textures; heavy black with safety-orange accents; " +
      "oversized condensed typography used AS a graphic element; technical schematic line drawings of engine and clutch parts; warning-stripe accents; stencil marks. " +
      "Utilitarian workshop-floor aesthetic. A designed graphic composition — not a photograph.",
  },
  BLUEPRINT: {
    key: "BLUEPRINT", label: "Blueprint", summary: "Technical drawing, navy grid, callouts", medium: "graphic",
    stageLook: "a rectangle outlined in thin white technical rules with small corner ticks, presented as an inset viewport in the drawing",
    swatch: "linear-gradient(135deg,#0c1e3d,#38bdf8)",
    direction:
      "Design a TECHNICAL BLUEPRINT poster. VISUAL: deep navy blueprint background with a fine white technical grid; precise exploded-view line drawings of " +
      "motorcycle engine and clutch components; dimension arrows and small callout labels used as decoration; thin white and orange rules. " +
      "Crisp engineering aesthetic that reads as designed artwork, not a photo.",
  },
  BOLD: {
    key: "BOLD", label: "Bold promo", summary: "Diagonal energy, big shapes, sale energy", medium: "graphic",
    stageLook: "a strong panel cut on a diagonal or a bold rounded shape with a thick contrasting edge, sitting on top of the background shapes",
    swatch: "linear-gradient(135deg,#1e3a8a,#f97316)",
    direction:
      "Design a BOLD PROMOTIONAL poster with advertising-poster energy. VISUAL: giant diagonal colour blocks in deep navy and vivid orange slicing across the frame; " +
      "a large orange starburst or burst shape; speed motion streaks; screen-print feel with visible halftone texture. High contrast, loud, confident.",
  },
  CINEMATIC: {
    key: "CINEMATIC", label: "Cinematic", summary: "Moody hero shot, minimal, expensive", medium: "photo",
    stageLook: "a soft-edged pool of light with no hard border at all, fading into the surrounding scene",
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
  /**
   * Colours of the real product that will be placed in the reserved window, already
   * named (e.g. ["navy", "red"]).
   *
   * Given so the model can choose a palette the product sits in, instead of one the
   * product has to fight. The alternative — recolouring the label to match the poster —
   * is not available, because the label is the brand's.
   */
  productColours?: string[] | null;
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

  // The window is described to the model in the same percentages the compositor will use
  // to place the product. Two sources of truth here would put the bottle beside the
  // window instead of inside it.
  const rect = stageRect(layout, layout.width, layout.height);
  const pc = (n: number, total: number) => Math.round((n / total) * 100) + "%";
  const windowPct =
    "left " + pc(rect.left, layout.width) +
    ", top " + pc(rect.top, layout.height) +
    ", width " + pc(rect.width, layout.width) +
    ", height " + pc(rect.height, layout.height);
  const stageLook = style.stageLook;

  return [
    "Design a professional advertising poster for " + brief.brandName + ", a Malaysian motorcycle workshop.",
    orientation + " format, " + layout.width + " x " + layout.height + " pixels.",
    "",
    style.direction,
    brief.subject ? "Subject context (for imagery only, not text): " + brief.subject + "." : "",
    brief.productColours && brief.productColours.length > 0
      ? "PRODUCT PALETTE — choose your colours around this: the reserved window will receive a real product photograph whose packaging is predominantly " +
        describeColours(brief.productColours) +
        ". Build the background, blocks and accent colours so that product sits naturally in your design. Use colours that complement it rather than compete with it, and never recolour or repaint the product itself.\n" +
        "Where the art direction above names specific colours, treat those as suggestions: this palette takes precedence, because the product's colours cannot change."
      : "",
    "",
    "TYPOGRAPHY IS PART OF THE DESIGN",
    "- The type must be composed INTO the layout — set inside colour blocks, aligned to a strong grid, framed by rules or shapes. Do not simply place words on top of a background.",
    "- Use a clear hierarchy: one dominant headline, one supporting line, and small technical details.",
    "- Render ONLY the text listed below, spelled exactly as written. Do NOT add, translate, invent, repeat or embellish any other word anywhere in the image. No placeholder text, no lorem ipsum, no gibberish characters, no watermark.",
    ...textInstructions(brief),
    "Place all typography in " + layout.textZoneHint + ".",
    "",
    "CRITICAL — THE RESERVED PRODUCT WINDOW",
    "- Do NOT draw any bottle, jug, can, container, tube, packaging or product of any kind, and do not draw an illustration of one.",
    "- Build " + stageLook + " occupying " + windowPct + " of the canvas — " + layout.stageHint + ".",
    "- Inside that window paint ONLY a plain seamless studio backdrop and the soft shadow a photographed object would cast onto it: an evenly lit surface, like the sweep a product is photographed on. Nothing else.",
    "- That backdrop must be a colour taken from your own poster palette and must sit at the same brightness and mood as the rest of the design — a seamless sweep that continues the artwork. It must NOT be plain white or a bright empty box: a white panel punches a hole in a dark poster and makes the product read as a sticker.",
    "- Let the window take a shape that belongs to the layout (a panel, an arch, a circle, a torn edge) rather than a plain rectangle with a hard border.",
    "- The window must contain no object, no product, no text, no logo and no pattern that would sit behind a product. It is deliberately empty.",
    "- That window is where a real product photograph is placed afterwards, so design the surrounding layout to frame it.",
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
