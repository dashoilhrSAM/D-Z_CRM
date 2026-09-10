// Render a finished poster for a selected script and store it.
//
// The model designs the poster — typography, layout, graphic language — and this module
// adds the one thing it must not invent: the real product. The staged area it is told to
// leave empty and the coordinates used to composite the bottle come from the same
// POSTER_LAYOUTS entry, so they cannot drift apart.
import { db } from "@/lib/db";
import { storageProvider } from "@/providers";
import { composePoster, type ProductPlacement } from "./poster";
import { generateFromPrompt, SIZE_MAP, type PosterSizeKey } from "./images";
import { POSTER_LAYOUTS, buildDesignPrompt, type DesignBrief } from "./poster-design";
import { verifyPosterText, type VerificationResult } from "./poster-verify";
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
  /** The exact prompt the artwork was generated from, for review and reuse. */
  prompt: string;
  /** Summary of the words the poster was instructed to contain. */
  expectedText: string[];
  /** Read-back check of the rendered poster. */
  verification: VerificationResult;
  /** True when a second attempt was generated because the first had missing words. */
  retried: boolean;
}

/**
 * Turn expanded content into a design brief.
 *
 * Pure and exported so the mapping from script to poster text can be reviewed and tested
 * without generating an image.
 */
export function briefFrom(expanded: ExpandedContent, opts: {
  size: PosterSizeKey;
  brandName: string;
  badge?: string | null;
}): DesignBrief {
  const pt = expanded.posterText;
  // The caption line carries the product identity, which is what a buyer needs to match
  // the bottle on the shelf. Spec line preferred when both exist.
  const caption = [pt.productLine, pt.specsLine].filter(Boolean).join(" · ") || null;
  return {
    size: opts.size,
    brandName: opts.brandName,
    badge: opts.badge ?? null,
    headline: pt.headline,
    sub: pt.sub ?? null,
    caption,
    cta: pt.cta ?? null,
  };
}

/**
 * Generate a designed poster and store it. Throws on any failure — a poster that
 * silently failed would be indistinguishable from one still rendering.
 */
export async function renderScriptPoster(
  scriptId: string,
  opts?: { size?: PosterSizeKey },
): Promise<RenderResult> {
  const script = await db.contentScript.findUnique({ where: { id: scriptId } });
  if (!script) throw new Error("Script not found");
  const expanded = script.expandedJson as ExpandedContent | null;
  if (!expanded?.posterText) throw new Error("Script has not been expanded yet — expand it before rendering a poster");

  const size = opts?.size ?? "SQUARE";
  const layout = POSTER_LAYOUTS[size];
  const dims = SIZE_MAP[size];

  const product = script.includeProduct && script.productSku
    ? await db.promoProduct.findUnique({ where: { sku: script.productSku } })
    : null;
  const org = await db.organisation.findFirst();
  const brandName = org?.name ?? "D&Z Smart Workshop";

  // The occasion makes a good badge — "PROMO CUTI" is more useful than a blank corner.
  let badge: string | null = null;
  if (script.occasionKey) {
    const occ = await db.occasion.findUnique({ where: { key: script.occasionKey }, select: { name: true } });
    if (occ) badge = occ.name;
  }

  const brief = briefFrom(expanded, { size, brandName, badge });
  const prompt = buildDesignPrompt(brief);

  const artwork = await generateFromPrompt(prompt, size);

  // Only the product is composited — the model already placed the typography.
  const products: ProductPlacement[] = [];
  let usedProduct: string | null = null;
  if (product?.imageUrl) {
    products.push({
      buffer: loadProductImage(product.imageUrl),
      sku: product.sku,
      heightRatio: layout.stage.heightRatio,
      centerX: layout.stage.centerX,
      bottomY: layout.stage.bottomY,
    });
    usedProduct = product.sku;
  }

  const compose = (bg: Buffer) => composePoster({
    width: dims.width,
    height: dims.height,
    background: bg,
    products,
    blocks: [],
    backgroundDarken: 0,
  });

  const expectedText = [brief.headline, brief.sub, brief.caption, brief.brandName, brief.cta, brief.badge]
    .filter((v): v is string => Boolean(v));

  let png = await compose(artwork.buffer);

  // Read the poster back. The model wrote the typography, so a misspelling is possible in
  // a way it never was when we drew the text ourselves; one retry is cheap next to
  // publishing a poster with a wrong word on it.
  let verification = await verifyPosterText(png, expectedText);
  let retried = false;
  if (!verification.ok && !verification.readError) {
    retried = true;
    const second = await generateFromPrompt(prompt, size);
    const secondPng = await compose(second.buffer);
    const secondCheck = await verifyPosterText(secondPng, expectedText);
    if (secondCheck.missing.length < verification.missing.length) {
      png = secondPng;
      verification = secondCheck;
    }
  }

  const key = "content-posters/" + script.id + "-" + Date.now().toString(36) + ".png";
  const url = await storageProvider.put(key, new Uint8Array(png), "image/png");
  await db.contentScript.update({ where: { id: script.id }, data: { posterUrl: url, posterRenderedAt: new Date() } });

  return {
    url,
    width: dims.width,
    height: dims.height,
    bytes: png.length,
    usedProduct,
    prompt,
    expectedText,
    verification,
    retried,
  };
}
