import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describeColours, nameColour, summariseColours } from "@/modules/marketing/product-colours";
import { readProductColours } from "@/modules/marketing/product-colours-read";

describe("nameColour", () => {
  it("names the extremes the way a designer would", () => {
    expect(nameColour(0, 0, 0)).toBe("black");
    expect(nameColour(255, 255, 255)).toBe("white");
    expect(nameColour(200, 200, 200)).toBe("silver");
    expect(nameColour(60, 60, 60)).toBe("charcoal");
  });

  it("names the brand-relevant hues", () => {
    expect(nameColour(190, 20, 20)).toBe("red");
    expect(nameColour(120, 15, 15)).toBe("maroon");
    expect(nameColour(20, 30, 110)).toBe("navy");
    expect(nameColour(90, 140, 220)).toBe("blue");
    expect(nameColour(170, 205, 250)).toBe("light blue");
    expect(nameColour(230, 120, 20)).toBe("orange");
    expect(nameColour(240, 190, 40)).toBe("gold");
    expect(nameColour(20, 150, 100)).toBe("green");
    expect(nameColour(30, 170, 180)).toBe("teal");
  });

  it("always returns something, so the prompt never gets an empty word", () => {
    for (let r = 0; r <= 255; r += 51) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          expect(nameColour(r, g, b).length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("summariseColours", () => {
  const px = (colour: [number, number, number], n: number) =>
    Array.from({ length: n }, () => ({ r: colour[0], g: colour[1], b: colour[2] }));

  it("ranks by how much of the product each colour covers", () => {
    const out = summariseColours([...px([20, 30, 110], 60), ...px([190, 20, 20], 30), ...px([200, 200, 200], 10)]);
    expect(out[0]).toBe("navy");
    expect(out[1]).toBe("red");
  });

  it("drops colours that barely appear — a designer does not plan around a speck", () => {
    const out = summariseColours([...px([20, 30, 110], 95), ...px([240, 190, 40], 5)]);
    expect(out).toEqual(["navy"]);
  });

  it("caps the list so the prompt stays short", () => {
    const out = summariseColours(
      [...px([20, 30, 110], 25), ...px([190, 20, 20], 25), ...px([20, 150, 100], 25), ...px([240, 190, 40], 25)],
      { count: 2 },
    );
    expect(out).toHaveLength(2);
  });

  /**
   * A bottle that is mostly black with a red band should brief the model as "red". Black
   * carries no palette information — told "black and charcoal", a designer has nothing to
   * build a poster palette around.
   */
  it("prefers the colour that carries palette information", () => {
    const out = summariseColours([...px([10, 10, 12], 60), ...px([30, 30, 34], 25), ...px([150, 25, 30], 15)]);
    expect(out).toEqual(["red"]);
  });

  it("still reports neutrals when the product really is only neutral", () => {
    const out = summariseColours([...px([10, 10, 12], 70), ...px([200, 200, 200], 30)]);
    expect(out).toEqual(["black", "silver"]);
  });

  it("handles an empty product without throwing", () => {
    expect(summariseColours([])).toEqual([]);
  });

  it("never returns the canvas: fully transparent pixels are not passed in", () => {
    expect(summariseColours([{ r: 255, g: 255, b: 255 }])).toEqual(["white"]);
  });
});

describe("describeColours", () => {
  it("reads as a phrase in a sentence", () => {
    expect(describeColours(["navy"])).toBe("navy");
    expect(describeColours(["navy", "red"])).toBe("navy and red");
    expect(describeColours(["navy", "red", "silver"])).toBe("navy, red and silver");
  });

  it("is empty for no colours, so the prompt line can be dropped", () => {
    expect(describeColours([])).toBe("");
  });
});

/**
 * This module is imported by a client component, so a node-only import here does not just
 * bloat the bundle — it fails the build. That happened once with sharp, and tsc and
 * vitest both passed while next build failed, so the guard is a source check.
 */
describe("product-colours module boundary", () => {
  it("keeps node-only imports out of the module the browser loads", () => {
    const src = readFileSync(path.join(process.cwd(), "src/modules/marketing/product-colours.ts"), "utf8");
    expect(src).not.toMatch(/from "sharp"/);
    expect(src).not.toMatch(/require\(/);
    expect(src).not.toMatch(/node:/);
  });
});

describe("readProductColours", () => {
  /**
   * Runs against a real catalogue cut-out rather than a fixture: the point of this
   * function is to describe the packaging that will actually be composited, and a
   * synthetic image would not prove it copes with the real transparency.
   */
  it("reads the real E1300 packaging", async () => {
    const buf = readFileSync(path.join(process.cwd(), "public/products/E1300.webp"));
    const colours = await readProductColours(buf);
    expect(colours.length).toBeGreaterThan(0);
    expect(colours.length).toBeLessThanOrEqual(3);
    expect(colours.join(" ")).not.toMatch(/white/);
  });

  it("describes a different product differently", async () => {
    const a = await readProductColours(readFileSync(path.join(process.cwd(), "public/products/E1300.webp")));
    const b = await readProductColours(readFileSync(path.join(process.cwd(), "public/products/COOLANT-RED.webp")));
    expect(a.join(",")).not.toBe(b.join(","));
  });
});
