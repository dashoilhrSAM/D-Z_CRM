// Poster compositor.
//
// Three layers, composited in this order and for this reason:
//
//   1. AI background  — the scene, generated with no text and no product in it.
//   2. Real product   — the actual transparent cut-out from the catalogue, placed by us.
//   3. Vector text    — drawn as SVG paths so it renders identically everywhere.
//
// Layer 2 is the point of the whole design: the bottle the customer sees is the real
// product with its real label, not a model's impression of one.
import sharp from "sharp";
import type { OverlayOptions } from "sharp";
import { renderTextBlocks, type TextBlock } from "./poster-text";

export interface ProductPlacement {
  buffer: Buffer;
  sku: string;
  /** Height as a fraction of the canvas height. Default 0.46. */
  heightRatio?: number;
  /** Horizontal centre as a fraction of canvas width. Default 0.72. */
  centerX?: number;
  /** Baseline (bottom of the product) as a fraction of canvas height. Default 0.82. */
  bottomY?: number;
  /** Soft shadow under the product. Default true. */
  shadow?: boolean;
  /**
   * Brightness multiplier applied to the product, 0-2. Default 0.94.
   *
   * A catalogue cut-out is lit for a white studio; a generated background is usually much
   * dimmer. Dropped in unchanged, the product reads as pasted on because it is physically
   * brighter than everything around it. Pulling it down a little lets it sit in the scene
   * instead of floating above it.
   */
  brightness?: number;
  /** Saturation multiplier, 0-2. Default 0.96. */
  saturation?: number;
}

/**
 * The branding footer every poster needs.
 *
 * Without it a poster is an anonymous image — the viewer learns nothing about who made
 * it or how to act on it. Kept as a helper so the layout stays identical across every
 * generated poster instead of being re-invented per piece.
 */
export function footerBlocks(opts: {
  width: number;
  height: number;
  name: string;
  phone?: string | null;
  tagline?: string | null;
  accent?: string;
}): TextBlock[] {
  const { width, height } = opts;
  const padX = Math.round(width * 0.065);
  const baseY = Math.round(height * 0.945);
  const blocks: TextBlock[] = [
    {
      text: opts.name,
      x: padX,
      y: baseY,
      size: Math.round(width * 0.030),
      weight: "bold",
      colour: opts.accent ?? "#ffffff",
      maxWidth: Math.round(width * 0.7),
    },
  ];
  const contact = [opts.phone, opts.tagline].filter(Boolean).join("  ·  ");
  if (contact) {
    blocks.push({
      text: contact,
      x: padX,
      y: baseY + Math.round(width * 0.030 * 1.15),
      size: Math.round(width * 0.021),
      weight: "body",
      colour: "#ffffff",
      opacity: 0.78,
      maxWidth: Math.round(width * 0.7),
    });
  }
  return blocks;
}

export interface PosterSpec {
  width: number;
  height: number;
  background: Buffer;
  products?: ProductPlacement[];
  blocks: TextBlock[];
  /** Darkening scrims to keep text legible over a busy background. */
  scrims?: { x: number; y: number; width: number; height: number; from: string; to: string; opacity?: number }[];
  /** Overall darkening of the background, 0-1. Default 0.18. */
  backgroundDarken?: number;
}

/** Clamp a fraction into canvas bounds and return integer pixels. */
export function px(ratio: number, total: number): number {
  return Math.max(0, Math.min(total, Math.round(ratio * total)));
}

/**
 * Size a product so its height matches the requested fraction, preserving aspect, and
 * grade it so it sits in the scene rather than on top of it.
 */
export async function fitProduct(
  buffer: Buffer,
  targetHeight: number,
  grade?: { brightness?: number; saturation?: number },
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const meta = await sharp(buffer).metadata();
  const srcW = meta.width ?? 1;
  const srcH = meta.height ?? 1;
  const height = Math.max(1, Math.round(targetHeight));
  const width = Math.max(1, Math.round((srcW / srcH) * height));
  const out = await sharp(buffer)
    .resize({ width, height, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .modulate({ brightness: grade?.brightness ?? 0.94, saturation: grade?.saturation ?? 0.96 })
    .png()
    .toBuffer();
  return { buffer: out, width, height };
}

/**
 * A soft contact shadow so the product sits ON the surface instead of floating above it.
 *
 * Built by drawing a solid ellipse and blurring it with sharp rather than by faking a
 * gradient: a gradient ellipse reads as a flat grey blob, while a blurred ellipse has the
 * soft falloff that makes an object look placed. Returns the image plus the offsets the
 * caller needs to position it.
 */
export async function buildShadow(
  productWidth: number,
  productHeight: number,
): Promise<{ buffer: Buffer; width: number; height: number; offsetX: number; offsetY: number }> {
  const w = Math.max(24, Math.round(productWidth * 1.15));
  const h = Math.max(8, Math.round(productHeight * 0.075));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
    '<ellipse cx="' + w / 2 + '" cy="' + h / 2 + '" rx="' + (w / 2) * 0.92 + '" ry="' + (h / 2) * 0.86 + '" fill="#000000" fill-opacity="0.72"/></svg>';
  const buffer = await sharp(Buffer.from(svg)).blur(Math.max(2, Math.round(h * 0.35))).png().toBuffer();
  return { buffer, width: w, height: h, offsetX: Math.round((w - productWidth) / 2), offsetY: Math.round(h * 0.42) };
}

/** Compose the poster and return a PNG buffer. */
export async function composePoster(spec: PosterSpec): Promise<Buffer> {
  const { width, height } = spec;

  // 1. background, cropped to the exact canvas
  const base = await sharp(spec.background)
    .resize(width, height, { fit: "cover", position: "centre" })
    .toBuffer();

  const layers: OverlayOptions[] = [];

  // 2. scrims, so text never fights the background
  for (const s of spec.scrims ?? []) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + s.from + '" stop-opacity="' + (s.opacity ?? 1) + '"/>' +
      '<stop offset="100%" stop-color="' + s.to + '" stop-opacity="' + (s.opacity ?? 1) + '"/>' +
      '</linearGradient></defs>' +
      '<rect x="' + px(s.x, width) + '" y="' + px(s.y, height) + '" width="' + px(s.width, width) + '" height="' + px(s.height, height) + '" fill="url(#g)"/>' +
      '</svg>';
    layers.push({ input: Buffer.from(svg), top: 0, left: 0 });
  }

  // 3. products, with a shadow beneath each
  for (const p of spec.products ?? []) {
    const targetH = px(p.heightRatio ?? 0.46, height);
    const fitted = await fitProduct(p.buffer, targetH, { brightness: p.brightness, saturation: p.saturation });
    const cx = px(p.centerX ?? 0.72, width);
    const bottom = px(p.bottomY ?? 0.82, height);
    const top = Math.max(0, bottom - fitted.height);
    const left = Math.max(0, Math.min(width - fitted.width, cx - Math.round(fitted.width / 2)));

    if (p.shadow !== false) {
      const sh = await buildShadow(fitted.width, fitted.height);
      // Anchor the shadow to the product's base, centred on the same axis.
      const shLeft = Math.max(0, Math.min(width - sh.width, cx - Math.round(sh.width / 2)));
      const shTop = Math.max(0, Math.min(height - sh.height, bottom - sh.offsetY));
      layers.push({ input: sh.buffer, top: shTop, left: shLeft });
    }
    layers.push({ input: fitted.buffer, top, left });
  }

  // 4. text, as vector paths
  const { svg } = renderTextBlocks(spec.blocks);
  if (svg) {
    layers.push({ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' + svg + "</svg>"), top: 0, left: 0 });
  }

  const darken = spec.backgroundDarken ?? 0.18;
  let pipeline = sharp(base);
  if (darken > 0) {
    pipeline = pipeline.composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><rect width="' + width + '" height="' + height + '" fill="#000000" fill-opacity="' + darken + '"/></svg>'), top: 0, left: 0 }]);
  }
  return pipeline.composite(layers).png().toBuffer();
}
