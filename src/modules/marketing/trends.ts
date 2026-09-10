// Trend ingestion and structure analysis.
//
// THE CONSTRAINT THAT SHAPES THIS MODULE
// --------------------------------------
// YouTube's captions.download requires OAuth as the video's owner, so we cannot pull a
// transcript from someone else's viral video. TikTok and Instagram have no public trends
// API at all (TikTok's Research API is academic-only; scraping breaches their ToS).
//
// What we CAN legitimately get: title, author, description (via oEmbed, no key needed)
// and, for YouTube, view/like counts (via the Data API, key needed).
//
// So this analyses STRUCTURE, not wording. That is also the right thing to do: copying a
// viral script is a copyright problem and produces derivative content, while learning
// "this works because the hook is a cost-of-inaction question" is legitimate and reusable.
import { db } from "@/lib/db";
import { aiProvider } from "@/providers";
import { AiError } from "@/providers/types";

export type TrendSource = "YOUTUBE" | "TIKTOK" | "INSTAGRAM" | "NEWS" | "MANUAL";

export interface TrendStructure {
  summary: string;
  /** The shape of the opening — e.g. "cost-of-inaction question", "unexpected reveal". */
  hookPattern: string;
  /** e.g. "before/after", "myth-busting", "POV", "tutorial". */
  format: string;
  whyItWorks: string;
  /** Angles OUR content could take, inspired by the structure. Not the original script. */
  borrowableAngles: string[];
  /** 1-5 relevance to a Malaysian motorcycle workshop. */
  relevance: number;
  language: string;
}

/** Identify the platform and video id from a pasted link. Pure. */
export function parseTrendUrl(url: string): { source: TrendSource; videoId: string | null } {
  const u = url.trim();
  if (/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)/.test(u)) {
    const m = u.match(/(?:v=|shorts\/|embed\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    return { source: "YOUTUBE", videoId: m ? m[1] : null };
  }
  if (/tiktok\.com/.test(u)) return { source: "TIKTOK", videoId: u.match(/video\/(\d+)/)?.[1] ?? null };
  if (/instagram\.com/.test(u)) return { source: "INSTAGRAM", videoId: u.match(/\/(reel|p)\/([A-Za-z0-9_-]+)/)?.[2] ?? null };
  return { source: "MANUAL", videoId: null };
}

/** Stable identity for a trend so repeated ingestion updates instead of duplicating. Pure. */
export function dedupeKeyFor(source: string, url: string | null, title: string): string {
  const basis = (url?.trim() || title.trim()).toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, "");
  // short, stable, collision-resistant enough for one workshop's trend list
  let h = 0;
  for (let i = 0; i < basis.length; i++) h = (Math.imul(31, h) + basis.charCodeAt(i)) | 0;
  return source + ":" + (h >>> 0).toString(36);
}

/** Fallback relevance when the model is unavailable. Pure. */
export function heuristicRelevance(title: string, views: number | null): number {
  const t = title.toLowerCase();
  const motoTerms = ["moto", "motorcycle", "motorbike", "kapcai", "scooter", "helmet", "enjin", "engine oil", "tayar", "tyre", "brake", "servis", "workshop", "bengkel", "rider", "riding", "honda", "yamaha", "kawasaki", "modenas"];
  const hits = motoTerms.filter((k) => t.includes(k)).length;
  const base = hits >= 2 ? 5 : hits === 1 ? 4 : 2;
  if (views && views > 1_000_000 && base < 5) return Math.min(5, base + 1);
  return base;
}

const STRUCTURE_PROMPT = `You analyse short-form motorcycle content to find its reusable STRUCTURE.

HARD RULES:
- Extract the SHAPE, never the wording. Do NOT reproduce or closely paraphrase the original script, hook line, or captions.
- If the piece is not about motorcycles, riding, vehicle maintenance or Malaysian riders, say so via a low relevance score.
- Base everything on what you are given. Do not invent metrics or details.

Return ONLY raw JSON, no prose and no markdown fences, shaped exactly:
{"summary":"one or two lines on what this piece is about","hookPattern":"the shape of the opening, e.g. 'cost-of-inaction question' or 'unexpected visual reveal'","format":"e.g. before/after, myth-busting, POV, tutorial, listicle","whyItWorks":"one or two lines on the mechanism that makes it work","borrowableAngles":["angle our own content could take","second angle"],"relevance":1-5,"language":"ms|en|zh"}`;

/** Ask the model for a trend's reusable structure. Throws AiError if the model is unavailable. */
export async function analyzeTrendStructure(input: {
  title: string; author?: string | null; source: string;
  description?: string | null; views?: number | null; likes?: number | null; durationSec?: number | null;
}): Promise<TrendStructure> {
  const lines = [
    "Platform: " + input.source,
    "Title: " + input.title,
    input.author ? "Author: " + input.author : "",
    input.description ? "Description/transcript excerpt: " + input.description.slice(0, 1200) : "",
    input.views != null ? "Views: " + input.views : "",
    input.likes != null ? "Likes: " + input.likes : "",
    input.durationSec != null ? "Duration (seconds): " + input.durationSec : "",
    "",
    "Audience: riders in Malaysia. Context: a motorcycle workshop and a motorcycle lubricant brand (DASHOIL).",
  ].filter(Boolean);

  const raw = await aiProvider.chatJson<TrendStructure>(
    [{ role: "system", content: STRUCTURE_PROMPT }, { role: "user", content: lines.join("\n") }],
    { maxTokens: 700, temperature: 0.4 },
  );

  // Defensive: the model may return a partial shape. Normalise rather than trust it.
  return {
    summary: String(raw.summary ?? "").slice(0, 400),
    hookPattern: String(raw.hookPattern ?? "").slice(0, 200),
    format: String(raw.format ?? "").slice(0, 120),
    whyItWorks: String(raw.whyItWorks ?? "").slice(0, 400),
    borrowableAngles: Array.isArray(raw.borrowableAngles) ? raw.borrowableAngles.slice(0, 5).map((a) => String(a).slice(0, 220)) : [],
    relevance: Math.min(5, Math.max(1, Math.round(Number(raw.relevance) || 0) || heuristicRelevance(input.title, input.views ?? null))),
    language: ["ms", "en", "zh"].includes(String(raw.language)) ? String(raw.language) : "ms",
  };
}

/** oEmbed metadata. Works for YouTube and TikTok without any API key. */
export async function fetchOEmbed(url: string): Promise<{ title: string; author: string; thumbnail: string | null } | null> {
  const endpoint = /tiktok\.com/.test(url)
    ? "https://www.tiktok.com/oembed?url=" + encodeURIComponent(url)
    : /youtube\.com|youtu\.be/.test(url)
      ? "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(url)
      : null;
  if (!endpoint) return null; // Instagram oEmbed now needs a token; title must be supplied

  try {
    const res = await fetch(endpoint, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const d = await res.json() as { title?: string; author_name?: string; thumbnail_url?: string };
    return { title: d.title ?? "", author: d.author_name ?? "", thumbnail: d.thumbnail_url ?? null };
  } catch {
    return null;
  }
}

export interface IngestInput {
  url?: string | null;
  title?: string | null;
  source?: TrendSource;
  author?: string | null;
  description?: string | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  durationSec?: number | null;
  /** Skip the model call and store metadata only. */
  skipAnalysis?: boolean;
}

/**
 * Ingest one trend and extract its structure. Idempotent on the link/title.
 * Throws AiError when analysis is requested and the model is unavailable — a trend row
 * with empty structure is worse than no row, because it looks like it was analysed.
 */
export async function ingestTrend(input: IngestInput) {
  const url = input.url?.trim() || null;
  const parsed = url ? parseTrendUrl(url) : { source: (input.source ?? "MANUAL") as TrendSource, videoId: null };
  const source = input.source ?? parsed.source;

  let title = input.title?.trim() || "";
  let author = input.author ?? null;
  if (url && !title) {
    const meta = await fetchOEmbed(url);
    if (meta) { title = meta.title; author = author ?? (meta.author || null); }
  }
  if (!title) throw new Error("A trend needs a title or a link whose title can be fetched");

  const structure = input.skipAnalysis
    ? null
    : await analyzeTrendStructure({
        title, author, source,
        description: input.description ?? null,
        views: input.views ?? null, likes: input.likes ?? null, durationSec: input.durationSec ?? null,
      });

  const asOf = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const org = await db.organisation.findFirst();
  const dedupeKey = dedupeKeyFor(source, url, title);

  const data = {
    organisationId: org?.id ?? null,
    asOf,
    source,
    title: title.slice(0, 300),
    url,
    author,
    views: input.views ?? null,
    likes: input.likes ?? null,
    comments: input.comments ?? null,
    durationSec: input.durationSec ?? null,
    language: structure?.language ?? null,
    summary: structure?.summary ?? null,
    hookPattern: structure?.hookPattern ?? null,
    format: structure?.format ?? null,
    whyItWorks: structure?.whyItWorks ?? null,
    borrowableAngles: structure ? JSON.stringify(structure.borrowableAngles) : null,
    relevance: structure?.relevance ?? heuristicRelevance(title, input.views ?? null),
    active: true,
  };

  const existing = await db.trendTopic.findUnique({ where: { dedupeKey }, select: { id: true } });
  if (existing) return { trend: await db.trendTopic.update({ where: { dedupeKey }, data }), created: false };
  return { trend: await db.trendTopic.create({ data: { ...data, dedupeKey } }), created: true };
}

/** Trends worth referencing right now: relevant first, then most recent. */
export async function topTrends(limit = 12) {
  const rows = await db.trendTopic.findMany({ where: { active: true }, orderBy: [{ relevance: "desc" }, { asOf: "desc" }], take: limit });
  return rows.map((r) => ({
    id: r.id, source: r.source, title: r.title, url: r.url, relevance: r.relevance,
    hookPattern: r.hookPattern, format: r.format, whyItWorks: r.whyItWorks,
    angles: r.borrowableAngles ? (JSON.parse(r.borrowableAngles) as string[]) : [],
  }));
}

/** The reusable structure digest handed to script generation — deliberately no original wording. */
export function structureDigest(trends: { hookPattern: string | null; format: string | null; whyItWorks: string | null; relevance: number }[]): string {
  return trends
    .filter((t) => t.relevance >= 3 && t.hookPattern)
    .slice(0, 6)
    .map((t) => "- hook: " + t.hookPattern + " | format: " + t.format + " | why: " + t.whyItWorks)
    .join("\n");
}

export { AiError };
