// Seed everything the marketing content engine needs, in one command.
//
// WHY THIS EXISTS
// ---------------
// The calendar, the product catalogue and the brand voices were each seeded by their own
// script, run by hand, in an order that mattered. Locally that worked. In production it
// did not happen at all: the tables were created by a schema change and then stayed empty,
// so the Content Studio came up with nothing to suggest and looked broken rather than
// unseeded. Four scripts and a remembered order is the kind of thing that gets skipped.
//
// Every step here is idempotent, so this is safe to re-run at any time, on any
// environment. The ordering is enforced in code instead of in someone's head: the brand
// backfill has to run after the product import, or there are no products to brand.
//
// USAGE
//   node --import tsx scripts/seed-marketing-data.ts          # the database in DATABASE_URL
//   DATABASE_URL=... npm run seed:marketing                   # a specific target
import { db } from "../src/lib/db";
import { seedOccasions, openWindowCount } from "@/modules/marketing/occasion-seed";
import { seedPromoProducts } from "./import-promo-products";
import { seedBrandProfiles } from "./seed-brand-profiles";
import { seedDashoilBrand } from "./apply-dashoil-brand";

/** Host of the database in use, with any credentials stripped out. */
function target(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) return "(DATABASE_URL is not set)";
  if (url.startsWith("file:")) return "local sqlite " + url;
  try { return new URL(url).host; } catch { return "(unparseable DATABASE_URL)"; }
}

/**
 * What the Content Studio actually needs in order to show something useful.
 *
 * Counted here because "seeded" is not the same as "usable": a calendar whose every
 * window has closed, or a catalogue with no active products, is still an empty screen.
 */
async function readiness() {
  const now = new Date();
  // The open-window count is computed in TypeScript from the rows, not in SQL. An earlier
  // version used a raw query and failed silently: Postgres folds an unquoted startDate to
  // "startdate", the error was swallowed by a catch that existed for SQLite, and the report
  // simply said "unknown". The window rule already exists as a function; use it.
  const openNow = openWindowCount(
    await db.occasion.findMany({ where: { active: true }, select: { startDate: true, endDate: true, leadDays: true } }),
    now,
  );
  const [total, upcoming, products, activeProducts, profiles, unbranded] = await Promise.all([
    db.occasion.count(),
    db.occasion.count({ where: { startDate: { gte: now }, active: true } }),
    db.promoProduct.count(),
    db.promoProduct.count({ where: { active: true } }),
    db.brandProfile.count(),
    db.promoProduct.count({ where: { brand: null } }),
  ]);
  return { total, upcoming, openNow, products, activeProducts, profiles, unbranded };
}

async function main() {
  console.log("seeding marketing data into: " + target());
  console.log("");

  const occasions = await seedOccasions();
  console.log("occasions      created " + occasions.created + ", updated " + occasions.updated + ", total " + occasions.total);

  const products = await seedPromoProducts();
  console.log("products       created " + products.created + ", updated " + products.updated + ", total " + products.total +
    (products.missing > 0 ? " (image source not present — committed copies used)" : ""));

  const workshop = await seedBrandProfiles();
  console.log("workshop voice created " + workshop.created + ", updated " + workshop.updated);

  // After the products, because it brands them.
  const brand = await seedDashoilBrand();
  console.log("dashoil        branded " + brand.branded + " products, profile " + brand.profile);

  const r = await readiness();
  console.log("");
  console.log("readiness:");
  console.log("  calendar          " + r.total + " occasions, " + r.upcoming + " still ahead");
  console.log("  windows open now  " + r.openNow);
  console.log("  products          " + r.activeProducts + " active of " + r.products + (r.unbranded > 0 ? " (" + r.unbranded + " unbranded)" : ""));
  console.log("  brand voices      " + r.profiles);

  const empty = r.total === 0 || r.activeProducts === 0 || r.profiles === 0;
  if (empty) {
    console.error("");
    console.error("SOMETHING IS STILL EMPTY — the Content Studio will look broken. See the counts above.");
    process.exit(1);
  }
  console.log("");
  console.log("marketing data is in place.");
}

/**
 * Turn the one confusing failure into an instruction.
 *
 * The generated Prisma client is built from one schema, and prisma/schema.prisma is the
 * SQLite one. Point DATABASE_URL at Postgres without regenerating and the client rejects
 * it with "the URL must start with the protocol file:" — which says nothing about what to
 * do. The fix is one command, so say it.
 */
export function explain(e: unknown): string | null {
  const msg = String((e as { message?: string })?.message ?? e);
  if (/must start with the protocol `file:`/.test(msg) && /^postgres/.test(process.env.DATABASE_URL ?? "")) {
    return [
      "",
      "The Prisma client was generated from prisma/schema.prisma (SQLite) but DATABASE_URL is",
      "Postgres. Generate the Postgres client first, run the seed, then restore the local one:",
      "",
      "  pnpm exec prisma generate --schema prisma/schema.pg.prisma",
      "  DATABASE_URL=<postgres url> pnpm exec tsx scripts/seed-marketing-data.ts",
      "  pnpm exec prisma generate            # restore the SQLite client for local work",
    ].join("\n");
  }
  return null;
}

main().then(() => process.exit(0)).catch((e) => {
  const hint = explain(e);
  if (hint) { console.error(hint); process.exit(1); }
  console.error("ERROR", e);
  process.exit(1);
});
