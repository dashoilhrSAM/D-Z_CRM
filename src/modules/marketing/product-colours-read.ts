// Reading the colours out of a product image.
//
// Kept apart from product-colours.ts on purpose: that module is imported by a client
// component, and importing sharp there pulls the native image library into the browser
// bundle and fails the build. Everything node-only about product colours lives here.
import sharp from "sharp";
import { summariseColours, type RGB } from "./product-colours";

/**
 * Read the covering colours of a product cut-out.
 *
 * Transparent pixels are skipped, so the answer describes the packaging rather than the
 * empty canvas around it. Downsampled to 64x64 first: colour is a low-frequency property
 * and the full-resolution image would cost a megabyte of scanning for the same answer.
 */
export async function readProductColours(buffer: Buffer, count = 3): Promise<string[]> {
  const { data, info } = await sharp(buffer)
    .resize(64, 64, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels: RGB[] = [];
  const channels = info.channels;
  for (let i = 0; i < data.length; i += channels) {
    const a = channels === 4 ? data[i + 3] : 255;
    if (a < 128) continue;
    pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  return summariseColours(pixels, { count });
}
