import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session-user";
import { generateScriptCandidates, selectCandidate, discardBatch } from "@/modules/marketing/content";
import { expandScript } from "@/modules/marketing/expand";
import { renderScriptPoster } from "@/modules/marketing/render-poster";
import { db } from "@/lib/db";

/**
 * The content engine's slow operations, as a route handler rather than server actions.
 *
 * Generating candidates calls a model, expanding calls a model again, and rendering a
 * poster calls an image model — all far beyond a server action's budget. maxDuration
 * makes the ceiling explicit instead of letting a request be cut off halfway with the
 * operator left guessing whether anything happened.
 *
 * Every branch requires a signed-in user: these endpoints spend real money.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionUser();
  if (!session.authenticated) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action ?? "");

  try {
    switch (action) {
      case "candidates": {
        const result = await generateScriptCandidates({
          brandKey: body.brandKey ? String(body.brandKey) : undefined,
          platform: body.platform ? String(body.platform) : undefined,
          language: body.language ? String(body.language) : undefined,
          count: body.count ? Number(body.count) : undefined,
          topic: body.topic ? String(body.topic) : undefined,
          occasionKey: body.occasionKey ? String(body.occasionKey) : undefined,
          useTrends: body.useTrends !== false,
          includeProduct: body.includeProduct === true,
          productSkus: Array.isArray(body.productSkus) ? (body.productSkus as string[]) : undefined,
        });
        return NextResponse.json({
          ok: true,
          batchId: result.batchId,
          produced: result.produced,
          occasion: result.occasion,
          candidates: result.candidates.map((c) => ({
            id: c.id, angle: c.angle, title: c.title, hook: c.hook, body: c.body, cta: c.cta,
            score: c.score, reasoning: c.reasoning, includeProduct: c.includeProduct, productSku: c.productSku,
          })),
        });
      }

      case "select": {
        const id = String(body.id ?? "");
        if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
        const script = await selectCandidate(id);
        return NextResponse.json({ ok: true, id: script.id, status: script.status });
      }

      case "discard": {
        const batchId = String(body.batchId ?? "");
        if (!batchId) return NextResponse.json({ ok: false, error: "batchId is required" }, { status: 400 });
        return NextResponse.json({ ok: true, ...(await discardBatch(batchId)) });
      }

      case "expand": {
        const id = String(body.id ?? "");
        if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
        const platforms = Array.isArray(body.platforms) ? (body.platforms as string[]) : undefined;
        const { expanded } = await expandScript(id, platforms ? { platforms } : undefined);
        return NextResponse.json({ ok: true, expanded });
      }

      case "poster": {
        const id = String(body.id ?? "");
        if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
        const size = body.size === "STORY" || body.size === "BANNER" ? body.size : "SQUARE";
        const style = body.style ? String(body.style) : undefined;
        const result = await renderScriptPoster(id, { size, style: style as never });
        return NextResponse.json({ ok: true, ...result });
      }

      // Reopening something finished. The studio keeps only the current run in memory, so
      // without this the work was saved but unreachable — the operator saw an empty screen
      // and concluded it had not been saved at all.
      case "load": {
        const id = String(body.id ?? "");
        if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
        const script = await db.contentScript.findUnique({
          where: { id },
          select: {
            id: true, title: true, angle: true, hook: true, body: true, cta: true, platform: true,
            language: true, brandKey: true, occasionKey: true, includeProduct: true, productSku: true,
            status: true, generatedAt: true, usedAt: true, expandedJson: true, posterUrl: true, posterRenderedAt: true,
          },
        });
        if (!script) return NextResponse.json({ ok: false, error: "Script not found" }, { status: 404 });
        return NextResponse.json({ ok: true, script });
      }

      // Marking content as posted. The status was designed for this but never set, so posted
      // and unposted work sat mixed together in the bank.
      case "mark-used": {
        const id = String(body.id ?? "");
        if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
        const used = body.used !== false;
        const script = await db.contentScript.update({
          where: { id },
          data: { status: used ? "USED" : "SELECTED", usedAt: used ? new Date() : null },
          select: { id: true, status: true, usedAt: true },
        });
        return NextResponse.json({ ok: true, ...script });
      }

      default:
        return NextResponse.json({ ok: false, error: "Unknown action: " + action }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Surface the real reason — a generic message here leaves the operator unable to act.
    return NextResponse.json({ ok: false, error: message.slice(0, 400) }, { status: 500 });
  }
}

/** The recent batches, for the studio's history panel. */
export async function GET() {
  const session = await getSessionUser();
  if (!session.authenticated) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const rows = await db.contentScript.findMany({
    where: { source: "AI" },
    orderBy: { generatedAt: "desc" },
    take: 60,
    select: {
      id: true, batchId: true, title: true, angle: true, hook: true, status: true,
      score: true, includeProduct: true, productSku: true, generatedAt: true,
      posterUrl: true, expandedAt: true, occasionKey: true, usedAt: true,
    },
  });

  const batches = new Map<string, { batchId: string; createdAt: Date | null; scripts: typeof rows }>();
  for (const r of rows) {
    const key = r.batchId ?? "ungrouped";
    if (!batches.has(key)) batches.set(key, { batchId: key, createdAt: r.generatedAt, scripts: [] });
    batches.get(key)!.scripts.push(r);
  }
  return NextResponse.json({ ok: true, batches: [...batches.values()].slice(0, 6) });
}
