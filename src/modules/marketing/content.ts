// Script candidate generation (P4).
//
// The workflow the owner asked for: generate MANY candidate scripts, let a human pick
// one, and only then expand it into a finished piece. So this produces a reviewed batch,
// never a finished asset.
//
// The hard rule that shapes the prompt: the model may only use facts in the FACTS block,
// which is assembled from the database. It must never invent a price, a spec, a
// certification or a promise. Anything it writes about a product has to trace back to a
// real row.
import { db } from "@/lib/db";
import { aiProvider } from "@/providers";
import { topTrends, structureDigest } from "./trends";
import { rankOccasions } from "./occasions";

export const DEFAULT_CANDIDATE_COUNT = 8;
export const MAX_CANDIDATE_COUNT = 12;

export interface CandidateRequest {
  /** BrandProfile.key — whose voice to write in. Defaults to the workshop. */
  brandKey?: string;
  platform?: string;
  language?: string;
  count?: number;
  /** Free-text brief from the operator. */
  topic?: string;
  /** Anchor on a specific occasion (Occasion.key). Otherwise the best open window is used. */
  occasionKey?: string;
  /** Pull trend structures in as style reference. */
  useTrends?: boolean;
  /** The product toggle. */
  includeProduct?: boolean;
  /** Which products may appear. Defaults to a relevant spread. */
  productSkus?: string[];
}

export interface GeneratedCandidate {
  angle: string;
  title: string;
  hook: string;
  body: string;
  cta: string;
  tone: string;
  platform: string;
  language: string;
  includeProduct: boolean;
  productSku: string | null;
  score: number;
  reasoning: string;
}

export interface FactSheet {
  products: { sku: string; name: string; volume: string | null; facts: string; points: string[] }[];
  services: { name: string; priceSen: number | null; detail: string }[];
}

/**
 * Assemble the only things the model is allowed to treat as true.
 * Everything here comes from the database — nothing is written by hand.
 */
export async function buildFactSheet(opts: { includeProduct: boolean; productSkus?: string[] }): Promise<FactSheet> {
  const products = opts.includeProduct
    ? await db.promoProduct.findMany({
        where: {
          active: true,
          ...(opts.productSkus && opts.productSkus.length > 0 ? { sku: { in: opts.productSkus } } : {}),
        },
        orderBy: { sortOrder: "asc" },
        select: { sku: true, name: true, volume: true, brand: true, specs: true, sellingPoints: true },
      })
    : [];

  const services = await db.serviceType.findMany({
    where: { active: true },
    select: { name: true, category: true, priceSen: true },
    take: 30,
  });

  return {
    products: products.map((p) => {
      const s = (p.specs ?? {}) as Record<string, string>;
      const facts = [
        p.volume ? p.volume : "",
        s.viscosity ?? "", s.api ?? "", s.jaso ?? "", s.type ?? "",
        p.brand ? "brand: " + p.brand : "",
      ].filter(Boolean).join(" · ");
      let points: string[] = [];
      try { points = p.sellingPoints ? (JSON.parse(p.sellingPoints) as string[]) : []; } catch { points = []; }
      return { sku: p.sku, name: p.name, volume: p.volume, facts, points };
    }),
    services: services.map((s) => ({
      name: s.name,
      priceSen: s.priceSen,
      // never render a price we do not actually have
      detail: s.priceSen == null
        ? (s.category ?? "service") + " · price not set"
        : (s.category ?? "") + " · RM" + (s.priceSen / 100).toFixed(2),
    })),
  };
}

/** Render the fact sheet into the prompt. Only these numbers may appear in output. */
export function renderFacts(f: FactSheet): string {
  const lines: string[] = [];
  if (f.services.length > 0) {
    lines.push("SERVICES (real prices — the only prices you may ever state):");
    for (const s of f.services.slice(0, 20)) lines.push("  - " + s.name + " (" + s.detail + ")");
  }
  if (f.products.length > 0) {
    lines.push("");
    lines.push("PRODUCTS (real labels — the only product facts you may state):");
    for (const p of f.products) {
      const pts = p.points.length > 0 ? " | selling points: " + p.points.join("; ") : "";
      lines.push("  - " + p.sku + " — " + p.name + " [" + p.facts + "]" + pts);
    }
  }
  if (lines.length === 0) lines.push("(no product or service facts available — write without naming any product or price)");
  return lines.join("\n");
}

const SYSTEM = `You write short-form social content for a Malaysian motorcycle workshop and its DASHOIL lubricant line.

HARD FACTS RULE — this is absolute:
- Every price, viscosity, API/JASO rating, volume, certification and award you mention must come from the FACTS block you are given.
- If a fact is not in FACTS, do not state it. Do not estimate. Do not fill gaps from general knowledge.
- Never invent a mileage guarantee, a warranty, a test result or a competitor comparison.
- If FACTS is empty, write content that names no product and quotes no price.

STYLE:
- Write the body in the requested language. Bahasa Malaysia is the default and should sound like everyday spoken Malay, not formal written Malay.
- Keep technical terms (API SP, JASO MA2, 10W40) in their original form — riders and mechanics search by them.
- Short sentences. No hype. No exclamation-mark spam.
- Each candidate must take a genuinely DIFFERENT angle from its siblings — different hook shape, different reason to care. Near-duplicates are useless.

Return ONLY raw JSON, no prose and no markdown fences.`;

export function buildUserPrompt(args: {
  brand: { name: string; voice: string | null; dos: string[]; donts: string[]; samples: string[] } | null;
  occasion: { name: string; angleHint: string; daysUntil: number } | null;
  trendDigest: string;
  facts: string;
  request: CandidateRequest;
}): string {
  const { brand, occasion, trendDigest, facts, request } = args;
  const count = Math.min(MAX_CANDIDATE_COUNT, Math.max(1, request.count ?? DEFAULT_CANDIDATE_COUNT));
  const platform = request.platform ?? "TIKTOK";
  const language = request.language ?? "ms";

  const parts: string[] = [];
  if (brand) {
    parts.push("BRAND VOICE — " + brand.name);
    if (brand.voice) parts.push(brand.voice);
    if (brand.dos.length) parts.push("Always: " + brand.dos.join(" | "));
    if (brand.donts.length) parts.push("Never: " + brand.donts.join(" | "));
    if (brand.samples.length) parts.push("Examples of the tone we like (do not copy, match the register):\n" + brand.samples.map((s) => "  - " + s).join("\n"));
    parts.push("");
  }
  if (occasion) {
    parts.push("OCCASION — " + occasion.name + " (in " + occasion.daysUntil + " days)");
    parts.push("Angle to build on: " + occasion.angleHint);
    parts.push("");
  }
  if (trendDigest) {
    parts.push("STRUCTURE REFERENCE — shapes that work in this space. Use the SHAPE, never the wording:");
    parts.push(trendDigest);
    parts.push("");
  }
  parts.push("FACTS");
  parts.push(facts);
  parts.push("");
  if (request.topic?.trim()) {
    parts.push("BRIEF FROM THE OPERATOR: " + request.topic.trim());
    parts.push("");
  }
  parts.push("TASK");
  parts.push("Write " + count + " distinct candidate scripts for " + platform + ", in language \"" + language + "\".");
  parts.push(request.includeProduct
    ? "PRODUCT TOGGLE: ON. If a candidate mentions the brand or any product anywhere in its text, it MUST set includeProduct true and set productSku to one exact sku from FACTS. Only leave includeProduct false when the copy genuinely never refers to a product. Consistency between the copy and the flag matters: a script that names a product but marks includeProduct false will render the wrong image."
    : "PRODUCT TOGGLE: OFF. Do not mention the brand or any product anywhere in the copy, do not set productSku, and set includeProduct false for every candidate.");
  parts.push("");
  parts.push("Return exactly this shape:");
  parts.push('{"candidates":[{"angle":"3-5 word label for the angle","title":"short internal title","hook":"the opening line, exactly as it would be said","body":"the script body","cta":"the closing call to action","tone":"e.g. friendly|educational|urgent|reassuring","platform":"' + platform + '","language":"' + language + '","includeProduct":false,"productSku":null,"score":1-5,"reasoning":"one line on why this angle should work"}]}');
  return parts.join("\n");
}

/** Normalise one returned candidate. Anything malformed is dropped rather than guessed. */
export function normaliseCandidate(raw: unknown, fallbackPlatform: string, fallbackLanguage: string): GeneratedCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const body = str(r.body, 2000);
  const hook = str(r.hook, 400);
  if (!body && !hook) return null; // nothing usable
  return {
    angle: str(r.angle, 120) || "untitled angle",
    title: str(r.title, 160) || str(r.angle, 160) || "Untitled",
    hook,
    body,
    cta: str(r.cta, 300),
    tone: str(r.tone, 40) || "friendly",
    platform: str(r.platform, 30) || fallbackPlatform,
    language: str(r.language, 10) || fallbackLanguage,
    includeProduct: r.includeProduct === true,
    productSku: typeof r.productSku === "string" && r.productSku.trim() ? r.productSku.trim().slice(0, 40) : null,
    score: Math.min(5, Math.max(1, Math.round(Number(r.score) || 3))),
    reasoning: str(r.reasoning, 400),
  };
}

/**
 * Reconcile the product flag with what the script actually says.
 *
 * The model sometimes writes a body that names the brand or a product while leaving
 * includeProduct false — the script mentions the product but its poster would not show
 * one. That mismatch is invisible until someone renders the wrong image, so it is fixed
 * here rather than trusted.
 */
export function reconcileProductFlag(
  c: GeneratedCandidate,
  allowedSkus: Set<string>,
  productNames: string[],
): GeneratedCandidate {
  const text = (c.hook + " " + c.body + " " + c.cta + " " + c.title).toLowerCase();
  const names = productNames.map((n) => n.toLowerCase()).filter((n) => n.length >= 3);
  const mentionsProduct = names.some((n) => text.includes(n)) || /dashoil|dashcil/.test(text);

  const skuValid = Boolean(c.productSku && allowedSkus.has(c.productSku));
  // An invalid sku is always dropped — we never render a bottle that does not exist.
  const sku = skuValid ? c.productSku : null;

  if (mentionsProduct) {
    // The script talks about a product, so the flag must be on; the sku stays null when
    // the model did not commit to one, leaving the operator to choose.
    return { ...c, includeProduct: true, productSku: sku };
  }
  if (!c.includeProduct) return { ...c, includeProduct: false, productSku: null };
  // Flag on but nothing in the copy refers to a product — only keep it if a real sku is set.
  return { ...c, includeProduct: skuValid, productSku: sku };
}

/** Drop near-duplicate angles so a batch of 8 is actually 8 different ideas. */
export function dedupeCandidates(cands: GeneratedCandidate[]): GeneratedCandidate[] {
  const seen = new Set<string>();
  const out: GeneratedCandidate[] = [];
  for (const c of cands) {
    const key = c.angle.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Generate a batch of candidate scripts and persist them.
 * Every failure path throws — a batch that silently produced nothing is worse than an
 * error, because the operator cannot tell the difference from a slow model.
 */
export async function generateScriptCandidates(request: CandidateRequest) {
  const count = Math.min(MAX_CANDIDATE_COUNT, Math.max(1, request.count ?? DEFAULT_CANDIDATE_COUNT));
  const platform = request.platform ?? "TIKTOK";
  const language = request.language ?? "ms";
  const includeProduct = request.includeProduct ?? false;

  const branch = await db.branch.findFirst({ where: { isMain: true } }) ?? await db.branch.findFirst();
  if (!branch) throw new Error("No branch configured");

  // --- context ---
  const brandKey = request.brandKey ?? "DZ_WORKSHOP";
  const profile = await db.brandProfile.findFirst({ where: { key: brandKey, active: true } });
  const brand = profile
    ? {
        name: profile.name,
        voice: profile.voice,
        dos: safeJson(profile.dos),
        donts: safeJson(profile.donts),
        samples: safeJson(profile.samplePosts).slice(0, 3),
      }
    : null;

  let occasion: { name: string; angleHint: string; daysUntil: number; key: string } | null = null;
  if (request.occasionKey) {
    const o = await db.occasion.findUnique({ where: { key: request.occasionKey } });
    if (o) occasion = { name: o.name, angleHint: o.angleHint ?? "", daysUntil: 0, key: o.key };
  } else {
    // default to whatever content window is open right now
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    const all = await db.occasion.findMany({ where: { active: true, type: { not: "PAYDAY" } } });
    const best = rankOccasions(all, today).find((r) => r.windowOpen);
    if (best) occasion = { name: best.occasion.name, angleHint: ocAngle(best.occasion.angleHint), daysUntil: best.daysUntil, key: best.occasion.key };
  }

  const trendDigest = request.useTrends === false ? "" : structureDigest(await topTrends(8));
  const facts = await buildFactSheet({ includeProduct, productSkus: request.productSkus });

  // --- model ---
  const raw = await aiProvider.chatJson<{ candidates?: unknown[] }>(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: buildUserPrompt({ brand, occasion, trendDigest, facts: renderFacts(facts), request: { ...request, count, platform, language, includeProduct } }) },
    ],
    { maxTokens: 3800, temperature: 0.9 },
  );

  const parsed = Array.isArray(raw?.candidates) ? raw.candidates : [];
  const cleaned = dedupeCandidates(
    parsed.map((c) => normaliseCandidate(c, platform, language)).filter((c): c is GeneratedCandidate => c !== null),
  );
  if (cleaned.length === 0) {
    throw new Error("The model returned no usable candidates (expected a non-empty candidates array)");
  }

  // A product may only be referenced if it is in the fact sheet, and the flag must agree
  // with what the copy actually says.
  const allowedSkus = new Set(facts.products.map((p) => p.sku));
  const productNames = facts.products.map((p) => p.name);
  const reconciled = cleaned.map((c) => reconcileProductFlag(c, allowedSkus, productNames));

  // --- persist as a reviewable batch ---
  const batchId = "batch_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  const generatedAt = new Date();
  const created = [];
  for (const c of reconciled) {
    created.push(await db.contentScript.create({
      data: {
        branchId: branch.id,
        title: c.title,
        platform: c.platform,
        hook: c.hook,
        body: c.body,
        tone: c.tone,
        status: "CANDIDATE",
        source: "AI",
        batchId,
        angle: c.angle,
        cta: c.cta,
        language: c.language,
        brandKey,
        occasionKey: occasion?.key ?? null,
        includeProduct: c.includeProduct,
        productSku: c.productSku,
        score: c.score,
        reasoning: c.reasoning,
        generatedAt,
      },
    }));
  }

  return {
    batchId,
    brandKey,
    occasion: occasion ? { key: occasion.key, name: occasion.name } : null,
    trendDigestUsed: Boolean(trendDigest),
    requested: count,
    produced: created.length,
    candidates: created,
  };
}

/** Approve one candidate and reject its siblings — the human-picks-one step. */
export async function selectCandidate(id: string) {
  const script = await db.contentScript.findUnique({ where: { id } });
  if (!script) throw new Error("Script not found");
  if (script.batchId) {
    await db.contentScript.updateMany({
      where: { batchId: script.batchId, id: { not: id }, status: "CANDIDATE" },
      data: { status: "REJECTED" },
    });
  }
  return db.contentScript.update({ where: { id }, data: { status: "SELECTED" } });
}

/** Discard an entire batch. */
export async function discardBatch(batchId: string) {
  const res = await db.contentScript.updateMany({ where: { batchId, status: "CANDIDATE" }, data: { status: "REJECTED" } });
  return { rejected: res.count };
}

function safeJson(raw: string | null): string[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

function ocAngle(a: string | null): string {
  return a ?? "";
}
