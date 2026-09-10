// Poster design prompts.
//
// THE APPROACH, AND WHY IT CHANGED
// --------------------------------
// The first version of this generated a photographic background, then drew the text on
// top as vector paths. The output was a photo with words pasted over it — technically a
// poster, but not designed.
//
// The assumption behind it was that image models cannot render text reliably. Measured
// against gpt-image-2.5 that assumption is simply out of date: asked for a poster, it
// returned correct Malay typography with a badge, a headline hierarchy, an accent rule
// and a button shape, all spelled right, with no invented copy once told not to.
//
// So the model now designs the whole poster — typography, layout, graphic language — and
// this module's job is to brief it precisely. One thing still cannot be delegated: the
// product. Asked to draw the bottle, the model invents a plausible label ("FULL SYNTHETIC
// ENGINE OIL"), and inventing the specification on a lubricant brand's own packaging is
// exactly what this system exists to prevent. So the prompt reserves an empty staged area
// and the real cut-out is composited into it afterwards.
//
// The reserved area is described in the prompt and used as the composite target from the
// SAME object. If those two ever drifted apart the bottle would land on the headline.
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

export interface DesignBrief {
  size: PosterSizeKey;
  /** Brand the poster belongs to (footer/attribution line). */
  brandName: string;
  /** Small badge text, e.g. an occasion. Optional. */
  badge?: string | null;
  headline: string;
  sub?: string | null;
  /** Product name and/or spec line shown as a small technical caption. */
  caption?: string | null;
  cta?: string | null;
  /** Palette direction, defaults to the brand's amber/charcoal. */
  mood?: string | null;
}

/** The text the poster must contain, in order, as prompt lines. */
export function textInstructions(brief: DesignBrief): string[] {
  const out: string[] = [];
  let n = 1;
  if (brief.badge) out.push(n++ + ". Top-left, inside a small rounded orange badge shape: " + brief.badge);
  out.push(n++ + ". Headline, very large heavy white sans-serif, tight leading, left aligned, at most two lines: " + brief.headline);
  if (brief.sub) out.push(n++ + ". Directly under the headline, medium amber sans-serif: " + brief.sub);
  if (brief.caption) out.push(n++ + ". Small technical caption in light grey sans-serif under the headline block: " + brief.caption);
  out.push(n++ + ". Bottom-left, small white sans-serif: " + brief.brandName);
  if (brief.cta) out.push(n++ + ". Bottom-right, inside a rounded orange pill button with black text: " + brief.cta);
  return out;
}

/**
 * Build the poster design prompt.
 *
 * Exported verbatim so the wording can be reviewed and asserted in tests — the
 * instructions here are the difference between a designed poster and a photo with words
 * on it, and between the model inventing copy and not.
 */
export function buildDesignPrompt(brief: DesignBrief): string {
  const layout = POSTER_LAYOUTS[brief.size];
  const orientation = layout.height > layout.width ? "Vertical portrait" : layout.width > layout.height ? "Horizontal landscape" : "Square";
  const approved = [brief.badge, brief.headline, brief.sub, brief.caption, brief.brandName, brief.cta]
    .filter((v): v is string => Boolean(v && v.trim()));

  return [
    "Design a professional social media poster for " + brief.brandName + ", a Malaysian motorcycle workshop.",
    orientation + " format, " + layout.width + " x " + layout.height + " pixels.",
    "",
    "ART DIRECTION",
    "- Premium automotive advertising. Bold and confident, generous negative space, nothing cluttered.",
    "- Background: deep charcoal-to-midnight-blue gradient with a subtle diagonal light sweep and faint technical grid lines.",
    "- A large warm amber-to-orange radial glow on " + layout.stageHint + ", reading as a staging light on a dark surface.",
    "- Thin orange accent rules and small geometric corner marks for a designed, editorial feel.",
    brief.mood ? "- Mood: " + brief.mood : "",
    "",
    "TYPOGRAPHY — render ONLY the text listed below.",
    "Use these exact words, spelled exactly as written. Do NOT add, translate, invent, repeat or embellish any other word anywhere in the image. No placeholder text, no lorem ipsum, no gibberish characters, no watermark.",
    ...textInstructions(brief),
    "Place all typography in " + layout.textZoneHint + ".",
    "",
    "CRITICAL — THE PRODUCT AREA MUST STAY EMPTY",
    "- Do NOT draw any bottle, can, jug, container, tube, product, packaging or object of any kind.",
    "- " + layout.stageHint.charAt(0).toUpperCase() + layout.stageHint.slice(1) + " must show only the background gradient and the staging glow — a completely clear area reserved for a product to be placed later.",
    "",
    "Quality: crisp legible kerning, correct spelling, sharp edges, no distortion.",
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
