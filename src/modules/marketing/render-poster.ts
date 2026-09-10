// Render a finished poster for a selected script and store it.
//
// Split from the compositor so the expensive, failure-prone part (an image generation
// call) is a single unit that a route handler can time out and retry around.
import { db } from "@/lib/db";
import { storageProvider } from "@/providers";
import { composePoster, footerBlocks, type ProductPlacement } from "./poster";
import { generateBackground, sceneFor, SIZE_MAP, type PosterSizeKey } from "./images";
import type { ExpandedContent } from "./expand";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Load a catalogue cut-out from the public folder. */
function loadProductImage(imageUrl: string): Buffer {
  const rel = imageUrl.replace(/^\//, "");
  return readFileSync(path.join(process.cwd(), "public", rel));
}

export interface RenderResult {
  url: string;
  width: number;
  height: number;
  bytes: number;
  usedProduct: string | null;
  scene: string;
}

/**
 * Generate the background, composite the product and the text, store the PNG and record
 * its URL on the script. Throws on any failure — a poster that silently failed to render
 * would be indistinguishable from one that is still working.
 */
export async function renderScriptPoster(
  scriptId: string,
  opts?: { size?: PosterSizeKey; background?: Buffer },
): Promise<RenderResult> {
  const script = await db.contentScript.findUnique({ where: { id: scriptId } });
  if (!script) throw new Error("Script not found");
  const expanded = script.expandedJson as ExpandedContent | null;
  if (!expanded?.posterText) throw new Error("Script has not been expanded yet — expand it before rendering a poster");

  const size = opts?.size ?? "SQUARE";
  const dims = SIZE_MAP[size];
  const width = dims.width;
  const height = dims.height;

  const background = opts?.background ?? (await generateBackground({
    scene: expanded.posterScene || sceneFor({ kind: script.includeProduct ? "product" : "service", subject: script.angle }),
    size,
  })).buffer;

  // product, only when the script actually calls for one
  const products: ProductPlacement[] = [];
  let usedProduct: string | null = null;
  if (script.includeProduct && script.productSku) {
    const p = await db.promoProduct.findUnique({ where: { sku: script.productSku } });
    if (p?.imageUrl) {
      products.push({ buffer: loadProductImage(p.imageUrl), sku: p.sku, heightRatio: 0.48, centerX: 0.76, bottomY: 0.70 });
      usedProduct = p.sku;
    }
  }

  const org = await db.organisation.findFirst();
  const scale = width / 1080;
  const pt = expanded.posterText;

  const blocks = [
    { text: pt.headline || script.title, x: Math.round(70 * scale), y: Math.round(190 * scale), size: Math.round(90 * scale), weight: "bold" as const, colour: "#ffffff", maxWidth: Math.round(width * 0.72) },
    ...(pt.sub ? [{ text: pt.sub, x: Math.round(70 * scale), y: Math.round(280 * scale), size: Math.round(40 * scale), weight: "body" as const, colour: "#ffd166", maxWidth: Math.round(width * 0.66) }] : []),
    ...(pt.productLine ? [{ text: pt.productLine, x: Math.round(70 * scale), y: Math.round(830 * scale), size: Math.round(44 * scale), weight: "bold" as const, colour: "#ffffff", maxWidth: Math.round(width * 0.6) }] : []),
    ...(pt.specsLine ? [{ text: pt.specsLine, x: Math.round(70 * scale), y: Math.round(886 * scale), size: Math.round(30 * scale), weight: "body" as const, colour: "#7ee787", maxWidth: Math.round(width * 0.6) }] : []),
    ...footerBlocks({ width, height, name: org?.name ?? "D&Z Smart Workshop", phone: org?.contactPhone ?? null, tagline: "Walk-in welcome", accent: "#ffd166" }),
  ];

  const png = await composePoster({
    width, height, background, products,
    scrims: [
      { x: 0, y: 0, width: 1, height: 0.44, from: "#000000", to: "#000000", opacity: 0.55 },
      { x: 0, y: 0.66, width: 1, height: 0.34, from: "#000000", to: "#000000", opacity: 0.68 },
    ],
    backgroundDarken: 0.12,
    blocks,
  });

  const key = "content-posters/" + script.id + "-" + Date.now().toString(36) + ".png";
  const url = await storageProvider.put(key, new Uint8Array(png), "image/png");
  await db.contentScript.update({ where: { id: script.id }, data: { posterUrl: url, posterRenderedAt: new Date() } });

  return { url, width, height, bytes: png.length, usedProduct, scene: expanded.posterScene };
}
