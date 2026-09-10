import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  PRINT_TREATMENT,
  applyPrint,
  quantiseChannel,
  quantiseInPlace,
  tonalRange,
  treatmentFor,
} from "@/modules/marketing/poster-print";

const productPath = (sku: string) => path.join(process.cwd(), "public/products", sku + ".webp");

async function opaqueStats(buf: Buffer) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = 0;
  let lumaSum = 0;
  const values = new Set<number>();
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 128) continue;
    opaque++;
    lumaSum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    values.add(data[i]);
  }
  return { opaque, meanLuma: opaque ? lumaSum / opaque : 0, values };
}

describe("quantiseChannel", () => {
  it("snaps to the nearest level", () => {
    // Six levels sit 51 apart: 0, 51, 102, 153, 204, 255.
    expect(quantiseChannel(0, 6)).toBe(0);
    expect(quantiseChannel(20, 6)).toBe(0);
    expect(quantiseChannel(40, 6)).toBe(51);
    expect(quantiseChannel(255, 6)).toBe(255);
    expect(quantiseChannel(130, 6)).toBe(153);
  });

  it("clamps instead of wrapping", () => {
    expect(quantiseChannel(-40, 6)).toBe(0);
    expect(quantiseChannel(900, 6)).toBe(255);
  });

  it("is a no-op at two levels only for the extremes", () => {
    expect(quantiseChannel(0, 2)).toBe(0);
    expect(quantiseChannel(255, 2)).toBe(255);
    expect(quantiseChannel(100, 2)).toBe(0);
    expect(quantiseChannel(200, 2)).toBe(255);
  });
});

describe("quantiseInPlace", () => {
  it("never touches the alpha channel", () => {
    const buf = Buffer.from([10, 20, 30, 7, 200, 210, 220, 199]);
    quantiseInPlace(buf, 4, 6);
    expect(buf[3]).toBe(7);
    expect(buf[7]).toBe(199);
  });

  it("lands every colour channel on the level grid", () => {
    const buf = Buffer.from([13, 47, 99, 255, 201, 88, 3, 255]);
    quantiseInPlace(buf, 4, 6);
    for (const i of [0, 1, 2, 4, 5, 6]) {
      expect(buf[i] % 51).toBe(0);
    }
  });
});

describe("treatmentFor", () => {
  it("treats flat art directions and leaves photographic ones alone", () => {
    expect(treatmentFor("graphic", 560)).not.toBeNull();
    // A cinematic hero shot is built on the realism of the photograph; flattening it
    // would destroy the only thing that direction has.
    expect(treatmentFor("photo", 560)).toBeNull();
  });

  it("scales the dot pitch with the rendered size", () => {
    const small = treatmentFor("graphic", 200);
    const large = treatmentFor("graphic", 2000);
    expect(large!.dotPitch).toBeGreaterThan(small!.dotPitch);
    expect(small!.dotPitch).toBeGreaterThanOrEqual(4);
    expect(large!.dotPitch).toBeLessThanOrEqual(14);
  });

  it("keeps enough levels for the small type on a label to survive", () => {
    expect(PRINT_TREATMENT(560).levels).toBeGreaterThanOrEqual(5);
  });
});

describe("tonalRange", () => {
  it("ignores transparent pixels", () => {
    // One opaque mid grey, one transparent white: the white must not count.
    const data = Buffer.from([128, 128, 128, 255, 255, 255, 255, 0]);
    expect(tonalRange({ data, channels: 4 })).toBe(0);
  });

  it("measures the spread between darkest and lightest", () => {
    const data = Buffer.from([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(tonalRange({ data, channels: 4 })).toBeCloseTo(255, 0);
  });
});

describe("applyPrint", () => {
  const run = async (sku = "E1300") => {
    const src = readFileSync(productPath(sku));
    const before = await sharp(src).ensureAlpha().png().toBuffer();
    const after = await applyPrint(src, PRINT_TREATMENT(560));
    return { before, after };
  };

  /**
   * The regression this guards is real and shipped once: the dot layer was opaque
   * everywhere, so every treated product came out as a solid black silhouette with the
   * label completely gone. Nothing about the code looked wrong — only the image did.
   */
  it("does not cover the product in black", async () => {
    const { before, after } = await run();
    const b = await opaqueStats(before);
    const a = await opaqueStats(after);
    expect(a.meanLuma).toBeGreaterThan(40);
    expect(a.meanLuma).toBeLessThan(240);
    expect(Math.abs(a.meanLuma - b.meanLuma)).toBeLessThan(70);
  });

  it("keeps the shape of the cut-out", async () => {
    const { before, after } = await run();
    const b = await opaqueStats(before);
    const a = await opaqueStats(after);
    expect(a.opaque).toBeGreaterThan(b.opaque * 0.98);
    expect(a.opaque).toBeLessThan(b.opaque * 1.02);
  });

  it("keeps enough tonal separation for a label to stay readable", async () => {
    const { after } = await run();
    const { data, info } = await sharp(after).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(tonalRange({ data, channels: info.channels })).toBeGreaterThan(120);
  });

  it("actually flattens the tones, rather than being a no-op", async () => {
    const { before, after } = await run();
    const b = await opaqueStats(before);
    const a = await opaqueStats(after);
    // Posterising collapses the number of distinct red-channel values by a large factor.
    expect(a.values.size).toBeLessThan(b.values.size * 0.5);
  });

  it("preserves the canvas size", async () => {
    const { before, after } = await run();
    const b = await sharp(before).metadata();
    const a = await sharp(after).metadata();
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
  });
});
