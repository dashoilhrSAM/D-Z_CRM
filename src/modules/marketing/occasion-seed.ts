// Writing the Malaysian content calendar into the database.
//
// WHY THIS LIVES IN src/ RATHER THAN scripts/
// -------------------------------------------
// The calendar is not a one-off import. Paydays are generated from the current month,
// so the horizon it was seeded with is the horizon the planner has. Seed it once and
// eighteen months later the Content Studio quietly has nothing to suggest — the same
// silent emptiness that made production look broken when the tables were created and
// left empty.
//
// So the write path is application code: the CLI script and the scheduled refresh call
// the same function, and there is no way for them to disagree about what the calendar
// should contain.
import { db } from "@/lib/db";
import { MY_CALENDAR, paydayOccasions, utcDay, isWindowOpen, type OccasionLike } from "./occasions";

/** How far ahead the rolling payday series is generated. */
export const PAYDAY_HORIZON_MONTHS = 18;

/**
 * Reference data for the calendar, including a rolling run of paydays from this month.
 *
 * Pure, so the horizon can be tested without a database.
 */
export function occasionRows(now = new Date()) {
  const startMonth = now.toISOString().slice(0, 7);
  return [...MY_CALENDAR, ...paydayOccasions(startMonth, PAYDAY_HORIZON_MONTHS)];
}

/**
 * Upsert the whole calendar. Idempotent — keyed by the occasion key, so re-running
 * updates in place and never duplicates.
 */
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

/**
 * How many of these occasions have a content window open on `now`.
 *
 * Delegates to isWindowOpen rather than restating the rule. The rule (a window opens
 * leadDays BEFORE the date) is the entire value of the calendar, and a second copy of it
 * written for a status report is exactly the kind of duplicate that drifts.
 */
export function openWindowCount(rows: OccasionLike[], now = new Date()) {
  return rows.filter((r) => isWindowOpen(r, now)).length;
}
