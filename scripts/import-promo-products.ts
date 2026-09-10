// Import the DASHCIL/DASHOIL promotion-only product line.
//
// Facts here were read off the actual product labels with a vision model, so the
// content engine has real specs to work from instead of inventing them. Anything the
// model could not read confidently is left empty rather than guessed — notably `brand`,
// because the stylised wordmark reads ambiguously as both DASHCIL and DASHOIL.
import { db } from "../src/lib/db";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

interface Row {
  src: string; sku: string; name: string; category: string; series?: string; volume?: string;
  specs: Record<string, string | string[]>;
  sellingPoints: string[];
}

const ROWS: Row[] = [
  { src: "E300+",  sku: "E300",  name: "E300+ V2",  category: "ENGINE_OIL", series: "E", volume: "1L",   specs: { viscosity: "10W40", api: "API SP", jaso: "JASO MA2", type: "Synthetic Technology Motor Oil 4T", ester: "ESTER+" }, sellingPoints: ["Maximum Performance", "Maximum Protection", "Ester+ technology", "Asia Honesty Product Award 2022"] },
  { src: "E500+",  sku: "E500",  name: "E500+ V2",  category: "ENGINE_OIL", series: "E", volume: "1L",   specs: { viscosity: "15W50", api: "API SP", jaso: "JASO MA2", type: "Synthetic Technology Motor Oil 4T", ester: "ESTER+" }, sellingPoints: ["Maximum Performance", "Maximum Protection", "Ester+ technology", "Asia Honesty Product Award"] },
  { src: "E600+",  sku: "E600",  name: "E600+ V2",  category: "ENGINE_OIL", series: "E", volume: "1L",   specs: { viscosity: "10W40", api: "API SP", jaso: "JASO MA2", type: "100% Synthetic Race Motor Oil 4T", ester: "ESTER+" }, sellingPoints: ["100% Synthetic Race Motor Oil", "Maximum Performance", "Maximum Protection", "Asia Honesty Product Award"] },
  { src: "E700+",  sku: "E700",  name: "E700+ V2",  category: "ENGINE_OIL", series: "E", volume: "1L",   specs: { viscosity: "15W50", api: "API SP", jaso: "JASO MA2", type: "100% Synthetic Race Motor Oil 4T", ester: "ESTER+" }, sellingPoints: ["100% Synthetic Race Motor Oil", "Maximum Performance", "Maximum Protection", "Asia Honesty Product Award 2022"] },
  { src: "E900+",  sku: "E900",  name: "E900+ V2",  category: "ENGINE_OIL", series: "E", volume: "1L",   specs: { viscosity: "10W50", api: "API SP", jaso: "JASO MA2", type: "100% Synthetic Race Motor Oil", ester: "ESTER+" }, sellingPoints: ["100% Synthetic Race Motor Oil", "Maximum Performance", "Maximum Protection", "Ester+ technology"] },
  { src: "E1300+", sku: "E1300", name: "E1300+ V2", category: "ENGINE_OIL", series: "E", volume: "1.2L", specs: { viscosity: "10W40", api: "API SP", jaso: "JASO MA2", type: "Synthetic Technology Motor Oil 4T", ester: "ESTER+" }, sellingPoints: ["Maximum Performance", "Maximum Protection", "Ester+ technology", "Asia Honesty Product Award 2022 Asia's Best Choice"] },
  { src: "E1500+", sku: "E1500", name: "E1500+ V2", category: "ENGINE_OIL", series: "E", volume: "1.2L", specs: { viscosity: "15W50", api: "API SP", jaso: "JASO MA2", type: "Synthetic Technology Motor Oil 4T", ester: "ESTER+" }, sellingPoints: ["Maximum Performance", "Maximum Protection", "Ester+ technology", "Asia Honesty Product Award"] },
  { src: "E1600+", sku: "E1600", name: "E1600+ V2", category: "ENGINE_OIL", series: "E", volume: "1.2L", specs: { viscosity: "10W40", api: "API SP", jaso: "JASO MA2", type: "100% Synthetic Race Motor Oil 4T", ester: "ESTER+" }, sellingPoints: ["100% Synthetic Race Motor Oil", "Maximum Performance", "Maximum Protection", "Asia Honesty Product Award"] },
  { src: "E1700+", sku: "E1700", name: "E1700+ V2", category: "ENGINE_OIL", series: "E", volume: "1.2L", specs: { viscosity: "15W50", api: "API SP", jaso: "JASO MA2", type: "100% Synthetic Race Motor Oil 4T", ester: "ESTER+" }, sellingPoints: ["100% Synthetic Race Motor Oil", "Maximum Performance", "Maximum Protection", "Asia Honesty Product Award"] },
  { src: "H200",   sku: "H200",  name: "H200",      category: "ENGINE_OIL", series: "H", volume: "1L",   specs: { viscosity: "20W50", api: "API SL", jaso: "JASO MA2", type: "Premium Mineral Motor Oil 4T" }, sellingPoints: ["Premium Mineral Motor Oil", "Maximum Performance", "Maximum Protection", "Asia Honesty Product Award"] },
  { src: "H500",   sku: "H500",  name: "H500",      category: "ENGINE_OIL", series: "H", volume: "1L",   specs: { viscosity: "15W50", api: "API SN", jaso: "JASO MA2", type: "Synthetic Technology Motor Oil 4T" }, sellingPoints: ["Synthetic Technology", "Maximum Performance", "Maximum Protection", "Asia Honesty Product Award"] },
  { src: "H1300",  sku: "H1300", name: "H1300",     category: "ENGINE_OIL", series: "H", volume: "1.2L", specs: { viscosity: "10W40", api: "API SN", jaso: "JASO MA2", type: "Synthetic Technology Motor Oil 4T" }, sellingPoints: ["Synthetic Technology", "Better Mileage", "Better Lifespan", "Asia Honesty Product Award"] },
  { src: "S300",   sku: "S300",  name: "S300",      category: "SCOOTER_OIL", series: "S", volume: "0.9L", specs: { viscosity: "10W40", api: "API SN", jaso: "JASO MB", type: "Synthetic Technology Motor Oil 4AT" }, sellingPoints: ["Synthetic Technology", "Better Mileage", "Better Lifespan", "Asia Honesty Product Award 2022"] },
  { src: "S500+",  sku: "S500",  name: "S500+ V2",  category: "SCOOTER_OIL", series: "S", volume: "1L",   specs: { viscosity: "10W40", api: "API SP", jaso: "JASO MB", type: "Synthetic Technology Scooter Motor Oil 4AT", ester: "ESTER+" }, sellingPoints: ["Synthetic Technology", "Maximum Performance", "Maximum Protection", "Asia Honesty Product Award"] },
  { src: "S600+",  sku: "S600",  name: "S600+ V2",  category: "SCOOTER_OIL", series: "S", volume: "1L",   specs: { viscosity: "10W40", api: "API SP", jaso: "JASO MB", type: "100% Synthetic Scooter Motor Oil 4AT", ester: "ESTER+" }, sellingPoints: ["100% Synthetic", "Maximum Performance", "Maximum Protection", "Asia Honesty Product Award 2022"] },
  { src: "S800+",  sku: "S800",  name: "S800+ V2",  category: "SCOOTER_OIL", series: "S", volume: "1.5L", specs: { viscosity: "5W40", api: "API SP", jaso: "JASO MB", type: "100% Synthetic Scooter Motor Oil 4AT", ester: "ESTER+ X3" }, sellingPoints: ["100% Synthetic", "Ester+ X3", "Maximum Performance", "Maximum Protection", "Asia Honesty Product Award"] },
  { src: "R360+",  sku: "R360",  name: "R360+ V2",  category: "ENGINE_OIL", series: "R", volume: "1L",   specs: { viscosity: "10W60", api: "API SP", jaso: "JASO MA2", type: "Motor Oil 4T", ester: "ESTER+" }, sellingPoints: ["Maximum Performance", "Maximum Protection", "Ester+ technology", "Asia Honesty Product Award 2022 Asia's Best Choice"] },
  { src: "EF",     sku: "EF",    name: "Premium Engine Flush", category: "ADDITIVE", volume: "400ml", specs: { type: "Engine Flush" }, sellingPoints: ["Improve Fuel Efficiency", "Improve Acceleration Power", "Prolong Engine Lifespan"] },
  { src: "Gear Oil", sku: "GEAR-OIL", name: "Scooter Gear Oil", category: "GEAR_OIL", volume: "100ml", specs: { viscosity: "80W-90", type: "Gear Oil for Automatic Motorcycle", partNo: "DSGO80W90100ML" }, sellingPoints: ["Unique technology", "Prolong gearbox lifespan", "Maximum protection for the gearbox"] },
  { src: "COOL+",  sku: "COOL-PLUS", name: "COOL+ Premix Coolant", category: "COOLANT", volume: "1L", specs: { type: "Long-Life Coolant Premix", colour: "Amazing Blue" }, sellingPoints: ["Long-Life", "Amazing Blue", "Maximum Performance", "Maximum Protection", "Asia Honesty Product Award"] },
  { src: "Coolant red", sku: "COOLANT-RED", name: "Long-Life Coolant Premix (Red)", category: "COOLANT", volume: "1L", specs: { type: "Coolant Premix", partNo: "DPMC1LM" }, sellingPoints: ["Better Mileage", "Better Lifespan"] },
  { src: "Chain Lube", sku: "BP38", name: "BP38 Motorcycle Chain Lube", category: "CHAIN_LUBE", series: "BP", volume: "400ml", specs: { type: "Aerosol chain lube" }, sellingPoints: ["Reduces friction and loss of power", "Increases chain durability", "Water and rust resistant"] },
];

async function main() {
  const org = await db.organisation.findFirst();
  if (!org) throw new Error("no organisation");
  const outDir = path.join(process.cwd(), "public/products");
  mkdirSync(outDir, { recursive: true });

  let copied = 0, created = 0, updated = 0;
  for (const [i, r] of ROWS.entries()) {
    const srcFile = path.join("/tmp/dz-p/out-webp", r.src + ".webp");
    const destName = r.sku + ".webp";
    if (existsSync(srcFile)) { copyFileSync(srcFile, path.join(outDir, destName)); copied++; }
    else console.warn("  ! missing image for " + r.src);

    const data = {
      organisationId: org.id,
      name: r.name,
      sku: r.sku,
      brand: null as string | null,   // ambiguous on the label artwork — left for the owner
      category: r.category,
      series: r.series ?? null,
      volume: r.volume ?? null,
      imageUrl: "/products/" + destName,
      specs: r.specs as never,
      sellingPoints: JSON.stringify(r.sellingPoints),
      sortOrder: i,
      active: true,
    };
    const existing = await db.promoProduct.findUnique({ where: { sku: r.sku }, select: { id: true } });
    if (existing) { await db.promoProduct.update({ where: { sku: r.sku }, data }); updated++; }
    else { await db.promoProduct.create({ data }); created++; }
  }
  console.log("images copied: " + copied + "/" + ROWS.length);
  console.log("products created: " + created + ", updated: " + updated);
  const total = await db.promoProduct.count();
  console.log("PromoProduct rows now: " + total);
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERROR", e); process.exit(1); });
