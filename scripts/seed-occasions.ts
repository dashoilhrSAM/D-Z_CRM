// Seed the Malaysian content calendar.
//
// Source: national public holiday listings plus Ministry of Education school terms.
// Idempotent (upsert by key) so it can be re-run after editing the data, and re-run
// yearly to add the next 12 months. Dates are reference data — shared, not org-scoped.
//
// The data and the seed are exported rather than run on import, so the whole marketing
// dataset can be seeded through one entry point (scripts/seed-marketing-data.ts) in the
// right order. Running this file directly still works.
import { db } from "../src/lib/db";
import { MY_CALENDAR, paydayOccasions, utcDay } from "../src/modules/marketing/occasions";

/** How far ahead the rolling payday series is generated. */
export const PAYDAY_HORIZON_MONTHS = 18;

/**
 * Reference data for the calendar, including a rolling run of paydays from this month.
 *
 * The paydays are generated rather than listed because they are not a fixed dataset:
 * they move every month, and a calendar that runs out is a content planner that has
 * nothing to suggest.
 */
export function occasionRows(now = new Date()) {
  const startMonth = now.toISOString().slice(0, 7);
  return [...MY_CALENDAR, ...paydayOccasions(startMonth, PAYDAY_HORIZON_MONTHS)];
}

export async function seedOccasions(now = new Date()) {
  const rows = occasionRows(now);
  let created = 0, updated = 0;
  for (const r of rows) {
    const data = {
      organisationId: null,
      key: r.key,
      name: r.name,
      nameEn: r.nameEn ?? null,
      nameZh: r.nameZh ?? null,
      startDate: utcDay(r.startDate),
      endDate: r.endDate ? utcDay(r.endDate) : null,
      type: r.type,
      relevance: r.relevance,
      leadDays: r.leadDays,
      angleHint: r.angleHint,
      notes: r.notes ?? null,
      active: true,
    };
    const existing = await db.occasion.findUnique({ where: { key: r.key }, select: { id: true } });
    if (existing) { await db.occasion.update({ where: { key: r.key }, data }); updated++; }
    else { await db.occasion.create({ data }); created++; }
  }
  return { created, updated, total: await db.occasion.count() };
}

async function main() {
  const res = await seedOccasions();
  console.log("occasions created: " + res.created + ", updated: " + res.updated + ", total: " + res.total);

  const byType = await db.occasion.groupBy({ by: ["type"], _count: true });
  console.log("by type: " + byType.map((b) => b.type + ":" + b._count).join(", "));

  const upcoming = await db.occasion.findMany({
    where: { startDate: { gte: new Date() } },
    orderBy: { startDate: "asc" },
    take: 8,
    select: { key: true, name: true, startDate: true, relevance: true, leadDays: true },
  });
  console.log("\nnext up:");
  for (const u of upcoming) {
    console.log("  " + u.startDate.toISOString().slice(0, 10) + "  r" + u.relevance + " lead=" + String(u.leadDays).padStart(2) + "  " + u.name);
  }
}

// Only run when invoked directly, so importing the seed cannot have side effects.
const invokedDirectly = process.argv[1]?.endsWith("seed-occasions.ts") ?? false;
if (invokedDirectly) {
  main().then(() => process.exit(0)).catch((e) => { console.error("ERROR", e); process.exit(1); });
}
