// Making a studio photograph belong in a flat printed poster.
//
// WHY THIS EXISTS (measured, not assumed)
// --------------------------------------
// The catalogue cut-outs are photographed on white. Dropped into a flat illustrated
// poster they read as pasted on, and three separate critiques said the same thing: "the
// realistic product photo clashes with the illustrated background". Lighting was already
// matched (poster-grade.ts) and that was not enough, because the mismatch is not how
// bright the bottle is — it is that it is a photograph at all.
//
// Two cheaper fixes were tried first and measured:
//   - an ink outline around the cut-out: REJECTED. Two critiques said it made the bottle
//     look more pasted on, not less.
//   - a photographic window for it to stand in: KEPT, but on its own it still reads as a
//     photo in a box.
//
// So the photograph itself is treated: tonal range flattened, contrast pushed, and a
// print dot texture laid over it. The result is screen-printed rather than photographic,
// which is what lets it sit inside flat shapes.
//
// THE CONSTRAINT THAT SETS THE STRENGTH
// -------------------------------------
// The label belongs to the brand. This treatment must not become a repaint, so it is
// graded rather than absolute: the spec keeps more tonal steps than a true two-colour
// posterize and the dot texture stays faint. The tonal-range test below is what keeps it
// honest — if the label stops being readable, the treatment is too strong.
import sharp from "sharp";

export interface PrintTreatment {
  /** Posterise levels per channel. Fewer levels = flatter and more print-like. */
  levels: number;
  /** Contrast multiplier applied before posterising, to keep flattening from going muddy. */
  contrast: number;
  /** Saturation multiplier. Print inks read a little richer than the studio shot. */
  saturation: number;
  /** Halftone dot pitch in pixels, or 0 for no dot texture. */
  dotPitch: number;
  /** Halftone opacity, 0-1. Faint on purpose. */
  dotOpacity: number;
  /** Why these numbers, for the render log. */
  reason: string;
}

/**
 * The treatment an art direction calls for.
 *
 * Photographic styles get none: a cinematic hero shot is built on the realism of the
 * photograph, and flattening it would destroy the one thing that style has.
 */
export function treatmentFor(medium: "graphic" | "photo", productHeight: number): PrintTreatment | null {
  if (medium === "photo") return null;
  return PRINT_TREATMENT(productHeight);
}

/**
 * Exported so the numbers are reviewable in one place.
 *
 * Six levels rather than the three of a true poster: at three the small type on a label
 * stops being legible, and dissolving a brand label is not ours to do.
 */
export function PRINT_TREATMENT(productHeight: number): PrintTreatment {
  // Dot pitch tracks the rendered size, so a small product does not get a coarse and
  // obvious grid while a large one gets an invisible one.
  const pitch = Math.max(4, Math.min(14, Math.round(productHeight / 46)));
  return {
    levels: 6,
    contrast: 1.12,
    saturation: 1.06,
    dotPitch: pitch,
    dotOpacity: 0.14,
    reason:
      "posterise 6 levels, contrast 1.12, print dots at " + pitch + "px (faint) — enough to read as print, gentle enough to keep the label",
  };
}

/**
 * Snap one channel value to the nearest of N evenly spaced levels.
 *
 * Written by hand because sharp has no posterize op (checked: sharp 0.35 exposes no such
 * method). Doing it here rather than pulling in another library also makes the step
 * testable — one value in, one value out.
 */
export function quantiseChannel(v: number, levels: number): number {
  const clamped = Math.max(0, Math.min(255, v));
  const step = 255 / (Math.max(2, levels) - 1);
  return Math.round(Math.round(clamped / step) * step);
}

/** Quantise every colour channel in place, leaving alpha untouched. */
export function quantiseInPlace(data: Buffer, channels: number, levels: number): void {
  for (let i = 0; i < data.length; i += channels) {
    data[i] = quantiseChannel(data[i], levels);
    if (channels >= 3) {
      data[i + 1] = quantiseChannel(data[i + 1], levels);
      data[i + 2] = quantiseChannel(data[i + 2], levels);
    }
  }
}

/** Apply the treatment. Returns a PNG buffer with the alpha channel preserved. */
export async function applyPrint(buffer: Buffer, t: PrintTreatment): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  const width = meta.width ?? 1;
  const height = meta.height ?? 1;

  // linear() pivots the contrast around mid grey: multiplying without an offset would
  // simply brighten the image instead of expanding its tonal range.
  const a = t.contrast;
  const b = -(128 * (a - 1));
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .linear([a, a, a], [b, b, b])
    .modulate({ saturation: t.saturation })
    .raw()
    .toBuffer({ resolveWithObject: true });

  quantiseInPlace(data, info.channels, t.levels);

  let pipeline = sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels as 4 },
  }).png();

  if (t.dotPitch > 0 && t.dotOpacity > 0) {
    // The dots are built from the original cut-out so the mask is the product itself, not
    // the posterised copy of it.
    const texture = await printDots(buffer, width, height, t.dotPitch, t.dotOpacity);
    if (texture) {
      const flattened = await pipeline.toBuffer();
      pipeline = sharp(flattened).composite([{ input: texture, top: 0, left: 0 }]).png();
    }
  }

  return pipeline.toBuffer();
}

/**
 * A faint dot grid, masked to the shape of the product.
 *
 * The mask is applied by multiplying the two alpha channels by hand rather than with a
 * composite blend mode. The first version of this used joinChannel alone and produced a
 * solid black silhouette: removing the alpha from a mostly transparent dot grid leaves a
 * fully opaque black canvas, which then covered the product completely. Reading both
 * alphas and multiplying them is one line of arithmetic and cannot do that.
 */
async function printDots(
  product: Buffer,
  width: number,
  height: number,
  pitch: number,
  opacity: number,
): Promise<Buffer | null> {
  if (width < pitch * 2 || height < pitch * 2) return null;

  const dots: string[] = [];
  const r = pitch * 0.28;
  for (let y = pitch / 2; y < height; y += pitch) {
    // Offset every other row, the way a real halftone screen is angled.
    const offset = (Math.round(y / pitch) % 2) * (pitch / 2);
    for (let x = pitch / 2 + offset; x < width; x += pitch) {
      dots.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(2) + '"/>');
    }
  }
  if (dots.length === 0) return null;

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
    '<g fill="#000000" fill-opacity="' + opacity + '">' + dots.join("") + "</g></svg>";

  const { data: dotData } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data: alphaData } = await sharp(product).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  if (alphaData.length !== width * height) return null;

  for (let px = 0; px < width * height; px++) {
    const combined = dotData[px * 4 + 3] * (alphaData[px] / 255);
    dotData[px * 4 + 3] = Math.round(Math.max(0, Math.min(255, combined)));
  }

  return sharp(dotData, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/**
 * The spread between the darkest and lightest tone on a product, ignoring transparent
 * pixels.
 *
 * The measure that keeps the treatment honest: if posterising has collapsed the label
 * into one flat tone the label is gone, however good the bottle looks at a glance.
 */
export function tonalRange(buffer: { data: Buffer; channels: number }): number {
  let min = 255;
  let max = 0;
  const { data, channels } = buffer;
  for (let i = 0; i < data.length; i += channels) {
    const a = channels === 4 ? data[i + 3] : 255;
    if (a < 128) continue;
    const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (luma < min) min = luma;
    if (luma > max) max = luma;
  }
  return max - min;
}
