// Seed brand voice profiles.
//
// This is the answer to "根据我们的内容": the model reads these instead of guessing a
// tone. Idempotent — safe to re-run after editing.
//
// The product-line profile is intentionally NOT seeded yet: the brand wordmark on the
// jugs reads ambiguously as both DASHCIL and DASHOIL under OCR, and inventing the
// company's own brand name would be exactly the kind of fabrication this system is
// built to prevent. Only the workshop profile is seeded.
import { db } from "../src/lib/db";

interface Seed {
  key: string; name: string; tagline: string; voice: string;
  primaryLanguage: string; languages: string[]; audiences: string[];
  dos: string[]; donts: string[]; samplePosts: string[];
}

const PROFILES: Seed[] = [
  {
    key: "DZ_WORKSHOP",
    name: "D&Z Smart Workshop",
    tagline: "Servis motosikal yang anda boleh percaya",
    voice:
      "Friendly, direct, zero jargon. Sounds like a trusted mechanic explaining something to a friend " +
      "(abang / boss). Practical and reassuring, never pushy or salesy. Short sentences. Everyday Bahasa " +
      "Malaysia with the English words Malaysian riders already use (servis, brake, oil, mileage). " +
      "Leads with the rider's benefit — safety, fuel saving, engine life — not with the product.",
    primaryLanguage: "ms",
    languages: ["ms", "en", "zh"],
    audiences: [
      "Riders in the Klang Valley who service their motorcycle regularly",
      "Scooter commuters riding daily to work",
      "Riders who just bought a used bike and want peace of mind",
      "Existing customers who are due for their next service",
    ],
    dos: [
      "Use real service prices and package names from the system — never estimate",
      "Name the concrete benefit to the rider (safety, fuel, engine life, resale value)",
      "Keep captions short enough for a 15-second video",
      "Write in everyday Bahasa Malaysia, not formal written Malay",
      "Give one clear call to action (book a slot, WhatsApp us, drop by the workshop)",
    ],
    donts: [
      "Never invent prices, product specs, certifications or warranty terms",
      "Never promise a repair outcome that depends on physical inspection",
      "Never disparage other workshops or competing brands",
      "No fake urgency, countdown pressure or hard-sell tactics",
      "Never claim a product is certified or approved unless the label literally says so",
      "Do not use the word 'murah' as the main hook — compete on trust and quality, not price",
    ],
    samplePosts: [
      "Motosikal awak dah berapa lama tak servis? Kalau dah lebih 3,000 km, minyak hitam tu dah tak boleh jaga enjin macam sepatutnya.",
      "Sebelum balik kampung, check brake dulu. 5 minit pemeriksaan boleh selamatkan seluruh perjalanan.",
      "Tayar botak bukan sekadar tak selesa — ia hilang cengkaman masa hujan. Jom check tread depth.",
    ],
  },
];

async function main() {
  const org = await db.organisation.findFirst();
  if (!org) throw new Error("no organisation");
  let created = 0, updated = 0;
  for (const p of PROFILES) {
    const data = {
      organisationId: org.id,
      key: p.key,
      name: p.name,
      tagline: p.tagline,
      voice: p.voice,
      primaryLanguage: p.primaryLanguage,
      languages: JSON.stringify(p.languages),
      audiences: JSON.stringify(p.audiences),
      dos: JSON.stringify(p.dos),
      donts: JSON.stringify(p.donts),
      samplePosts: JSON.stringify(p.samplePosts),
      active: true,
    };
    const existing = await db.brandProfile.findUnique({ where: { organisationId_key: { organisationId: org.id, key: p.key } }, select: { id: true } });
    if (existing) { await db.brandProfile.update({ where: { id: existing.id }, data }); updated++; }
    else { await db.brandProfile.create({ data }); created++; }
  }
  console.log("brand profiles created: " + created + ", updated: " + updated);
  const all = await db.brandProfile.findMany({ select: { key: true, name: true, primaryLanguage: true } });
  for (const b of all) console.log("  " + b.key.padEnd(14) + b.name + " (" + b.primaryLanguage + ")");
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERROR", e); process.exit(1); });
