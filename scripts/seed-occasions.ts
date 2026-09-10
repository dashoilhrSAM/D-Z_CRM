// Seed the Malaysian content calendar from the command line.
//
// The work itself lives in src/modules/marketing/occasion-seed.ts, because this is not a
// one-off import: paydays roll forward every month, so the same function is also called by
// the scheduled refresh. Two copies of "what the calendar should contain" would drift;
// there is one, and this file is a wrapper around it.
import { db } from "../src/lib/db";
import { occasionRows, seedOccasions, PAYDAY_HORIZON_MONTHS } from "../src/modules/marketing/occasion-seed";

export { occasionRows, seedOccasions, PAYDAY_HORIZON_MONTHS };

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

main().then(() => process.exit(0)).catch((e) => { console.error("ERROR", e); process.exit(1); });
