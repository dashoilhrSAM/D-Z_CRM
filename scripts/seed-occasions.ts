// Seed the Malaysian content calendar.
//
// Source: national public holiday listings plus Ministry of Education school terms.
// Idempotent (upsert by key) so it can be re-run after editing the data, and re-run
// yearly to add the next 12 months. Dates are reference data — shared, not org-scoped.
import { db } from "../src/lib/db";
import { MY_CALENDAR, paydayOccasions, utcDay } from "../src/modules/marketing/occasions";

async function main() {
  // 18 months of paydays from the current month, so the planner always has a horizon
  const now = new Date();
  const startMonth = now.toISOString().slice(0, 7);
  const rows = [...MY_CALENDAR, ...paydayOccasions(startMonth, 18)];

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

  const total = await db.occasion.count();
  const byType = await db.occasion.groupBy({ by: ["type"], _count: true });
  console.log("occasions created: " + created + ", updated: " + updated + ", total: " + total);
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
main().then(() => process.exit(0)).catch((e) => { console.error("ERROR", e); process.exit(1); });
