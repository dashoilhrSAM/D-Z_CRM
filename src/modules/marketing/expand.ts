// Expanding a selected script into finished content.
//
// The workflow's last step: a human has picked one candidate from the batch, and this
// turns it into everything needed to publish — a caption per platform, hashtags, the
// lines that will appear on the poster, and the scene description for the background.
//
// It does NOT invent anything. The poster text lines it returns are the ones that get
// drawn onto the image, so they must be short, true, and traceable to real data. The
// model is told to use only the facts it is given, exactly as in candidate generation.
import { db } from "@/lib/db";
import { aiProvider } from "@/providers";

export interface PlatformVersion {
  platform: string;
  caption: string;
  /** Anything platform-specific the operator should know (length limits, format hints). */
  note?: string;
}

export interface ExpandedContent {
  /** The primary caption (the platform the script was written for). */
  caption: string;
  hashtags: string[];
  versions: PlatformVersion[];
  /** Scene description handed to the image model — text and product excluded. */
  posterScene: string;
  /** The exact lines drawn onto the poster. Short, and factual. */
  posterText: { headline: string; sub?: string; productLine?: string; specsLine?: string; cta?: string };
  /** Suggested posting note for the operator. */
  publishNote: string;
}

export const PLATFORMS = ["TIKTOK", "INSTAGRAM", "FACEBOOK", "WHATSAPP"] as const;

/** Character guidance per platform, used to steer the model and shown to the operator. */
export const PLATFORM_LIMITS: Record<string, { caption: number; note: string }> = {
  TIKTOK: { caption: 150, note: "Short and punchy; the hook carries the video, the caption supports it." },
  INSTAGRAM: { caption: 300, note: "First line shows before 'more' — make it earn the tap. Hashtags in the caption." },
  FACEBOOK: { caption: 500, note: "Can carry more context; links are clickable." },
  WHATSAPP: { caption: 400, note: "Sent to opted-in customers — conversational, no hashtags." },
};

/** Exported so the instructions the model actually receives can be reviewed and tested. */
export const EXPAND_SYSTEM = `You finish social content for a Malaysian motorcycle workshop and its DASHOIL lubricant line.

HARD FACTS RULE:
- Every price, viscosity, API/JASO rating, volume and award must come from the material you are given.
- Never invent a fact, a guarantee, a certification or a competitor comparison.
- If a fact is absent, write around it rather than filling the gap.

OUTPUT RULES:
- The "posterText" lines are DRAWN ONTO AN IMAGE. They must be very short — headline at most 5 words, sub at most 8, and the rest at most 6. No punctuation at the end. No emoji in poster text.
- Hashtags are for Malaysian riders: mix Bahasa Malaysia, English and Chinese where natural. Include #DASHOIL and #motorcyclemalaysia style tags. No more than 12.
- posterScene describes only the room, lighting and mood. It must NOT mention any text, logo or product — those are added separately.
- Never reproduce wording from any trend or competitor content.

Return ONLY raw JSON, no prose and no markdown fences.`;

/** Build the prompt for expansion. Exported so the wording can be reviewed and tested. */
export function buildExpandPrompt(input: {
  script: { hook: string | null; body: string; cta: string | null; angle: string | null; platform: string; language: string | null };
  product: { name: string; volume: string | null; facts: string; points: string[] } | null;
  brandName: string | null;
  platforms: readonly string[];
}): string {
  const lines: string[] = [];
  lines.push("THE CHOSEN SCRIPT");
  if (input.script.angle) lines.push("Angle: " + input.script.angle);
  if (input.script.hook) lines.push("Hook: " + input.script.hook);
  lines.push("Body: " + input.script.body);
  if (input.script.cta) lines.push("CTA: " + input.script.cta);
  lines.push("Written for: " + input.script.platform + " in " + (input.script.language ?? "ms"));
  lines.push("");
  if (input.product) {
    lines.push("PRODUCT (real label facts — the only product facts you may state)");
    lines.push("  " + input.product.name + (input.product.volume ? " · " + input.product.volume : ""));
    lines.push("  " + input.product.facts);
    if (input.product.points.length) lines.push("  selling points: " + input.product.points.join("; "));
    lines.push("");
  } else {
    lines.push("PRODUCT: none. Do not name any product or quote any spec.");
    lines.push("");
  }
  if (input.brandName) {
    lines.push("BRAND: " + input.brandName);
    lines.push("");
  }
  lines.push("TASK");
  lines.push("Produce a caption for each of: " + input.platforms.join(", ") + ".");
  for (const p of input.platforms) {
    const lim = PLATFORM_LIMITS[p];
    if (lim) lines.push("  " + p + ": max " + lim.caption + " characters. " + lim.note);
  }
  lines.push("");
  lines.push("Return exactly this shape:");
  lines.push('{"caption":"the primary caption","hashtags":["#tag"],"versions":[{"platform":"TIKTOK","caption":"..."}],"posterScene":"the room/lighting/mood only","posterText":{"headline":"max 5 words","sub":"max 8 words","productLine":"max 6 words","specsLine":"max 6 words","cta":"max 4 words"},"publishNote":"one line of practical advice for the operator"}');
  return lines.join("\n");
}

/** Keep only tags that look like tags, and cap the list. */
export function normaliseHashtags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const clean = t.trim().replace(/\s+/g, "");
    if (!clean) continue;
    const withHash = clean.startsWith("#") ? clean : "#" + clean;
    if (withHash.length < 2 || withHash.length > 40) continue;
    if (out.includes(withHash)) continue;
    out.push(withHash);
    if (out.length >= 12) break;
  }
  return out;
}

/** Trim a poster line and drop trailing punctuation — it is drawn large, not written. */
export function normalisePosterLine(raw: unknown, maxWords: number): string {
  if (typeof raw !== "string") return "";
  const words = raw.trim().replace(/[.,;:!?]+$/, "").split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

/**
 * Expand one selected script. Always strict — a half-expanded script that looks finished
 * would be published as-is.
 */
export async function expandScript(scriptId: string, opts?: { platforms?: readonly string[] }) {
  const script = await db.contentScript.findUnique({ where: { id: scriptId } });
  if (!script) throw new Error("Script not found");

  const platforms = opts?.platforms ?? PLATFORMS;

  const product = script.productSku
    ? await db.promoProduct.findUnique({ where: { sku: script.productSku } })
    : null;
  const productArg = product
    ? {
        name: product.name,
        volume: product.volume,
        facts: Object.entries((product.specs ?? {}) as Record<string, string>).map(([k, v]) => k + ": " + v).join(" · "),
        points: (() => { try { return product.sellingPoints ? (JSON.parse(product.sellingPoints) as string[]) : []; } catch { return []; } })(),
      }
    : null;

  const profile = script.brandKey ? await db.brandProfile.findFirst({ where: { key: script.brandKey } }) : null;

  const raw = await aiProvider.chatJson<{
    caption?: string; hashtags?: unknown; versions?: unknown;
    posterScene?: string; posterText?: Record<string, unknown>; publishNote?: string;
  }>(
    [
      { role: "system", content: EXPAND_SYSTEM },
      { role: "user", content: buildExpandPrompt({
        script: { hook: script.hook, body: script.body, cta: script.cta, angle: script.angle, platform: script.platform, language: script.language },
        product: productArg,
        brandName: profile?.name ?? null,
        platforms,
      }) },
    ],
    { maxTokens: 2200, temperature: 0.7 },
  );

  const versions: PlatformVersion[] = Array.isArray(raw.versions)
    ? raw.versions
        .map((v) => v as Record<string, unknown>)
        .filter((v) => typeof v?.platform === "string" && typeof v?.caption === "string")
        .map((v) => ({ platform: String(v.platform).toUpperCase(), caption: String(v.caption).trim().slice(0, 1200), note: PLATFORM_LIMITS[String(v.platform).toUpperCase()]?.note }))
    : [];

  const pt = raw.posterText ?? {};
  const expanded: ExpandedContent = {
    caption: typeof raw.caption === "string" ? raw.caption.trim() : (versions[0]?.caption ?? script.body),
    hashtags: normaliseHashtags(raw.hashtags),
    versions,
    posterScene: typeof raw.posterScene === "string" ? raw.posterScene.trim().slice(0, 500) : "",
    posterText: {
      headline: normalisePosterLine(pt.headline, 5),
      sub: normalisePosterLine(pt.sub, 8) || undefined,
      productLine: normalisePosterLine(pt.productLine, 6) || undefined,
      specsLine: normalisePosterLine(pt.specsLine, 6) || undefined,
      cta: normalisePosterLine(pt.cta, 4) || undefined,
    },
    publishNote: typeof raw.publishNote === "string" ? raw.publishNote.trim().slice(0, 300) : "",
  };

  if (!expanded.caption) throw new Error("Expansion produced no caption");

  // Persist so a refresh does not discard work the operator has just reviewed.
  await db.contentScript.update({
    where: { id: scriptId },
    data: { expandedJson: expanded as never, expandedAt: new Date() },
  });

  return { script, expanded };
}
