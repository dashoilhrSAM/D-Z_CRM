// Matching a studio cut-out to the artwork it is dropped into.
//
// THE PROBLEM THIS SOLVES
// -----------------------
// The catalogue cut-outs are lit for a white studio. The artwork is not. Dropped in
// unchanged the bottle is the brightest thing on the poster and reads as pasted on — a
// critique of the first graphic poster said exactly that: "the lighting on the bottle
// doesn't match ... creating a disjointed feel".
//
// A single fixed darkening cannot fix it, because how much correction is needed depends
// on how bright THIS poster is. So the correction is measured: the poster's reserved stage
// is sampled and the product is nudged toward that ambient light — brightness and colour
// cast.
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO
// ----------------------------------------
// 1. It does not match the product fully to the stage. The product is the brand's own
//    packaging; a full match would repaint its label. Every constant here is a fraction
//    of the way, and the clamps are tight enough that the grade can only ever nudge.
// 2. It does not outline the cut-out. Giving a photographic cut-out an ink outline was
//    measured and rejected: two independent critiques said the outline "creates a sharp
//    visual separation ... making it look like a distinct, pasted-on element" — the exact
//    failure it was meant to cure. Real product composites are seated with light and
//    shadow, not with a drawn border.

export interface ColourSample {
  /** Channel means, 0-255. */
  r: number;
  g: number;
  b: number;
  /** Rec.709 relative luma, 0-1. */
  luma: number;
}

/** Rec.709 luma of an 8-bit RGB triplet, normalised to 0-1. */
export function lumaOf(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function sampleFromMean(r: number, g: number, b: number): ColourSample {
  return { r, g, b, luma: lumaOf(r, g, b) };
}

/**
 * Luma of the lighting a catalogue cut-out was shot under.
 *
 * The product images are studio shots on white, so this is what "already matches" looks
 * like: a poster whose stage sits at this brightness needs no correction at all.
 */
export const STUDIO_LUMA = 0.82;

/** How far toward the poster's ambient brightness we are willing to move the product. */
export const LUMA_STRENGTH = 0.5;

/** How far toward the poster's colour cast we are willing to move the product. */
export const TEMPERATURE_STRENGTH = 0.22;

/**
 * Tight on purpose. These bounds are what make the grade a nudge rather than a repaint:
 * the product can move about a tenth of the way, and never further.
 */
export const MAX_BRIGHTNESS = 1.1;
export const MIN_BRIGHTNESS = 0.9;
export const MAX_CHANNEL = 1.06;
export const MIN_CHANNEL = 0.94;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface ProductGrade {
  /** sharp modulate() brightness multiplier. */
  brightness: number;
  /** sharp modulate() saturation multiplier. */
  saturation: number;
  /** sharp linear() per-channel multipliers, matching the ambient colour cast. */
  channel: [number, number, number];
  /** Human-readable reason, surfaced so a bad poster can be explained. */
  reason: string;
}

/**
 * Grade a product cut-out for the poster it is being placed on.
 *
 * Pure, so the numbers can be reviewed and tested without generating an image.
 */
export function matchGrade(stage: ColourSample): ProductGrade {
  const brightness = clamp(
    1 + (stage.luma / STUDIO_LUMA - 1) * LUMA_STRENGTH,
    MIN_BRIGHTNESS,
    MAX_BRIGHTNESS,
  );
  const saturation = 0.98;

  // The colour cast is compared as a cast, not as raw channels: a dark bottle on a cream
  // stage has very different channel means but no meaningful temperature difference.
  // Normalising each channel by its own luma isolates the cast the light actually has.
  const luma255 = Math.max(1, stage.luma * 255);
  // No +1 fudge on the numerator: it would bias every neutral stage slightly warm.
  const channel = ([stage.r, stage.g, stage.b] as const).map((c) =>
    clamp(1 + (c / luma255 - 1) * TEMPERATURE_STRENGTH, MIN_CHANNEL, MAX_CHANNEL),
  ) as unknown as [number, number, number];

  const reason =
    "stage luma " + stage.luma.toFixed(3) +
    " vs studio " + STUDIO_LUMA.toFixed(2) +
    " -> brightness " + brightness.toFixed(3) +
    ", cast " + channel.map((c) => c.toFixed(3)).join("/");

  return { brightness, saturation, channel, reason };
}
