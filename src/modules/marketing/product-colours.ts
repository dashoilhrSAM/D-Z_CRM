// Reading the colours of a product cut-out so the poster can be designed around them.
//
// THE PROBLEM THIS SOLVES
// -----------------------
// The product is a photograph of real packaging. Its colours are fixed — we will not
// recolour a brand's label to make a poster look tidy. So when a critique says "the
// bottle's dark red/blue label clashes with the illustration's teal-orange-brown
// palette", the palette is the thing that should move, not the label.
//
// Which means the model needs to know what it is designing around. Rather than asking a
// model to describe the bottle (it might invent), the colours are read off the actual
// cut-out and named here.
//
// Naming rather than sending raw RGB is deliberate: an image model composes with colour
// words far more reliably than with hex triplets scattered through a paragraph.

export interface RGB {
  r: number;
  g: number;
  b: number;
}

function hue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Name an 8-bit colour the way a designer would describe it out loud. */
export function nameColour(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const light = (max + min) / 2;
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));

  if (light <= 0.12) return "black";
  if (light >= 0.93 && sat <= 0.12) return "white";
  if (sat <= 0.12) return light <= 0.35 ? "charcoal" : light >= 0.72 ? "silver" : "grey";

  const h = hue(r, g, b);
  const dark = light <= 0.28;
  const pale = light >= 0.78;
  let base: string;
  if (h < 16 || h >= 345) base = dark ? "maroon" : "red";
  else if (h < 45) base = dark ? "rust" : "orange";
  else if (h < 70) base = "gold";
  else if (h < 160) base = dark ? "dark green" : "green";
  else if (h < 200) base = pale ? "light teal" : "teal";
  else if (h < 255) base = dark ? "navy" : pale ? "light blue" : "blue";
  else if (h < 290) base = "purple";
  else base = "magenta";
  return base;
}

/**
 * The colours that actually cover the product, most-covering first.
 *
 * Pure, so the ranking can be tested without an image. Bins by hue family with a coarse
 * cube so two shades of the same colour count as one, which is what a designer means by
 * "the bottle is blue".
 */
export function summariseColours(pixels: RGB[], opts?: { minShare?: number; count?: number }): string[] {
  const minShare = opts?.minShare ?? 0.12;
  const count = opts?.count ?? 3;
  if (pixels.length === 0) return [];

  const bins = new Map<string, number>();
  for (const p of pixels) {
    const name = nameColour(p.r, p.g, p.b);
    bins.set(name, (bins.get(name) ?? 0) + 1);
  }

  const ranked = [...bins.entries()]
    .map(([name, n]) => ({ name, share: n / pixels.length }))
    .filter((e) => e.share >= minShare);

  // "Black and charcoal" tells a designer nothing about how to colour a poster, so when a
  // product has any chromatic colour at all, the neutrals are dropped and that colour is
  // what the palette is built around. A product that really is only black still reports
  // black, because then it is the honest answer.
  const chromatic = ranked.filter((e) => !NEUTRAL_NAMES.has(e.name));
  const chosen = chromatic.length > 0 ? chromatic : ranked;

  return chosen
    .sort((a, b) => b.share - a.share)
    .slice(0, count)
    .map((e) => e.name);
}

/** Colour names that carry no palette information. */
const NEUTRAL_NAMES = new Set(["black", "charcoal", "grey", "silver", "white"]);

// NOTE: reading the colours out of an image lives in product-colours-read.ts, not here.
// This module is imported by the Content Studio client component (for the style picker),
// and a sharp import here drags the native image library into the browser bundle and
// breaks the build. Keep this file free of node-only imports.

/** Turn a colour list into a phrase for a prompt. */
export function describeColours(colours: string[]): string {
  if (colours.length === 0) return "";
  if (colours.length === 1) return colours[0];
  return colours.slice(0, -1).join(", ") + " and " + colours[colours.length - 1];
}
