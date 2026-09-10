// AI background generation.
//
// Deliberately generates a SCENE ONLY — no text, no product, no logo. The real product
// cut-out is composited on top programmatically and the text is drawn as vector paths.
//
// The reason is not aesthetic. An image model cannot render "API SP JASO MA2" or
// "1.2L" on a bottle label; it produces convincing-looking gibberish. For a brand whose
// labels carry the actual specification, letting the model draw the product would
// corrupt the one thing the customer is meant to read. So the model paints the room and
// we place the real bottle in it.
import { AiError } from "@/providers/types";

export type PosterSizeKey = "SQUARE" | "STORY" | "BANNER";

/** Generation sizes supported by the images endpoint, and the canvas we then use. */
export const SIZE_MAP: Record<PosterSizeKey, { gen: string; width: number; height: number }> = {
  SQUARE: { gen: "1024x1024", width: 1080, height: 1080 },
  STORY: { gen: "1024x1536", width: 1080, height: 1920 },
  BANNER: { gen: "1536x1024", width: 1920, height: 1080 },
};

/** Negative constraints appended to every prompt — the model must leave the canvas clean. */
export const BACKGROUND_RULES =
  "Photographic background scene for a motorcycle workshop poster. " +
  "IMPORTANT: absolutely no text, no words, no letters, no numbers, no logos, no watermarks, no signage, no brand marks anywhere in the image. " +
  "No people. Leave a clean, uncluttered area in the lower or central part of the frame for a product to be placed later. " +
  "Shallow depth of field, natural lighting.";

export interface BackgroundRequest {
  /** What the scene should depict — the only creative input. */
  scene: string;
  size?: PosterSizeKey;
  /** Optional palette hint, e.g. from a brand tone. */
  mood?: string;
}

export interface BackgroundResult {
  buffer: Buffer;
  size: PosterSizeKey;
  width: number;
  height: number;
  prompt: string;
}

/**
 * Generate one background image. Always strict: an empty or failed generation throws,
 * because a poster silently missing its background is worse than an error the operator
 * can see and retry.
 */
export async function generateBackground(input: BackgroundRequest): Promise<BackgroundResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AiError("OPENAI_API_KEY is not configured — cannot generate poster backgrounds");

  const sizeKey = input.size ?? "SQUARE";
  const dims = SIZE_MAP[sizeKey];
  const prompt = [BACKGROUND_RULES, input.scene, input.mood ? "Mood: " + input.mood : ""].filter(Boolean).join(" ");

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst",
        prompt,
        size: dims.gen,
        n: 1,
      }),
    });
  } catch (e) {
    throw new AiError("Image request failed: " + (e as Error).message, e);
  }

  const data = await res.json() as { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } };
  if (!res.ok || data.error) {
    throw new AiError("Image generation failed: " + (data.error?.message ?? "HTTP " + res.status));
  }

  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new AiError("Image generation returned no image data");

  return {
    buffer: Buffer.from(b64, "base64"),
    size: sizeKey,
    width: dims.width,
    height: dims.height,
    prompt,
  };
}

/**
 * Default scene for a workshop post, derived from the content rather than hardcoded.
 * Kept small and deterministic so it is testable.
 */
export function sceneFor(topic: { kind: "product" | "service" | "occasion"; subject?: string | null }): string {
  const subject = (topic.subject ?? "").trim();
  if (topic.kind === "product") {
    return "A dark, moody motorcycle garage bench at night with warm task lighting, tools resting out of focus, a clear empty surface in the centre foreground. " +
      (subject ? "Theme: " + subject + ". " : "");
  }
  if (topic.kind === "occasion") {
    return "A Malaysian road at golden hour with distant hills, a motorcycle parked at the roadside seen from behind, warm light, room for a message in the sky area. " +
      (subject ? "Theme: " + subject + ". " : "");
  }
  return "The interior of a clean modern motorcycle workshop, a lift and tools softly out of focus, cool daylight through roller shutters, uncluttered foreground space. " +
    (subject ? "Theme: " + subject + ". " : "");
}
