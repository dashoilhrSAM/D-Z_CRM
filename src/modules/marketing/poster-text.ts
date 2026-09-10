// Text rendering for posters, as SVG paths.
//
// Converted to vector paths rather than emitted as <text>, because a <text> element
// needs a font the renderer can find — and the runtime that produces these posters has
// none. See poster-fonts.ts for the three approaches that were tested and rejected.
//
// Everything here is pure: it takes a string and returns path data. No filesystem, no
// environment, no rendering. That makes the layout testable without producing an image.
import opentype from "opentype.js";
import { POSTER_FONT_BOLD_B64, POSTER_FONT_BODY_B64 } from "./poster-fonts";

export type FontWeight = "bold" | "body";

export interface TextBlock {
  text: string;
  /** Left edge (align left), centre line (align center), or right edge (align right). */
  x: number;
  /** Baseline of the FIRST line. */
  y: number;
  size: number;
  weight?: FontWeight;
  colour?: string;
  align?: "left" | "center" | "right";
  /** Wrap the text to this width. Without it the text stays on one line. */
  maxWidth?: number;
  /** Multiplier applied to size. Default 1.25. */
  lineHeight?: number;
  letterSpacing?: number;
  uppercase?: boolean;
  opacity?: number;
}

export interface RenderedText {
  /** SVG fragments, already safe to concatenate into an <svg>. */
  svg: string;
  /** Total height of the laid-out block, so a caller can stack blocks. */
  height: number;
  lines: string[];
}

function decode(b64: string): ArrayBuffer {
  const buf = Buffer.from(b64, "base64");
  // Buffer may point into a shared pool — slice to the exact bytes before parsing.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

let boldFont: opentype.Font | null = null;
let bodyFont: opentype.Font | null = null;

/** Parse on first use and cache — parsing a 19KB font per call would be wasteful. */
export function getFont(weight: FontWeight = "bold"): opentype.Font {
  if (weight === "body") {
    if (!bodyFont) bodyFont = opentype.parse(decode(POSTER_FONT_BODY_B64));
    return bodyFont;
  }
  if (!boldFont) boldFont = opentype.parse(decode(POSTER_FONT_BOLD_B64));
  return boldFont;
}

/** Escape text for use inside an SVG attribute or node. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Width of a single line, honouring letter spacing. */
export function measureText(text: string, font: opentype.Font, size: number, letterSpacing = 0): number {
  if (!text) return 0;
  const base = font.getAdvanceWidth(text, size);
  return base + letterSpacing * Math.max(0, text.length - 1);
}

/**
 * Greedy word wrap. Falls back to breaking a single over-long word by character so a
 * long product code can never overflow the poster.
 */
export function wrapText(text: string, font: opentype.Font, size: number, maxWidth: number, letterSpacing = 0): string[] {
  if (maxWidth <= 0) return [text];
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(""); continue; }
    let current = "";
    for (const word of words) {
      const candidate = current ? current + " " + word : word;
      if (measureText(candidate, font, size, letterSpacing) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (measureText(word, font, size, letterSpacing) <= maxWidth) {
        current = word;
        continue;
      }
      // single word too long — break it by character
      let chunk = "";
      for (const ch of word) {
        if (measureText(chunk + ch, font, size, letterSpacing) > maxWidth && chunk) { lines.push(chunk); chunk = ch; }
        else chunk += ch;
      }
      current = chunk;
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Render a text block as SVG <path> elements.
 *
 * Letter spacing is applied per glyph (advancing the pen between characters) rather than
 * via a text attribute, so spacing is exact and independent of any renderer.
 */
export function renderTextBlock(block: TextBlock): RenderedText {
  const font = getFont(block.weight ?? "bold");
  const size = Math.max(1, block.size);
  const colour = block.colour ?? "#ffffff";
  const align = block.align ?? "left";
  const lineHeight = (block.lineHeight ?? 1.25) * size;
  const spacing = block.letterSpacing ?? 0;
  const raw = block.uppercase ? block.text.toUpperCase() : block.text;
  const lines = block.maxWidth ? wrapText(raw, font, size, block.maxWidth, spacing) : raw.split("\n");

  const parts: string[] = [];
  if (block.opacity != null && block.opacity < 1) {
    parts.push('<g fill-opacity="' + block.opacity.toFixed(3) + '">');
  } else {
    parts.push("<g>");
  }

  let baseline = block.y;
  for (const line of lines) {
    if (line) {
      const width = measureText(line, font, size, spacing);
      let penX = block.x;
      if (align === "center") penX = block.x - width / 2;
      else if (align === "right") penX = block.x - width;
      for (const ch of line) {
        const path = font.getPath(ch, penX, baseline, size);
        parts.push('<path fill="' + esc(colour) + '" d="' + path.toPathData(2) + '"/>');
        penX += font.getAdvanceWidth(ch, size) + spacing;
      }
    }
    baseline += lineHeight;
  }
  parts.push("</g>");

  return { svg: parts.join(""), height: lines.length * lineHeight, lines };
}

/** Layout a stack of blocks, returning the SVG and the total height consumed. */
export function renderTextBlocks(blocks: TextBlock[]): { svg: string; height: number } {
  let svg = "";
  let lastBottom = 0;
  for (const b of blocks) {
    const r = renderTextBlock(b);
    svg += r.svg;
    lastBottom = Math.max(lastBottom, b.y + r.height);
  }
  return { svg, height: lastBottom };
}
