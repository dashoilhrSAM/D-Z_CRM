// Apply the confirmed brand name and add its voice profile.
//
// The brand was left empty deliberately until the owner confirmed it: OCR reads the
// stylised wordmark as both DASHCIL and DASHOIL. Now confirmed as DASHOIL.
import { db } from "../src/lib/db";

/**
 * Backfill the confirmed brand on products and write its voice profile.
 *
 * Must run AFTER the product import, so the products exist to be branded — which is
 * exactly the ordering a single entry point exists to guarantee.
 */
export async function seedDashoilBrand() {
  const org = await db.organisation.findFirst();
  if (!org) throw new Error("no organisation");

  // 1. backfill the brand on every promo product
  const res = await db.promoProduct.updateMany({ where: { brand: null }, data: { brand: "DASHOIL" } });

  // 2. brand voice profile for the lubricant line (distinct from the workshop's)
  const data = {
    organisationId: org.id,
    key: "DASHOIL",
    name: "DASHOIL",
    tagline: "Minyak enjin yang jaga motosikal anda",
    voice:
      "Confident, technical-but-plain. Talks about the product like a knowledgeable rider " +
      "explaining why the right oil matters — not like an advert. Leads with the rider benefit " +
      "(engine protection, longer engine life, smoother pick-up, fuel saving) and only then names " +
      "the product. Bahasa Malaysia first, English technical terms (API, JASO, viscosity) kept in " +
      "their original form because riders and mechanics search by them. No hype, no exclamation " +
      "marks in every line.",
    primaryLanguage: "ms",
    languages: JSON.stringify(["ms", "en", "zh"]),
    audiences: JSON.stringify([
      "Riders who service their own motorcycle and choose their own oil",
      "Motorcycle workshop owners and mechanics who buy in bulk",
      "Daily commuters on kapcai and scooters",
      "Riders with performance or modified bikes who care about viscosity grades",
    ]),
    dos: JSON.stringify([
      "State the real viscosity, API and JASO rating exactly as printed on the label",
      "Explain what the rating means for the rider in plain words (JASO MA2 = wet clutch safe)",
      "Use the real product name and variant (E1300+ V2, not just 'E series')",
      "Mention the bottle size so buyers know what they are getting",
      "Compare grades usefully (10W40 vs 15W50 for Malaysian heat and traffic)",
    ]),
    donts: JSON.stringify([
      "Never invent a certification, award or test result",
      "Never claim a specific mileage or performance guarantee that is not on the label",
      "Never claim DASHOIL is better than a named competitor brand",
      "Do not present the Asia Honesty Product Award as anything other than what it is",
      "Never state a price that did not come from the system",
      "No absolute claims like 'tak akan rosak' or 'selamanya'",
    ]),
    samplePosts: JSON.stringify([
      "JASO MA2 tu apa? Ringkasnya — minyak ni selamat untuk clutch basah. Kalau motosikal anda clutch basah, guna minyak yang tak MA2 boleh buat clutch slip.",
      "10W40 atau 15W50? Kalau selalu jem dalam bandar, 10W40 lebih lancar masa enjin sejuk. 15W50 lebih sesuai untuk perjalanan jauh dan cuaca panas.",
      "Enjin yang sentiasa guna minyak berkualiti tak bunyi kasar masa 3,000 km. Yang murah, biasanya dah rasa lain macam.",
    ]),
    active: true,
  };

  const existing = await db.brandProfile.findUnique({
    where: { organisationId_key: { organisationId: org.id, key: "DASHOIL" } },
    select: { id: true },
  });
  let profile: "created" | "updated";
  if (existing) { await db.brandProfile.update({ where: { id: existing.id }, data }); profile = "updated"; }
  else { await db.brandProfile.create({ data }); profile = "created"; }

  const unbranded = await db.promoProduct.count({ where: { brand: null } });
  return { branded: res.count, unbranded, profile };
}

async function main() {
  const res = await seedDashoilBrand();
  console.log("promo products branded DASHOIL: " + res.branded + " (still unbranded: " + res.unbranded + ")");
  console.log("DASHOIL profile: " + res.profile);
  const brands = await db.promoProduct.groupBy({ by: ["brand"], _count: true });
  console.log("promo product brands:", brands.map((b) => (b.brand ?? "(null)") + ":" + b._count).join(", "));
  const profiles = await db.brandProfile.findMany({ select: { key: true, name: true } });
  console.log("brand profiles:", profiles.map((p) => p.key).join(", "));
}

// Only run when invoked directly, so importing the seed cannot have side effects.
const invokedDirectly = process.argv[1]?.endsWith("apply-dashoil-brand.ts") ?? false;
if (invokedDirectly) {
  main().then(() => process.exit(0)).catch((e) => { console.error("ERROR", e); process.exit(1); });
}
