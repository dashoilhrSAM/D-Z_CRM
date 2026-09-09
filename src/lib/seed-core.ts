// D&Z demo seed — deterministic, anchored to today (18 Aug 2026).
// Usage: pnpm db:seed  |  UI "RESET DEMO DATA" |  pnpm db:reset
import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";

const prisma = new PrismaClient();

// ---------- helpers ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260818);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const genQr = () => Array.from({ length: 16 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(rand() * 36)]).join("");
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const RM = (n: number) => Math.round(n * 100);
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000);
const daysFromNow = (d: number) => new Date(Date.now() + d * 86400000);
/** 业务日期（UTC 零点 + n 天）：预约/时段等"日期"字段存时区无关的 UTC 零点。 */
const utcDay = (n: number) => new Date(new Date(Date.now() + n * 86400000).toISOString().slice(0, 10) + "T00:00:00Z");
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000);
const sum = (arr: number[]) => arr.reduce((s, n) => s + n, 0);

const FIRST = ["Ahmad", "Muhammad", "Nurul", "Aisyah", "Hafiz", "Farah", "Syafiq", "Aiman", "Izwan", "Siti", "Zainal", "Raj", "Lim", "Tan", "Wong", "Devi", "Kumar", "Meera", "Arif", "Firdaus", "Izzah", "Danish", "Aqil", "Haziq", "Faiz", "Nadia", "Zara", "Amir", "Hakim", "Ilham", "Qistina", "Adam", "Fatin", "Wafi", "Zul", "Azlan", "Shahrul", "Yusof", "Ridzuan", "Anis", "Shazwan", "Fikri", "Amirah", "Nabil", "Zarif", "Husna", "Ikhwan", "Farid", "Syazana", "Melissa"];
const LAST = ["bin Abdullah", "bin Ismail", "bin Hassan", "bin Osman", "binti Ahmad", "bin Rahman", "bin Yusof", "binti Salleh", "a/l Raju", "a/l Kumar", "a/p Lee", "a/l Tan", "bin Ramli", "bin Bakar", "a/p Wong", "bin Hamid", "binti Zain", "bin Karim", "a/p Devi", "bin Omar", "bin Saad", "binti Hashim", "bin Aziz", "bin Khalid", "a/p Chong"];
const PHONE_PRE = ["012", "013", "014", "016", "017", "018", "019", "011"];
const PLATE_PRE = ["WXY", "JKL", "BQE", "WWW", "VLL", "PRH", "JMR", "JQY", "KFX", "BSS", "WUL", "VKM"];
// [brand, model, year, motorcycleTypeKey] — type aligned to lib/motorcycle-types (market taxonomy 2026)
const BIKE_MODELS: [string, string, number, string][] = [
  ["Yamaha", "Y15ZR", 2019, "UNDERBONE"], ["Yamaha", "Y16ZR", 2021, "UNDERBONE"], ["Yamaha", "LC135 V1", 2016, "UNDERBONE"], ["Yamaha", "LC135 V2 - V7", 2018, "UNDERBONE"], ["Yamaha", "LC135 V8", 2021, "UNDERBONE"], ["Yamaha", "EX5", 2015, "UNDERBONE"],
  ["Yamaha", "NMAX155", 2022, "SCOOTER"], ["Yamaha", "XMAX250", 2023, "PREMIUM_SCOOTER"], ["Honda", "RS150R", 2020, "UNDERBONE"], ["Honda", "EX5 Dream", 2017, "UNDERBONE"],
  ["Honda", "PCX160", 2022, "SCOOTER"], ["Honda", "C70", 2014, "MODERN_CLASSIC"], ["Honda", "WAVE125", 2019, "UNDERBONE"], ["Modenas", "KRV150", 2023, "SCOOTER"],
  ["Modenas", "Elegan 150", 2016, "PREMIUM_SCOOTER"], ["Modenas", "Pulsar NS200", 2021, "NAKED"], ["Kawasaki", "Ninja 250", 2019, "SPORT"],
  ["Kawasaki", "Z900RS", 2023, "NAKED"], ["Suzuki", "GSX-R150", 2021, "SPORT"], ["Suzuki", "AVG125", 2020, "SCOOTER"], ["KTM", "Duke 200", 2022, "NAKED"],
  ["Benelli", "TNT15", 2018, "NAKED"], ["Vespa", "Primavera 150", 2022, "SCOOTER"], ["Yamaha", "FZ150i", 2019, "NAKED"], ["Honda", "Scoopy", 2021, "LIFESTYLE_CUB"],
  ["SYM", "VTS200", 2017, "SCOOTER"],
];
// Service labels aligned to lib/service-catalog (market taxonomy 2026) — booking serviceType strings
const SERVICE_TYPES = ["Engine Oil Change", "Oil Filter Replacement", "CVT Service (Belt & Rollers)", "Chain & Sprocket Service", "Tyre Replacement", "Brake Pad Replacement", "Brake Fluid Flush", "Battery Test / Replacement", "Air Filter Service", "Spark Plug Replacement", "Coolant Replacement", "General Checkup"];

// product table: [name, sku, category, brand, sellRM, costRM, minStock, leadDays, supplierIdx]
const PRODUCTS: [string, string, string, string, number, number, number, number, number][] = [
  ["Motul 5100 10W-40 4T 1L", "MOT-5100", "ENGINE_OIL", "Motul", 38, 28, 12, 3, 4],
  ["Shell Advance Ultra 10W-40 1L", "SHELL-ULTRA", "ENGINE_OIL", "Shell", 45, 34, 10, 3, 4],
  ["Castrol Power1 10W-40 1L", "CAST-P1", "ENGINE_OIL", "Castrol", 35, 26, 12, 3, 4],
  ["Liqui Moly Street 10W-40 1L", "LM-STREET", "ENGINE_OIL", "Liqui Moly", 48, 36, 8, 4, 4],
  ["Yamalube 10W-40 1L", "YAMA-LUBE", "ENGINE_OIL", "Yamaha", 32, 24, 15, 2, 3],
  ["Motul 300V 10W-40 1L", "MOT-300V", "ENGINE_OIL", "Motul", 95, 72, 6, 4, 4],
  ["Idemitsu Zepro 10W-40 1L", "IDE-ZEPRO", "ENGINE_OIL", "Idemitsu", 33, 25, 10, 3, 4],
  ["Petronas Sprinta F900 10W-40", "PET-F900", "ENGINE_OIL", "Petronas", 36, 27, 10, 3, 4],
  ["Maxima Racing 4T 10W-40", "MAX-4T", "ENGINE_OIL", "Maxima", 52, 40, 8, 4, 4],
  ["Pennzoil Platinum 10W-40", "PEN-PLAT", "ENGINE_OIL", "Pennzoil", 40, 30, 8, 3, 4],
  ["Yamaha Genuine Oil Filter", "YAM-OF", "FILTER", "Yamaha", 25, 12, 15, 2, 3],
  ["Honda Genuine Oil Filter", "HON-OF", "FILTER", "Honda", 22, 11, 12, 2, 3],
  ["NGK Spark Plug (CR7HSA)", "NGK-CR7", "SPARK", "NGK", 18, 9, 10, 3, 1],
  ["NGK Iridium (CR8EIX)", "NGK-CR8EIX", "SPARK", "NGK", 45, 28, 8, 3, 1],
  ["K&N Air Filter", "KN-AIR", "FILTER", "K&N", 85, 55, 5, 5, 1],
  ["Yamaha Air Filter", "YAM-AF", "FILTER", "Yamaha", 35, 18, 8, 2, 3],
  ["Malossi Air Filter", "MAL-AF", "FILTER", "Malossi", 42, 25, 6, 4, 1],
  ["Brembo Brake Pad (front)", "BRE-PAD-F", "BRAKE", "Brembo", 160, 95, 6, 4, 1],
  ["EBC Brake Pad (rear)", "EBC-PAD-R", "BRAKE", "EBC", 120, 70, 6, 4, 1],
  ["Yamaha Genuine Brake Pad", "YAM-BP", "BRAKE", "Yamaha", 65, 38, 10, 2, 3],
  ["Brake Disc 260mm", "BRK-DISC", "BRAKE", "Brembo", 240, 140, 4, 5, 1],
  ["Brake Fluid DOT4 500ml", "BRK-FLUID", "BRAKE", "Castrol", 28, 15, 8, 3, 4],
  ["Brake Lever (set)", "BRK-LEVER", "BRAKE", "Brembo", 45, 25, 8, 4, 1],
  ["DID Chain 428VX (set)", "DID-428", "CHAIN", "DID", 210, 120, 5, 5, 2],
  ["RK Chain 428 (set)", "RK-428", "CHAIN", "RK", 180, 105, 5, 5, 2],
  ["Sprocket Set 14/38T", "SPR-1438", "CHAIN", "DID", 170, 95, 5, 5, 2],
  ["Chain Lube 400ml", "CHN-LUBE", "CHAIN", "Motul", 25, 12, 15, 3, 4],
  ["Chain Adjuster (pair)", "CHN-ADJ", "CHAIN", "RK", 35, 18, 8, 4, 2],
  ["Michelin Pilot Street (front)", "MIC-PS-F", "TYRE", "Michelin", 190, 110, 6, 5, 0],
  ["Michelin Pilot Street (rear)", "MIC-PS-R", "TYRE", "Michelin", 220, 130, 6, 5, 0],
  ["Pirelli Diablo Rosso (rear)", "PIR-DR-R", "TYRE", "Pirelli", 390, 240, 4, 6, 0],
  ["Bridgestone Battlax BT39 (rear)", "BRG-BT39-R", "TYRE", "Bridgestone", 340, 200, 4, 6, 0],
  ["Dunlop TT900 (front)", "DUN-TT900-F", "TYRE", "Dunlop", 150, 85, 5, 5, 0],
  ["Dunlop TT900 (rear)", "DUN-TT900-R", "TYRE", "Dunlop", 175, 100, 5, 5, 0],
  ["Maxxis M6029 (front)", "MAX-M6029-F", "TYRE", "Maxxis", 120, 70, 5, 5, 0],
  ["Maxxis M6029 (rear)", "MAX-M6029-R", "TYRE", "Maxxis", 145, 85, 5, 5, 0],
  ["Yuasa YTX7L-BS", "YUA-YTX7", "BATTERY", "Yuasa", 165, 110, 6, 4, 2],
  ["GS GTX7A-BS", "GS-GTX7", "BATTERY", "GS", 150, 100, 6, 4, 2],
  ["YTZ7S (lithium)", "YTZ7-LI", "BATTERY", "Yuasa", 320, 240, 4, 5, 2],
  ["Battery Charger 12V", "BATT-CHG", "BATTERY", "CTEK", 88, 55, 5, 4, 2],
  ["Yamaha Genuine CVT Belt", "YAM-CVT", "CVT", "Yamaha", 145, 90, 12, 2, 3],
  ["Roller Weights 6g (set)", "CVT-ROLL", "CVT", "Malossi", 35, 18, 10, 4, 1],
  ["Malossi CVT Belt", "MAL-CVT", "CVT", "Malossi", 180, 115, 6, 4, 1],
  ["Drive Face", "CVT-FACE", "CVT", "Malossi", 120, 75, 5, 4, 1],
  ["CVT Cleaning Kit", "CVT-KIT", "CVT", "Motul", 28, 12, 12, 3, 4],
  ["LED Headlamp H4", "LED-H4", "ELECTRICAL", "Philips", 68, 38, 8, 4, 1],
  ["LED Signal Light (pair)", "LED-SIG", "ELECTRICAL", "Philips", 32, 16, 10, 4, 1],
  ["Horn 12V (pair)", "HORN-12V", "ELECTRICAL", "Bosch", 18, 8, 12, 3, 1],
  ["Rectifier / Regulator", "REC-REG", "ELECTRICAL", "Shindengen", 75, 45, 6, 4, 1],
  ["Wiring Harness (starter)", "WIRE-ST", "ELECTRICAL", "Yamaha", 55, 30, 6, 3, 3],
  ["Bulb T10 (pack of 4)", "BULB-T10", "ELECTRICAL", "Osram", 12, 5, 20, 3, 1],
  ["Phone Mount", "PHN-MOUNT", "ACCESSORY", "Quad Lock", 45, 25, 8, 4, 2],
  ["Handlebar Grips (black)", "GRIP-BLK", "ACCESSORY", "Progrip", 18, 9, 12, 3, 2],
  ["Handlebar Grips (red)", "GRIP-RED", "ACCESSORY", "Progrip", 18, 9, 12, 3, 2],
  ["Side Mirror (pair)", "MIRROR-PR", "ACCESSORY", "D&Z", 30, 15, 15, 3, 2],
  ["Helmet Lock", "HELM-LOCK", "ACCESSORY", "D&Z", 20, 10, 15, 3, 2],
  ["Tank Bag 8L", "TANK-BAG", "ACCESSORY", "Oxford", 120, 75, 5, 5, 2],
  ["USB Charger Kit", "USB-KIT", "ACCESSORY", "Quad Lock", 55, 32, 8, 4, 2],
  ["Chain Guard", "CHN-GUARD", "ACCESSORY", "Yamaha", 25, 12, 8, 3, 3],
  ["Front Fender Extender", "FND-EXT", "ACCESSORY", "D&Z", 40, 22, 8, 3, 2],
  ["Rear Rack", "REAR-RACK", "ACCESSORY", "Givi", 95, 60, 6, 5, 2],
  ["Coolant 1L", "COOL-1L", "COOLANT", "Maxima", 22, 10, 12, 3, 4],
  ["Coolant Premium (blue) 1L", "COOL-BLUE", "COOLANT", "Motul", 28, 14, 10, 3, 4],
  ["Chain Cleaner 400ml", "CHN-CLN", "COOLANT", "Motul", 22, 10, 12, 3, 4],
  ["Brake Cleaner 400ml", "BRK-CLN", "COOLANT", "Motul", 18, 8, 12, 3, 4],
  ["Degreaser 1L", "DEG-1L", "COOLANT", "D&Z", 20, 9, 10, 3, 2],
  ["Water Wetter 250ml", "WTR-WET", "COOLANT", "Redline", 35, 20, 6, 4, 4],
  ["Spark Plug Socket Set", "TOOL-SP", "GENERAL", "King Tony", 55, 30, 6, 4, 2],
  ["Air Pump 12V", "PUMP-12V", "GENERAL", "D&Z", 65, 38, 8, 4, 2],
  ["Tyre Repair Kit", "TYRE-KIT", "GENERAL", "D&Z", 25, 12, 15, 3, 2],
  ["Valve Caps (set)", "VALVE-CAP", "GENERAL", "D&Z", 8, 3, 25, 3, 2],
  ["Number Plate Frame", "PLATE-FR", "GENERAL", "D&Z", 15, 6, 20, 3, 2],
  ["Oil Drain Plug", "DRAIN-PLUG", "GENERAL", "Yamaha", 10, 4, 15, 3, 3],
  ["Oil Filter Wrench", "TOOL-OFW", "GENERAL", "King Tony", 22, 10, 10, 4, 2],
  ["Funnel Set", "TOOL-FUN", "GENERAL", "D&Z", 18, 7, 12, 3, 2],
  ["Seat Cover (black)", "SEAT-CVR", "ACCESSORY", "D&Z", 68, 40, 8, 3, 2],
  ["Fuel Injector Cleaner", "FUEL-CLN", "COOLANT", "Redline", 38, 20, 8, 4, 4],
  ["Carburetor Cleaner", "CARB-CLN", "COOLANT", "D&Z", 24, 11, 10, 3, 2],
  ["Two-Stroke Oil 1L", "2T-OIL", "ENGINE_OIL", "Castrol", 30, 18, 10, 3, 4],
  ["Chain Sprocket Cover", "SPR-CVR", "CHAIN", "Yamaha", 45, 24, 6, 3, 3],
  ["Kick Start Lever", "KICK-LVR", "GENERAL", "Yamaha", 35, 18, 8, 3, 3],
  ["Tool Kit (universal)", "TOOL-KIT", "GENERAL", "King Tony", 85, 50, 6, 4, 2],
];

const SUPPLIERS = [
  { name: "TyreZone Malaysia", contact: "Danny Ho", phone: "03-9012 4455", lead: 5 },
  { name: "PartsPro Trading", contact: "Ramesh a/l Nathan", phone: "03-7788 1200", lead: 4 },
  { name: "Sunrise Lubricants", contact: "Koh Mei Ling", phone: "03-3344 9087", lead: 2 },
  { name: "OilMax Distribution", contact: "Azmi bin Karim", phone: "03-5566 2211", lead: 3 },
  { name: "Bateri Kedah Sdn Bhd", contact: "Suresh a/l Pillay", phone: "04-733 8899", lead: 3 },
];

export async function runSeed(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const org = await prisma.organisation.create({ data: { name: "D&Z Smart Workshop", currency: "MYR", qrToken: genQr() } });
  const branches = [];
  for (const [i, b] of ([
    { name: "D&Z Smart Workshop", city: "Kuala Lumpur", isMain: true },
  ] as const).entries()) {
    branches.push(await prisma.branch.create({ data: { organisationId: org.id, name: b.name, city: b.city, isMain: b.isMain, phone: "03-78" + int(1000, 9999), address: "No. " + int(1, 99) + ", Jalan " + b.city.split(" ")[0] + " Utama" } }));
  }
  const kl = branches[0];

  // staff
  const staffDefs: [string, string, string][] = [
    ["Daniel Tan", "OWNER", "012-881 2200"],
    ["Syafiq bin Rahman", "MANAGER", "012-334 5566"],
    ["Mei Ling Wong", "COUNTER_STAFF", "016-220 1188"],
    ["Aizat bin Ismail", "MECHANIC", "013-556 7788"],
    ["Hafiz bin Hassan", "MECHANIC", "017-889 0011"],
    ["Ravi a/l Kumar", "MECHANIC", "019-334 5566"],
    ["Priya a/p Lee", "MARKETING", "018-223 4455"],
    ["Wei Kit Tan", "INVENTORY", "012-998 7766"],
  ];
  const staff: Record<string, string> = {};
  for (const [name, role, phone] of staffDefs) {
    const u = await prisma.user.create({ data: { organisationId: org.id, branchId: kl.id, name, role: role as never, phone, email: name.toLowerCase().replace(/[^a-z]+/g, ".") + "@dz.my" } });
    staff[name.split(" ")[0]] = u.id;
  }

  // suppliers
  const supplierIds: string[] = [];
  for (const s of SUPPLIERS) {
    const sup = await prisma.supplier.create({ data: { organisationId: org.id, name: s.name, contactName: s.contact, phone: s.phone, leadTimeDays: s.lead } });
    supplierIds.push(sup.id);
  }

  // products + KL inventory
  const productIds: Record<string, string> = {};
  const bySku: Record<string, string> = {};
  // product photos (public/products/<sku>.png) for the 10 catalogue SKUs
  const PRODUCT_IMAGES: Record<string, string> = {
    "BRK-DISC": "/products/BRK-DISC.png", "BATT-CHG": "/products/BATT-CHG.png", "BRG-BT39-R": "/products/BRG-BT39-R.png",
    "CARB-CLN": "/products/CARB-CLN.png", "BULB-T10": "/products/BULB-T10.png", "BRK-FLUID": "/products/BRK-FLUID.png",
    "BRE-PAD-F": "/products/BRE-PAD-F.png", "BRK-LEVER": "/products/BRK-LEVER.png", "BRK-CLN": "/products/BRK-CLN.png",
    "CVT-KIT": "/products/CVT-KIT.png",
  };
  for (const [name, sku, cat, brand, sell, cost, min, lead, sup] of PRODUCTS) {
    const p = await prisma.product.create({
      data: { organisationId: org.id, name, sku, category: cat, brand, sellPriceSen: RM(sell), costPriceSen: RM(cost), minStock: min, safetyStock: Math.ceil(min / 3), leadTimeDays: lead, supplierId: supplierIds[sup], imageUrl: PRODUCT_IMAGES[sku] ?? null },
    });
    productIds[name] = p.id;
    bySku[sku] = p.id;
  }

  // KL inventory quantities — tune: 4 CRITICAL, several LOW, dead stock list
  const klQty: Record<string, number> = {};
  for (const p of PRODUCTS) klQty[p[1]] = int(14, 60);
  // CRITICAL (qty <= minStock/2)
  klQty["NGK-CR7"] = 3; klQty["BRK-FLUID"] = 2; klQty["YAM-CVT"] = 4; klQty["YAM-AF"] = 3;
  // LOW (qty <= minStock)
  klQty["MOT-300V"] = 5; klQty["PIR-DR-R"] = 3; klQty["BRG-BT39-R"] = 3; klQty["YTZ7-LI"] = 3; klQty["BRK-DISC"] = 3;
  klQty["DID-428"] = 4; klQty["MAL-CVT"] = 5; klQty["KN-AIR"] = 4; klQty["SEAT-CVR"] = 6; klQty["REAR-RACK"] = 5; klQty["TOOL-KIT"] = 5;
  // dead stock (used in jobs older than 60 days, then not sold)
  klQty["HELM-LOCK"] = 12; klQty["PHN-MOUNT"] = 6; klQty["GRIP-RED"] = 10; klQty["TANK-BAG"] = 5;
  klQty["VALVE-CAP"] = 20; klQty["SEAT-CVR"] = 5; klQty["REAR-RACK"] = 4; klQty["TOOL-KIT"] = 5;
  klQty["PUMP-12V"] = 5; klQty["MIRROR-PR"] = 12; klQty["CARB-CLN"] = 15; klQty["FND-EXT"] = 6; klQty["GRIP-BLK"] = 17;
  for (const [name, sku] of PRODUCTS.map((p) => [p[0], p[1]] as [string, string])) {
    await prisma.inventory.create({ data: { branchId: kl.id, productId: bySku[sku], quantity: klQty[sku] ?? int(14, 60) } });
  }
  // (other branches removed — only KL main)
  counts.products = PRODUCTS.length;

  // one DRAFT purchase order (demo: receive button on the PO page stocks these lines in)
  {
    const po = await prisma.purchaseOrder.create({ data: { branchId: kl.id, supplierId: supplierIds[0], status: "DRAFT", expectedAt: daysFromNow(2), totalSen: RM(180) } });
    const poLines: [string, number, number][] = [
      ["NGK Spark Plug (CR7HSA)", 10, 9],   // CRITICAL item
      ["Yamaha Genuine Oil Filter", 12, 6], // fast mover
      ["Yamalube 10W-40 1L", 6, 24],        // service oil
    ];
    for (const [name, qty, unitRM] of poLines) {
      await prisma.purchaseOrderItem.create({ data: { purchaseOrderId: po.id, productId: productIds[name], quantity: qty, unitCostSen: RM(unitRM), lineTotalSen: RM(unitRM) * qty } });
    }
  }

  // service packages
  const pkgOil = productIds["Yamalube 10W-40 1L"];
  const pkgFilter = productIds["Yamaha Genuine Oil Filter"];
  const pkgSpark = productIds["NGK Spark Plug (CR7HSA)"];
  const pkgAir = productIds["Yamaha Air Filter"];
  const basic = await prisma.servicePackage.create({ data: { branchId: kl.id, name: "Basic Service", tier: "GOOD", priceSen: RM(60), description: "Engine oil + brake check + inspection + chain lube.", items: { create: [
    { name: "Engine Oil", kind: "PART", productId: pkgOil, defaultQty: 1, priceSen: 0 },
    { name: "Brake Check", kind: "SERVICE", defaultQty: 1, priceSen: 0 },
    { name: "Inspection", kind: "SERVICE", defaultQty: 1, priceSen: 0 },
    { name: "Chain Lube", kind: "SERVICE", defaultQty: 1, priceSen: 0 },
  ] } } });
  const standard = await prisma.servicePackage.create({ data: { branchId: kl.id, name: "Standard Service", tier: "BETTER", priceSen: RM(120), description: "Engine oil + CVT cleaning + brake check + inspection + wash & polish. Oil filter recommended at counter.", items: { create: [
    { name: "Engine Oil", kind: "PART", productId: pkgOil, defaultQty: 1, priceSen: 0 },
    { name: "CVT Cleaning", kind: "SERVICE", defaultQty: 1, priceSen: 0 },
    { name: "Brake Check", kind: "SERVICE", defaultQty: 1, priceSen: 0 },
    { name: "Inspection", kind: "SERVICE", defaultQty: 1, priceSen: 0 },
    { name: "Wash & Polish", kind: "SERVICE", defaultQty: 1, priceSen: 0 },
  ] } } });
  const premium = await prisma.servicePackage.create({ data: { branchId: kl.id, name: "Premium Service", tier: "BEST", priceSen: RM(180), description: "Full service: engine oil, oil filter, spark plug, air filter, CVT cleaning, brake check, chain adjustment, inspection, wash & polish.", isBestValue: true, items: { create: [
    { name: "Engine Oil", kind: "PART", productId: pkgOil, defaultQty: 1, priceSen: 0 },
    { name: "Oil Filter", kind: "PART", productId: pkgFilter, defaultQty: 1, priceSen: 0 },
    { name: "Spark Plug", kind: "PART", productId: pkgSpark, defaultQty: 1, priceSen: 0 },
    { name: "Air Filter", kind: "PART", productId: pkgAir, defaultQty: 1, priceSen: 0 },
    { name: "CVT Cleaning", kind: "SERVICE", defaultQty: 1, priceSen: 0 },
    { name: "Brake Check", kind: "SERVICE", defaultQty: 1, priceSen: 0 },
    { name: "Chain Adjustment", kind: "SERVICE", defaultQty: 1, priceSen: 0 },
    { name: "Inspection", kind: "SERVICE", defaultQty: 1, priceSen: 0 },
    { name: "Wash & Polish", kind: "SERVICE", defaultQty: 1, priceSen: 0 },
  ] } } });
  const packages = { BASIC: basic, STANDARD: standard, PREMIUM: premium };

  // checklist template
  const template = await prisma.checklistTemplate.create({ data: { name: "Standard Inspection", isDefault: true, items: { create: [
    { name: "Engine Oil", order: 1 }, { name: "Oil Filter", order: 2 }, { name: "Brake", order: 3 },
    { name: "Chain", order: 4 }, { name: "Tyres", order: 5 }, { name: "Coolant", order: 6 },
    { name: "Electrical", order: 7 }, { name: "Lights", order: 8 }, { name: "Final Inspection", order: 9 },
    { name: "Test Ride", order: 10 },
  ] } } });

  // ---------- customers ----------
  const customers: { id: string; name: string; phone: string; joined: Date }[] = [];
  const usedPhones = new Set<string>();
  const usedPlates = new Set<string>();
  const bikeIds: { id: string; customerId: string; brand: string; model: string; plate: string; year: number; type: string; mileage: number }[] = [];
  const makePhone = () => {
    let p = pick(PHONE_PRE) + "-" + int(100, 999) + " " + int(1000, 9999);
    while (usedPhones.has(p)) p = pick(PHONE_PRE) + "-" + int(100, 999) + " " + int(1000, 9999);
    usedPhones.add(p);
    return p;
  };
  const makePlate = () => {
    let p = pick(PLATE_PRE) + " " + int(1000, 9999);
    while (usedPlates.has(p)) p = pick(PLATE_PRE) + " " + int(1000, 9999);
    usedPlates.add(p);
    return p;
  };

  for (let i = 0; i < 102; i++) {
    const name = pick(FIRST) + " " + pick(LAST);
    const joined = new Date(2018 + int(0, 7), int(0, 11), int(1, 28));
    const c = await prisma.customer.create({
      data: {
        qrToken: genQr(),
        organisationId: org.id, branchId: kl.id,
        name, phone: makePhone(),
        gender: pick(["M", "M", "M", "F", "F"]),
        joinedAt: joined,
        source: pick(["WALK_IN", "RIDER_APP", "REFERRAL", "FACEBOOK", "GOOGLE"]),
        address: "No. " + int(1, 200) + ", Jalan " + pick(["Meranti", "Cempaka", "Perak", "Ampang", "Setia", "Bahagia"]) + " " + int(1, 40) + ", " + pick(["Cheras", "Bangsar", "Setapak", "Puchong", "Ampang", "Shah Alam", "Johor Bahru"]),
      },
    });
    customers.push({ id: c.id, name, phone: c.phone!, joined });
  }

  // Ahmad Danial — the demo customer (§49-50)
  const ahmad = await prisma.customer.create({
    data: {
      qrToken: genQr(),
      organisationId: org.id, branchId: kl.id, name: "Ahmad Danial", phone: "012-345 6789",
      gender: "M", joinedAt: new Date(2019, 2, 14), source: "RIDER_APP",
      address: "No. 12, Jalan Cempaka 3, Cheras", notes: "Rider app user. Prefers Standard Service.",
    },
  });
  const ahmadBike = await prisma.motorcycle.create({
    data: {
      qrToken: genQr(),
      customerId: ahmad.id, brand: "Yamaha", model: "Y15ZR", year: 2019, type: "UNDERBONE", plate: "WXY 8812",
      color: "Black", vin: "MH3RG15V0KJ0" + int(10000, 99999),
      currentMileage: 31800,
      lastServiceDate: daysAgo(92), lastServiceMileage: 28500,
      lastOilChangeMileage: 28500, lastOilFilterMileage: 26600,
      nextServiceMileage: 31500, nextServiceEstDate: daysAgo(0),
    },
  });
  bikeIds.push({ id: ahmadBike.id, customerId: ahmad.id, brand: "Yamaha", model: "Y15ZR", plate: "WXY 8812", year: 2019, type: "UNDERBONE", mileage: 31800 });
  customers.push({ id: ahmad.id, name: "Ahmad Danial", phone: "012-345 6789", joined: new Date(2019, 2, 14) });
  await prisma.customerAuthProfile.create({ data: { customerId: ahmad.id, pin: "1234", phoneVerified: true } });

  // other motorcycles (129 more, never Ahmad — demo customer keeps exactly 1 bike)
  for (let i = 0; i < 129; i++) {
    let cand = customers[int(0, customers.length - 1)];
    while (cand.id === ahmad.id) cand = customers[int(0, customers.length - 1)];
    const cust = cand;
    const [brand, model, year, typeKey] = pick(BIKE_MODELS);
    const mileage = int(500, 52000);
    const m = await prisma.motorcycle.create({
      data: {
        qrToken: genQr(),
        customerId: cust.id, brand, model, year, type: typeKey, plate: makePlate(),
        color: pick(["Black", "Red", "Blue", "White", "Grey", "Silver"]),
        currentMileage: mileage,
        lastServiceMileage: Math.max(0, mileage - int(0, 5000)),
        nextServiceMileage: mileage + 3000,
      },
    });
    bikeIds.push({ id: m.id, customerId: cust.id, brand, model, plate: m.plate, year, type: typeKey, mileage });
  }
  // a few customers with 2-3 bikes (never Ahmad — demo customer keeps exactly 1)
  for (let i = 0; i < 5; i++) {
    let cand = customers[int(0, customers.length - 1)];
    while (cand.id === ahmad.id) cand = customers[int(0, customers.length - 1)];
    const cust = cand;
    for (let k = 0; k < int(1, 2); k++) {
      const [brand, model, year, typeKey] = pick(BIKE_MODELS);
      const m = await prisma.motorcycle.create({
        data: { customerId: cust.id, brand, model, year, type: typeKey, plate: makePlate(), color: pick(["Black", "Red", "Blue"]), currentMileage: int(500, 20000) },
      });
      bikeIds.push({ id: m.id, customerId: cust.id, brand, model, plate: m.plate, year, type: typeKey, mileage: m.currentMileage });
    }
  }

  // ---------- jobs ----------
  const jobNumbers: string[] = [];
  let jobSeq = 0;
  const nextJobNumber = () => "DZ" + (1024 + jobSeq++);

  interface PartDef { productId: string; qty: number; costSen: number; sellSen: number; }
  async function makeJob(opts: {
    customerId: string; motorcycleId: string; mechanicId: string | null; daysAgoCreated: number; createdHoursAgo?: number;
    status: string; mileage: number; packageId?: string; packageName?: string;
    items?: { description: string; kind: string; unitSen: number; source?: string }[];
    parts?: PartDef[];
    addonItems?: { description: string; kind: string; unitSen: number }[];
    findings?: { title: string; severity: string; note: string; repair: string; priceSen: number; pending?: boolean }[];
    checklist?: ("PASS" | "WARNING" | "FAIL" | "NA")[] | null;
    completedHoursAgo?: number;
    invoice?: boolean;
    rating?: number | null;
    addCounterRecommendation?: boolean;
  }) {
    jobSeq++;
    const jobNumber = "DZ" + (1024 + jobSeq);
    jobNumbers.push(jobNumber);
    const created = opts.createdHoursAgo != null ? hoursAgo(opts.createdHoursAgo) : daysAgo(opts.daysAgoCreated);
    const completedAt = opts.status === "COMPLETED" ? new Date(created.getTime() + (opts.completedHoursAgo ?? int(2, 5)) * 3600000) : null;
    const job = await prisma.serviceJob.create({
      data: {
        jobNumber, branchId: kl.id, customerId: opts.customerId, motorcycleId: opts.motorcycleId,
        mechanicId: opts.mechanicId, mileage: opts.mileage,
        servicePackageId: opts.packageId, packageName: opts.packageName ?? null,
        customerRequest: pick(["", "", "", "Bunyi aneh depan.", "Service berkala.", "Tayar pancit.", "Check brek.", "Service sebelum balik kampung."]),
        status: opts.status as never,
        startedAt: opts.status === "COMPLETED" || opts.status === "IN_PROGRESS" || opts.status === "AWAITING_APPROVAL" || opts.status === "READY" ? new Date(created.getTime() + 600000) : null,
        readyAt: opts.status === "COMPLETED" ? new Date((completedAt ?? created).getTime() - 3600000) : opts.status === "READY" ? hoursAgo(int(1, 6)) : null,
        completedAt,
        createdAt: created,
      },
    });

    // package: priced line + verified zero-price items + parts
    let totalSen = 0;
    const verified: string[] = [];
    if (opts.packageId) {
      const pkg = await prisma.servicePackage.findUnique({ where: { id: opts.packageId }, include: { items: true } });
      if (pkg) {
        await prisma.serviceJobItem.create({ data: { jobId: job.id, description: pkg.name, kind: "SERVICE", quantity: 1, unitPriceSen: pkg.priceSen, lineTotalSen: pkg.priceSen, status: "INCLUDED", source: "PACKAGE" } });
        totalSen += pkg.priceSen;
        for (const it of pkg.items) {
          verified.push(it.name);
          if (it.kind === "PART" && it.productId) {
            const prod = await prisma.product.findUnique({ where: { id: it.productId } });
            await prisma.serviceJobPart.create({
              data: { jobId: job.id, productId: it.productId, quantity: it.defaultQty, unitCostSen: prod?.costPriceSen ?? 0, unitPriceSen: 0, lineTotalSen: 0, status: "INCLUDED", source: "PACKAGE" },
            });
          } else {
            await prisma.serviceJobItem.create({ data: { jobId: job.id, description: it.name, kind: "SERVICE", quantity: 1, unitPriceSen: 0, lineTotalSen: 0, status: "INCLUDED", source: "PACKAGE" } });
          }
        }
      }
    }
    for (const it of opts.items ?? []) {
      await prisma.serviceJobItem.create({ data: { jobId: job.id, description: it.description, kind: it.kind, quantity: 1, unitPriceSen: it.unitSen, lineTotalSen: it.unitSen, status: "INCLUDED", source: (it.source as never) ?? "COUNTER" } });
      totalSen += it.unitSen;
    }
    for (const a of opts.addonItems ?? []) {
      await prisma.serviceJobItem.create({ data: { jobId: job.id, description: a.description, kind: a.kind, quantity: 1, unitPriceSen: a.unitSen, lineTotalSen: a.unitSen, status: "ACCEPTED", source: "COUNTER" } });
      totalSen += a.unitSen;
    }
    for (const p of opts.parts ?? []) {
      const prod = await prisma.product.findUnique({ where: { id: p.productId } });
      await prisma.serviceJobPart.create({
        data: { jobId: job.id, productId: p.productId, quantity: p.qty, unitCostSen: p.costSen, unitPriceSen: p.sellSen, lineTotalSen: p.sellSen * p.qty, status: "ACCEPTED", source: "COUNTER" },
      });
      totalSen += p.sellSen * p.qty;
    }

    // checklist
    if (opts.checklist) {
      const exec = await prisma.checklistExecution.create({ data: { jobId: job.id, templateId: template.id, startedAt: daysAgo(opts.daysAgoCreated), completedAt: opts.checklist.every((r) => r !== "NA") ? hoursAgo(int(1, 15)) : null } });
      const items = await prisma.checklistItem.findMany({ where: { templateId: template.id }, orderBy: { order: "asc" } });
      for (const [idx, it] of items.entries()) {
        const result = opts.checklist![idx] ?? "NA";
        await prisma.checklistExecutionItem.create({ data: { executionId: exec.id, checklistItemId: it.id, name: it.name, result: result as never, note: result === "WARNING" || result === "FAIL" ? "Perlu perhatian." : null } });
      }
    }

    // findings + approvals
    for (const f of opts.findings ?? []) {
      const finding = await prisma.inspectionFinding.create({
        data: { jobId: job.id, title: f.title, severity: f.severity, note: f.note, recommendedRepair: f.repair, priceSen: f.priceSen, status: f.pending ? "RECOMMENDED" : "APPROVED" },
      });
      const approval = await prisma.customerApproval.create({
        data: { jobId: job.id, findingId: finding.id, title: f.repair, description: f.note, amountSen: f.priceSen, status: f.pending ? "PENDING" : "APPROVED", requestedAt: hoursAgo(int(2, 30)), respondedAt: f.pending ? null : hoursAgo(int(1, 20)) },
      });
      if (!f.pending) {
        await prisma.serviceJobItem.create({ data: { jobId: job.id, description: f.repair, kind: "FEE", quantity: 1, unitPriceSen: f.priceSen, lineTotalSen: f.priceSen, status: "ACCEPTED", source: "APPROVAL" } });
        totalSen += f.priceSen;
      }
    }

    // invoice for completed
    if (opts.status === "COMPLETED" && opts.invoice) {
      const issued = job.completedAt ?? new Date();
      const invNo = "DZ-2026-" + String(1028 + jobSeq).padStart(5, "0");
      const invoice = await prisma.invoice.create({
        data: { branchId: kl.id, customerId: opts.customerId, jobId: job.id, invoiceNumber: invNo, status: "PAID", issuedAt: issued, paidAt: issued, subtotalSen: totalSen, totalSen },
      });
      const jobItems = await prisma.serviceJobItem.findMany({ where: { jobId: job.id, unitPriceSen: { gt: 0 }, status: { not: "DECLINED" } } });
      for (const it of jobItems) {
        await prisma.invoiceItem.create({ data: { invoiceId: invoice.id, description: it.description, quantity: it.quantity, unitPriceSen: it.unitPriceSen, lineTotalSen: it.lineTotalSen, source: it.kind === "PART" ? "PART" : "SERVICE" } });
      }
      const jobParts = await prisma.serviceJobPart.findMany({ where: { jobId: job.id, unitPriceSen: { gt: 0 }, status: { not: "DECLINED" } } });
      for (const p of jobParts) {
        await prisma.invoiceItem.create({ data: { invoiceId: invoice.id, description: (await prisma.product.findUnique({ where: { id: p.productId } }))!.name, quantity: p.quantity, unitPriceSen: p.unitPriceSen, lineTotalSen: p.lineTotalSen, source: "PART" } });
      }
      await prisma.payment.create({ data: { invoiceId: invoice.id, amountSen: totalSen, method: pick(["CASH", "CARD", "EWALLET", "ONLINE"]), status: "PAID", paidAt: issued } });
      if (opts.rating != null) {
        await prisma.review.create({ data: { branchId: kl.id, customerId: opts.customerId, jobId: job.id, rating: opts.rating, comment: pick(["Servis cepat dan kemas.", "Harga berpatutan.", "Staff mesra.", "Bike rasa baru balik dari kilang.", "Recommended!", "Baik, servis berkala terus.", null, null, null, null, null, null]) ?? undefined, status: "PUBLISHED", source: "APP" } });
      } else {
        await prisma.review.create({ data: { branchId: kl.id, customerId: opts.customerId, jobId: job.id, status: "REQUESTED", requestedAt: job.completedAt ?? undefined, source: "APP" } });
      }
      // stock movements for consumed parts (§34)
      const jobPartsAll = await prisma.serviceJobPart.findMany({ where: { jobId: job.id } });
      for (const p of jobPartsAll) {
        await prisma.stockMovement.create({ data: { branchId: kl.id, productId: p.productId, quantity: -p.quantity, reason: "Service Job " + job.jobNumber, referenceType: "SERVICE_JOB", referenceId: job.id, createdAt: job.completedAt ?? new Date() } });
        const inv = await prisma.inventory.findUnique({ where: { branchId_productId: { branchId: kl.id, productId: p.productId } } });
        if (inv) await prisma.inventory.update({ where: { id: inv.id }, data: { quantity: Math.max(0, inv.quantity - p.quantity) } });
      }
    }
    return { job, totalSen, verified };
  }

  const mechanics = [staff["Aizat"], staff["Hafiz"], staff["Ravi"]];
  const custWithoutAhmad = customers.filter((c) => c.id !== ahmad.id);
  const customersWithBikes = custWithoutAhmad.filter((c) => bikeIds.some((b) => b.customerId === c.id));
  const nextCust = (() => { let i = 0; return () => customersWithBikes[i++ % customersWithBikes.length]; })();
  const bikeOf = (custId: string) => bikeIds.find((b) => b.customerId === custId)!;

  const oil = productIds["Yamalube 10W-40 1L"];
  const oilFilter = productIds["Yamaha Genuine Oil Filter"];
  const spark = productIds["NGK Spark Plug (CR7HSA)"];
  const airF = productIds["Yamaha Air Filter"];
  const brakePad = productIds["Yamaha Genuine Brake Pad"];
  const chainSet = productIds["DID Chain 428VX (set)"];
  const tyreFront = productIds["Dunlop TT900 (front)"];
  const tyreRear = productIds["Dunlop TT900 (rear)"];
  const battery = productIds["Yuasa YTX7L-BS"];
  const coolant = productIds["Coolant 1L"];

  // ----- Ahmad's 11 historical completed jobs (lifetime RM2,285) -----
  const ahmadInvoices = [RM(165), RM(190), RM(210), RM(165), RM(250), RM(165), RM(220), RM(190), RM(165), RM(240), RM(325)];
  let ahmadTotal = 0;
  const ahmadDays = [2150, 1950, 1750, 1550, 1350, 1150, 950, 750, 560, 340, 92];
  const ahmadMileages = [3100, 8100, 11200, 14500, 17200, 19800, 22500, 25100, 26800, 27800, 28500];
  const AHMAD_ADDONS: { description: string; kind: string; unitSen: number }[][] = [
    [{ description: "Chain Adjustment", kind: "FEE", unitSen: RM(20) }, { description: "Wash & Polish", kind: "SERVICE", unitSen: RM(25) }], // STANDARD 120 + 45 = 165
    [{ description: "Brake Pad Replacement", kind: "SERVICE", unitSen: RM(65) }, { description: "Chain Lube", kind: "SERVICE", unitSen: RM(10) }, { description: "CVT Cleaning", kind: "SERVICE", unitSen: RM(30) }, { description: "Wash & Polish", kind: "SERVICE", unitSen: RM(25) }], // BASIC 60 + 130 = 190
    [{ description: "Chain Adjustment", kind: "FEE", unitSen: RM(20) }, { description: "Tyre Pressure Check", kind: "SERVICE", unitSen: RM(10) }], // PREMIUM 180 + 30 = 210
    [{ description: "CVT Full Service", kind: "SERVICE", unitSen: RM(80) }, { description: "Chain Lube", kind: "SERVICE", unitSen: RM(10) }, { description: "Wash & Polish", kind: "SERVICE", unitSen: RM(15) }], // BASIC 60 + 105 = 165
    [{ description: "Tyre Replacement (front)", kind: "SERVICE", unitSen: RM(130) }], // STANDARD 120 + 130 = 250
    [], // PREMIUM 180
    [{ description: "Brake Service", kind: "SERVICE", unitSen: RM(40) }, { description: "Chain Lube", kind: "SERVICE", unitSen: RM(10) }, { description: "Wash & Polish", kind: "SERVICE", unitSen: RM(20) }], // STANDARD 120 + 70 = 190
    [{ description: "Brake Pad Replacement", kind: "SERVICE", unitSen: RM(65) }, { description: "CVT Full Service", kind: "SERVICE", unitSen: RM(50) }, { description: "Wash & Polish", kind: "SERVICE", unitSen: RM(15) }], // BASIC 60 + 130 = 190
    [], // PREMIUM 180
    [{ description: "Battery Replacement", kind: "SERVICE", unitSen: RM(165) }, { description: "Chain Lube", kind: "SERVICE", unitSen: RM(15) }], // BASIC 60 + 180 = 240
    [{ description: "Rear Tyre Replacement", kind: "SERVICE", unitSen: RM(175) }, { description: "Chain Adjustment", kind: "FEE", unitSen: RM(20) }, { description: "Wash & Polish", kind: "SERVICE", unitSen: RM(10) }], // STANDARD 120 + 205 = 325
  ];
  for (let i = 0; i < ahmadInvoices.length; i++) {
    ahmadTotal += ahmadInvoices[i];
    const usePremium = i % 3 === 2;
    const pkg = usePremium ? packages.PREMIUM : i % 2 === 0 ? packages.STANDARD : packages.BASIC;
    const parts: PartDef[] = [];
    await makeJob({
      customerId: ahmad.id, motorcycleId: ahmadBike.id, mechanicId: pick(mechanics), daysAgoCreated: ahmadDays[i],
      status: "COMPLETED", mileage: ahmadMileages[i], packageId: pkg.id, packageName: pkg.name,
      parts, addonItems: AHMAD_ADDONS[i],
      checklist: ["PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS"],
      invoice: true, rating: pick([5, 5, 5, 4]),
    });
  }
  // bump Ahmad's last-service snapshot to match: last 28500 on day 92
  await prisma.motorcycle.update({ where: { id: ahmadBike.id }, data: { lastServiceDate: daysAgo(92), lastServiceMileage: 28500 } });
  await prisma.serviceReminder.create({
    data: { customerId: ahmad.id, motorcycleId: ahmadBike.id, status: "UPCOMING", lastServiceMileage: 28500, intervalKm: 3000, nextServiceMileage: 31500, estimatedDate: new Date(), createdAt: daysAgo(92) },
  });

  // ----- other customers' historical completed jobs (days 31..400) -----
  const historicalDays = [35, 40, 48, 55, 62, 70, 78, 85, 95, 110, 130, 160, 200, 260, 320, 380];
  for (let i = 0; i < 85; i++) {
    const cust = nextCust();
    const bike = bikeOf(cust.id);
    const mechanic = pick(mechanics);
    const pkg = pick([packages.BASIC, packages.STANDARD, packages.STANDARD, packages.PREMIUM]);
    const parts: PartDef[] = [];
    const extras = int(0, 3);
    const addons = extras >= 3 ? [{ description: "Chain Lube", kind: "SERVICE", unitSen: RM(10) }] : [];
    const parts2 = [...parts];
    if (extras === 2) parts2.push({ productId: brakePad, qty: 1, costSen: RM(38), sellSen: RM(65) });
    if (extras === 3) parts2.push({ productId: chainSet, qty: 1, costSen: RM(120), sellSen: RM(210) });
    const day = pick(historicalDays);
    await makeJob({
      customerId: cust.id, motorcycleId: bike.id, mechanicId: mechanic, daysAgoCreated: day,
      status: "COMPLETED", mileage: Math.max(0, bike.mileage - int(0, 6000)), packageId: pkg.id, packageName: pkg.name,
      parts: parts2, addonItems: addons, checklist: ["PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS"],
      invoice: true, rating: int(0, 9) < 3 ? pick([5, 5, 5, 5, 4]) : null,
    });
  }

  // ----- last-30-days completed jobs for KPI (Aizat 18, Hafiz 12, Ravi 10) -----
  const recentPlan: { mech: string; count: number; pkgRate: number; addonRate: number }[] = [
    { mech: staff["Aizat"], count: 18, pkgRate: 0.9, addonRate: 0.5 },
    { mech: staff["Hafiz"], count: 12, pkgRate: 0.8, addonRate: 0.45 },
    { mech: staff["Ravi"], count: 10, pkgRate: 0.75, addonRate: 0.4 },
  ];
  for (const plan of recentPlan) {
    for (let i = 0; i < plan.count; i++) {
      const cust = nextCust();
      const bike = bikeOf(cust.id);
      const withPkg = rand() < plan.pkgRate;
      const pkg = pick([packages.STANDARD, packages.STANDARD, packages.PREMIUM]);
      const withAddon = rand() < plan.addonRate;
      const parts: PartDef[] = [];
      const addons = withAddon ? pick([[{ description: "Chain Lube", kind: "SERVICE", unitSen: RM(10) }], [{ description: "Brake Inspection + Service", kind: "SERVICE", unitSen: RM(15) }], [{ description: "Tyre Pressure + Balance", kind: "SERVICE", unitSen: RM(12) }]]) : [];
      const parts2 = rand() < 0.25 ? [...parts, { productId: brakePad, qty: 1, costSen: RM(38), sellSen: RM(65) }] : parts;
      const parts3 = plan.mech === staff["Aizat"] && rand() < 0.15 ? [...parts2, { productId: chainSet, qty: 1, costSen: RM(120), sellSen: RM(210) }] : parts2;
      const day = int(2, 29);
      await makeJob({
        customerId: cust.id, motorcycleId: bike.id, mechanicId: plan.mech, daysAgoCreated: day,
        status: "COMPLETED", mileage: Math.max(0, bike.mileage - int(0, 3000)),
        packageId: withPkg ? pkg.id : undefined, packageName: withPkg ? pkg.name : undefined,
        parts: parts3, addonItems: addons,
        checklist: plan.mech === staff["Aizat"] ? ["PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS"] : rand() < 0.95 ? ["PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS"] : ["PASS", "PASS", "PASS", "WARNING", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS"],
        invoice: true, rating: plan.mech === staff["Aizat"] ? (int(0, 9) < 6 ? pick([5, 5, 5, 5, 4]) : null) : (int(0, 9) < 3 ? pick([5, 5, 5, 5, 4]) : null),
      });
    }
  }

  // ----- today's 28 jobs (§17 board) -----
  // 7 completed today (invoice totals sum ~RM4,850)
  const todayCompleted: { items: { description: string; kind: string; unitSen: number }[]; parts: PartDef[] }[] = [
    { items: [{ description: "Standard Service", kind: "SERVICE", unitSen: RM(120) }], parts: [{ productId: oil, qty: 1, costSen: RM(24), sellSen: 0 }, { productId: oilFilter, qty: 1, costSen: RM(12), sellSen: RM(25) }] }, // 145
    { items: [{ description: "Premium Service", kind: "SERVICE", unitSen: RM(180) }], parts: [{ productId: oil, qty: 1, costSen: RM(24), sellSen: 0 }, { productId: oilFilter, qty: 1, costSen: RM(12), sellSen: 0 }, { productId: spark, qty: 1, costSen: RM(9), sellSen: 0 }, { productId: airF, qty: 1, costSen: RM(18), sellSen: 0 }] }, // 180
    { items: [{ description: "Standard Service", kind: "SERVICE", unitSen: RM(120) }, { description: "Brake Overhaul", kind: "SERVICE", unitSen: RM(80) }], parts: [{ productId: oil, qty: 1, costSen: RM(24), sellSen: 0 }, { productId: oilFilter, qty: 1, costSen: RM(12), sellSen: RM(25) }, { productId: brakePad, qty: 2, costSen: RM(38), sellSen: RM(65) }, { productId: chainSet, qty: 1, costSen: RM(120), sellSen: RM(210) }] }, // 120+80+25+130+210 = 565 → bump to 1300: add sprocket + disc
    { items: [{ description: "Basic Service", kind: "SERVICE", unitSen: RM(60) }], parts: [{ productId: oil, qty: 1, costSen: RM(24), sellSen: 0 }] }, // 60
    { items: [{ description: "Standard Service", kind: "SERVICE", unitSen: RM(120) }], parts: [{ productId: oil, qty: 1, costSen: RM(24), sellSen: 0 }, { productId: oilFilter, qty: 1, costSen: RM(12), sellSen: RM(25) }, { productId: battery, qty: 1, costSen: RM(110), sellSen: RM(165) }] }, // 120+25+165=310
    { items: [{ description: "Premium Service", kind: "SERVICE", unitSen: RM(180) }], parts: [{ productId: oil, qty: 1, costSen: RM(24), sellSen: 0 }, { productId: oilFilter, qty: 1, costSen: RM(12), sellSen: 0 }, { productId: spark, qty: 1, costSen: RM(9), sellSen: 0 }, { productId: airF, qty: 1, costSen: RM(18), sellSen: 0 }, { productId: coolant, qty: 1, costSen: RM(10), sellSen: RM(22) }] }, // 180+22=202
    { items: [{ description: "Tyre Change + Standard Service", kind: "SERVICE", unitSen: RM(120) }, { description: "Tyre Fitting (pair)", kind: "FEE", unitSen: RM(30) }], parts: [{ productId: oil, qty: 1, costSen: RM(24), sellSen: 0 }, { productId: oilFilter, qty: 1, costSen: RM(12), sellSen: RM(25) }, { productId: tyreFront, qty: 1, costSen: RM(85), sellSen: RM(150) }, { productId: tyreRear, qty: 1, costSen: RM(100), sellSen: RM(175) }] }, // 120+30+25+150+175=500
  ];
  // tune to sum ≈ RM4,850
  todayCompleted[2] = { items: [{ description: "Major Service", kind: "SERVICE", unitSen: RM(280) }, { description: "Brake Overhaul", kind: "SERVICE", unitSen: RM(120) }, { description: "Engine Overhaul Service", kind: "SERVICE", unitSen: RM(500) }], parts: [{ productId: oil, qty: 1, costSen: RM(24), sellSen: 0 }, { productId: oilFilter, qty: 1, costSen: RM(12), sellSen: RM(25) }, { productId: brakePad, qty: 2, costSen: RM(38), sellSen: RM(65) }, { productId: chainSet, qty: 1, costSen: RM(120), sellSen: RM(210) }, { productId: productIds["Brake Disc 260mm"], qty: 1, costSen: RM(140), sellSen: RM(240) }] }; // 280+120+25+130+210+240=1005
  todayCompleted[6] = { items: [{ description: "Premium Service", kind: "SERVICE", unitSen: RM(180) }, { description: "Tyre Fitting (pair)", kind: "FEE", unitSen: RM(40) }], parts: [{ productId: oil, qty: 1, costSen: RM(24), sellSen: 0 }, { productId: oilFilter, qty: 1, costSen: RM(12), sellSen: RM(25) }, { productId: productIds["Pirelli Diablo Rosso (rear)"], qty: 2, costSen: RM(240), sellSen: RM(390) }] }; // 180+40+25+780=1025
  // new sum = 145+180+1005+60+310+202+1025 = 2,927 → still short. Push #4 & #5:
  todayCompleted[3] = { items: [{ description: "Standard Service", kind: "SERVICE", unitSen: RM(120) }], parts: [{ productId: oil, qty: 1, costSen: RM(24), sellSen: 0 }, { productId: oilFilter, qty: 1, costSen: RM(12), sellSen: RM(25) }, { productId: battery, qty: 1, costSen: RM(110), sellSen: RM(165) }, { productId: productIds["NGK Iridium (CR8EIX)"], qty: 1, costSen: RM(28), sellSen: RM(45) }] }; // 120+25+165+45=355
  todayCompleted[4] = { items: [{ description: "Standard Service", kind: "SERVICE", unitSen: RM(120) }, { description: "CVT Full Service", kind: "SERVICE", unitSen: RM(80) }], parts: [{ productId: oil, qty: 1, costSen: RM(24), sellSen: 0 }, { productId: oilFilter, qty: 1, costSen: RM(12), sellSen: RM(25) }, { productId: productIds["Yamaha Genuine CVT Belt"], qty: 1, costSen: RM(90), sellSen: RM(145) }, { productId: productIds["Roller Weights 6g (set)"], qty: 1, costSen: RM(18), sellSen: RM(35) }] }; // 120+80+25+145+35=405
  todayCompleted.push({ items: [{ description: "Full Service + Overhaul", kind: "SERVICE", unitSen: RM(450) }, { description: "Engine Overhaul Service", kind: "SERVICE", unitSen: RM(200) }], parts: [{ productId: oil, qty: 2, costSen: RM(24), sellSen: 0 }, { productId: oilFilter, qty: 1, costSen: RM(12), sellSen: RM(25) }, { productId: spark, qty: 1, costSen: RM(9), sellSen: RM(18) }, { productId: productIds["Bridgestone Battlax BT39 (rear)"], qty: 1, costSen: RM(200), sellSen: RM(340) }] }); // 450+200+25+18+340=1033

  for (let i = 0; i < todayCompleted.length; i++) {
    const cust = nextCust();
    const bike = bikeOf(cust.id);
    await makeJob({
      customerId: cust.id, motorcycleId: bike.id, mechanicId: pick([staff["Hafiz"], staff["Ravi"]]), daysAgoCreated: 0,
      status: "COMPLETED", mileage: Math.max(0, bike.mileage), packageId: undefined, packageName: undefined,
      items: todayCompleted[i].items, parts: todayCompleted[i].parts,
      checklist: ["PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS"],
      invoice: true, rating: pick([5, 5, 4, null]), completedHoursAgo: int(1, 8), createdHoursAgo: int(7, 11),
    });
  }

  // 4 READY
  for (let i = 0; i < 4; i++) {
    const cust = nextCust();
    const bike = bikeOf(cust.id);
    await makeJob({
      customerId: cust.id, motorcycleId: bike.id, mechanicId: pick(mechanics), daysAgoCreated: 0,
      status: "READY", mileage: bike.mileage, packageId: packages.STANDARD.id, packageName: packages.STANDARD.name,
      parts: [{ productId: oil, qty: 1, costSen: RM(24), sellSen: 0 }, { productId: oilFilter, qty: 1, costSen: RM(12), sellSen: RM(25) }],
      checklist: ["PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS"],
    });
  }

  // 3 AWAITING_APPROVAL with pending approvals
  const pendingApprovals: { title: string; note: string; repair: string; priceSen: number }[] = [
    { title: "CHAIN", note: "Chain is too loose.", repair: "Chain Adjustment", priceSen: RM(20) },
    { title: "BRAKE", note: "Brake pad worn below 2mm.", repair: "Brake Pad Replacement", priceSen: RM(65) },
    { title: "TYRE", note: "Tyre tread depth low, cracks on sidewall.", repair: "Rear Tyre Replacement", priceSen: RM(175) },
  ];
  for (const [i, ap] of pendingApprovals.entries()) {
    const cust = nextCust();
    const bike = bikeOf(cust.id);
    await makeJob({
      customerId: cust.id, motorcycleId: bike.id, mechanicId: staff["Hafiz"], daysAgoCreated: 0,
      status: "AWAITING_APPROVAL", mileage: bike.mileage, packageId: packages.STANDARD.id, packageName: packages.STANDARD.name,
      parts: [{ productId: oil, qty: 1, costSen: RM(24), sellSen: 0 }, { productId: oilFilter, qty: 1, costSen: RM(12), sellSen: RM(25) }],
      checklist: ["PASS", "PASS", "WARNING", "PASS", "PASS", "PASS", "PASS", "PASS", "NA", "NA"],
      findings: [{ title: ap.title, severity: "WARNING", note: ap.note, repair: ap.repair, priceSen: ap.priceSen, pending: true }],
    });
  }

  // 8 IN_PROGRESS (some with partial checklists)
  for (let i = 0; i < 8; i++) {
    const cust = nextCust();
    const bike = bikeOf(cust.id);
    const partial: ("PASS" | "WARNING" | "FAIL" | "NA")[] = ["PASS", "PASS", "WARNING", "PASS", "NA", "NA", "NA", "NA", "NA", "NA"];
    await makeJob({
      customerId: cust.id, motorcycleId: bike.id, mechanicId: pick(mechanics), daysAgoCreated: 0,
      status: "IN_PROGRESS", mileage: bike.mileage, packageId: packages.STANDARD.id, packageName: packages.STANDARD.name,
      parts: [{ productId: oil, qty: 1, costSen: RM(24), sellSen: 0 }],
      checklist: i % 2 === 0 ? partial : ["PASS", "PASS", "PASS", "NA", "NA", "NA", "NA", "NA", "NA", "NA"],
    });
  }

  // 5 WAITING
  for (let i = 0; i < 5; i++) {
    const cust = nextCust();
    const bike = bikeOf(cust.id);
    await makeJob({
      customerId: cust.id, motorcycleId: bike.id, mechanicId: null, daysAgoCreated: 0,
      status: "WAITING", mileage: bike.mileage, packageId: undefined, packageName: undefined,
    });
  }

  // ----- bookings (§20) -----
  const bookingStatuses = ["REQUESTED", "REQUESTED", "REQUESTED", "REQUESTED", "REQUESTED", "REQUESTED", "CONFIRMED", "CONFIRMED", "CONFIRMED", "CONFIRMED", "CONFIRMED", "CONFIRMED", "CONFIRMED", "CONFIRMED", "RESCHEDULED", "RESCHEDULED", "RESCHEDULED", "RESCHEDULED", "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "CANCELLED", "CANCELLED"];
  const timeSlots = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "14:00", "14:30", "15:00", "16:00"];
  for (const [i, st] of bookingStatuses.entries()) {
    const cust = nextCust();
    const bike = bikeOf(cust.id);
    const isPast = st === "COMPLETED" || st === "CANCELLED";
    const date = isPast ? utcDay(-int(2, 20)) : utcDay(int(0, 6));
    const booking = await prisma.booking.create({
      data: {
        branchId: kl.id, customerId: cust.id, motorcycleId: bike.id,
        serviceType: pick(SERVICE_TYPES), date, timeSlot: pick(timeSlots),
        notes: rand() < 0.3 ? "Sila check brek belakang." : undefined,
        status: st as never, source: rand() < 0.7 ? "RIDER_APP" : "COUNTER",
      },
    });
    if (st === "COMPLETED") {
      const job = await prisma.serviceJob.findFirst({ where: { customerId: cust.id, status: "COMPLETED" } });
      if (job) await prisma.booking.update({ where: { id: booking.id }, data: { jobId: job.id } });
    }
  }
  // Ahmad has a REQUESTED booking for the demo (tomorrow)
  const ahmadBooking = await prisma.booking.create({
    data: { branchId: kl.id, customerId: ahmad.id, motorcycleId: ahmadBike.id, serviceType: "Standard Service", date: utcDay(1), timeSlot: "10:00", notes: "Mileage sekarang 31,800 km.", status: "REQUESTED", source: "RIDER_APP" },
  });

  // ----- reminders: one open per motorcycle that has completed jobs; 18 due/overdue -----
  const bikesWithJobs = await prisma.serviceJob.findMany({ where: { status: "COMPLETED" }, select: { motorcycleId: true, mileage: true, completedAt: true, customerId: true, id: true } });
  const perBike = new Map<string, { mileage: number; completedAt: Date; customerId: string; jobId: string }>();
  for (const j of bikesWithJobs) {
    const cur = perBike.get(j.motorcycleId);
    if (!cur || j.completedAt! > cur.completedAt) perBike.set(j.motorcycleId, { mileage: j.mileage, completedAt: j.completedAt!, customerId: j.customerId, jobId: j.id });
  }
  let reminderIdx = 0;
  for (const [bikeId, info] of perBike) {
    if (bikeId === ahmadBike.id) continue;
    reminderIdx++;
    const bike = await prisma.motorcycle.findUnique({ where: { id: bikeId } });
    if (!bike) continue;
    const next = info.mileage + 3000;
    await prisma.serviceReminder.create({
      data: {
        customerId: info.customerId, motorcycleId: bikeId, jobId: info.jobId, status: "UPCOMING",
        lastServiceMileage: info.mileage, intervalKm: 3000, nextServiceMileage: next,
        estimatedDate: new Date(info.completedAt.getTime() + 92 * 86400000), createdAt: info.completedAt,
      },
    });
  }
  // control loop: exactly 18 open reminders DUE/OVERDUE (Ahmad = 1 of them)
  const reminderRows = await prisma.serviceReminder.findMany({ where: { closedAt: null }, include: { motorcycle: true }, take: 500 });
  const gapOf = (r: { nextServiceMileage: number; motorcycle: { currentMileage: number } }) => r.nextServiceMileage - r.motorcycle.currentMileage;
  // DUE = gap ≤ 20% of the 3,000 km interval (600) or OVERDUE (gap ≤ 0) — mirrors crmService.statusOf
  const isDue = (r: { nextServiceMileage: number; motorcycle: { currentMileage: number } }) => gapOf(r) <= 600;
  let dueCount = reminderRows.filter(isDue).length;
  const TARGET_DUE = 18;
  const needsMore = reminderRows.filter((r) => gapOf(r) > 600 && r.motorcycleId !== ahmadBike.id);
  const needsLess = reminderRows.filter((r) => isDue(r) && r.motorcycleId !== ahmadBike.id);
  while (dueCount < TARGET_DUE && needsMore.length > 0) {
    const r = needsMore.pop()!;
    await prisma.motorcycle.update({ where: { id: r.motorcycleId }, data: { currentMileage: r.nextServiceMileage + int(0, 400) } });
    dueCount++;
  }
  while (dueCount > TARGET_DUE && needsLess.length > 0) {
    const r = needsLess.pop()!;
    await prisma.motorcycle.update({ where: { id: r.motorcycleId }, data: { currentMileage: Math.max(0, r.nextServiceMileage - int(1500, 4000)) } });
    dueCount--;
  }

  // ----- messages (§31) -----
  const msgTemplates = [
    (n: string) => "Hi " + n.split(" ")[0] + ", motosikal awak dah siap! Terima kasih — D&Z Smart Workshop.",
    (n: string) => "Hi " + n.split(" ")[0] + ", booking awak disahkan untuk slot yang dipilih. Jumpa di workshop!",
    (n: string) => "Hi " + n.split(" ")[0] + ", motosikal awak mungkin sudah sampai masa servis seterusnya. Nak bookingkan slot?",
    (n: string) => "Hi " + n.split(" ")[0] + ", promo servis musim ini: Standard Service RM120 sahaja. Tempah sekarang!",
    (n: string) => "Hi " + n.split(" ")[0] + ", tayar depan perlu perhatian semasa servis terakhir. Jom check.",
  ];
  for (let i = 0; i < 60; i++) {
    const cust = customers[int(0, customers.length - 1)];
    const tpl = pick(msgTemplates);
    await prisma.message.create({
      data: {
        organisationId: org.id, branchId: kl.id, customerId: cust.id, direction: "OUT", channel: pick(["WHATSAPP", "WHATSAPP", "WHATSAPP", "SMS", "APP"]),
        body: tpl(cust.name), status: pick(["SENT", "DELIVERED", "READ", "SENT", "DELIVERED"]), createdAt: daysAgo(int(0, 60)),
      },
    });
  }
  await prisma.message.create({
    data: { organisationId: org.id, branchId: kl.id, customerId: ahmad.id, direction: "OUT", channel: "WHATSAPP", body: "Hi Ahmad, motosikal awak mungkin sudah sampai masa servis seterusnya. Anggaran semasa: 31,800 km. Disyorkan: 31,500 km. Nak bookingkan slot?", status: "READ", createdAt: daysAgo(6), referenceType: "REMINDER" },
  });

  // ----- reviews (avg ≈ 4.8) -----
  // (reviews already created with jobs; add a few more standalone)
  for (let i = 0; i < 4; i++) {
    const cust = nextCust();
    await prisma.review.create({ data: { branchId: kl.id, customerId: cust.id, rating: pick([5, 5, 5, 4]), comment: pick(["Servis cepat dan kemas.", "Harga berpatutan.", "Staff mesra.", "Recommended!"]), status: "PUBLISHED", source: "GOOGLE", createdAt: daysAgo(int(0, 30)) } });
  }

  // ----- marketing -----
  const campaignNames = ["Return Campaign Aug", "Service Reminder Blast", "Hari Merdeka Promo", "Chain & Sprocket Sale", "Tyre Week", "New Rider Welcome", "Battery Check Month", "Student Discount", "Weekend Wash & Polish", "Loyalty 10th Visit"];
  // deterministic promos: Hari Merdeka (20% off, live) + Chain & Sprocket (15%, live) — drives the promo engine demo
  const promoDiscounts: Record<string, number> = { "Hari Merdeka Promo": 20, "Chain & Sprocket Sale": 15, "Student Discount": 10 };
  for (const [i, name] of campaignNames.entries()) {
    const type = (promoDiscounts[name] !== undefined ? "PROMO" : pick(["RETURN", "REMINDER", "PROMO", "NEWS"])) as "RETURN" | "REMINDER" | "PROMO" | "NEWS";
    const status = (promoDiscounts[name] !== undefined ? "ACTIVE" : pick(["ACTIVE", "SCHEDULED", "ENDED"])) as "ACTIVE" | "SCHEDULED" | "ENDED";
    await prisma.campaign.create({ data: { branchId: kl.id, name, type, audience: pick(["ALL", "30_DAYS", "60_DAYS", "OVERDUE", "NEW"]), status, startDate: daysAgo(3), endDate: promoDiscounts[name] !== undefined ? daysFromNow(30) : i % 2 === 0 ? daysFromNow(14) : null, discountPercent: promoDiscounts[name] ?? null } });
  }
  const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const posterTitles = ["Servis Musim Ini", "Check Before Raya", "Standard RM120", "Premium Best Value", "Tyre Safety Week", "Oil Change Reminder", "Chain & Sprocket", "Battery Health", "Student Promo", "Weekend Wash", "Brake Check", "Returning Rider"];
  // demo poster images (public/posters/*.png) mapped to the first 10 titles
  const posterFiles = fs.readdirSync(path.join(__dirname, "../../public/posters")).filter((f: string) => f.endsWith(".png")).sort();
  for (const [i, t] of posterTitles.entries()) {
    const url = posterFiles[i % posterFiles.length] ? "/posters/" + posterFiles[i % posterFiles.length] : null;
    await prisma.marketingAsset.create({ data: { branchId: kl.id, title: t, type: "POSTER", month: months[i % months.length], description: "AI-generated poster pack — " + t + ".", url } });
  }
  const scriptHooks = [
    ["5 Tanda Moto Perlu Servis", "TIKTOK"], ["Servis RM120 je?", "REELS"], ["Cara Check Rantai Sendiri", "TIKTOK"],
    ["Kenapa Minyak Hitam Penting", "IG"], ["Workshop Tour 60 saat", "TIKTOK"], ["Jangan Buat Ni Sebelum Servis", "TIKTOK"],
    ["Tayar Licin? Bahaya!", "REELS"], ["Standard vs Premium", "IG"], ["Cerita Pelanggan", "FACEBOOK"], ["Servis Kilat 30 Minit", "TIKTOK"],
  ] as const;
  for (const [hook, platform] of scriptHooks) {
    await prisma.contentScript.create({ data: { branchId: kl.id, title: hook, platform, hook, body: "HOOK: " + hook + ".\n\nBODY: Kalau motosikal awak dah rasa lain macam, bawa masuk D&Z Smart Workshop. Servis dari RM60 sahaja.\n\nCTA: Book sekarang di app D&Z Rider.", tone: pick(["Kasual", "Friendly", "Urgent", "Premium"]) } });
  }

  // notifications
  for (let i = 0; i < 8; i++) {
    const cust = customers[int(0, customers.length - 1)];
    await prisma.notification.create({ data: { customerId: cust.id, branchId: kl.id, title: pick(["Your motorcycle is ready", "Booking confirmed", "Service reminder"]), body: "D&Z Smart Workshop", type: "INFO", createdAt: daysAgo(int(0, 10)) } });
  }

  // ---------- final inventory calibration ----------
  // overwrite KL quantities to the intended levels (movements above stay as history)
  const finalQty = klQty;
  for (const [name, sku] of PRODUCTS.map((p) => [p[0], p[1]] as [string, string])) {
    const inv = await prisma.inventory.findUnique({ where: { branchId_productId: { branchId: kl.id, productId: bySku[sku] } } });
    if (inv) await prisma.inventory.update({ where: { id: inv.id }, data: { quantity: finalQty[sku] ?? int(14, 60) } });
  }
  // dead-stock products: fabricate an old sale (60+ days ago) so they register as slow movers
  const deadSkus = ["HELM-LOCK", "PHN-MOUNT", "GRIP-RED", "TANK-BAG", "VALVE-CAP", "SEAT-CVR", "REAR-RACK", "TOOL-KIT", "PUMP-12V", "MIRROR-PR", "CARB-CLN", "FND-EXT", "GRIP-BLK"];
  for (const sku of deadSkus) {
    await prisma.stockMovement.create({
      data: { branchId: kl.id, productId: bySku[sku], quantity: -1, reason: "Sale (walk-in)", referenceType: "SALE", createdAt: daysAgo(int(90, 220)) },
    });
  }


  // ---------- requirements §30: base dictionaries for new entities ----------
  // standard sales pipeline (PIPE-001..): New Enquiry -> Contacted -> Qualified -> Test Ride -> Proposal (Closed via lead.status)
  const stageNames = ["New Enquiry", "Contacted", "Qualified", "Test Ride", "Proposal"];
  for (const [i, nm] of stageNames.entries()) {
    await prisma.leadStage.create({ data: { organisationId: org.id, name: nm, order: i } });
  }
  const sourceNames = ["Website", "WhatsApp", "Walk-in", "Phone", "Social Media", "Referral", "Other"];
  for (const nm of sourceNames) {
    await prisma.leadSource.create({ data: { organisationId: org.id, name: nm } });
  }
  // service catalogue (DATA-018)
  const svcDefs: [string, string, number][] = [
    ["Engine Oil Change", "MAINTENANCE", 45], ["General Service", "MAINTENANCE", 90], ["Major Service", "MAINTENANCE", 180],
    ["Brake Service", "REPAIR", 60], ["Tyre Replacement", "REPAIR", 30], ["Electrical Check", "DIAGNOSTIC", 45],
    ["Full Inspection", "DIAGNOSTIC", 60], ["Engine Tune-up", "REPAIR", 75],
  ];
  for (const [nm, cat, dur] of svcDefs) {
    await prisma.serviceType.create({ data: { organisationId: org.id, name: nm, category: cat, durationMin: dur } });
  }
  // loyalty tiers + rewards (DATA-034..038)
  const tierDefs: [string, number, string][] = [
    ["Bronze", 0, "Base membership"], ["Silver", 1000, "5% off parts"], ["Gold", 3000, "10% off parts + priority slot"],
  ];
  for (const [nm, min, ben] of tierDefs) {
    await prisma.loyaltyTier.create({ data: { organisationId: org.id, name: nm, minPoints: min, benefits: ben } });
  }
  await prisma.reward.createMany({ data: [
    { organisationId: org.id, name: "RM50 Service Voucher", pointsRequired: 500, description: "RM50 off any service" },
    { organisationId: org.id, name: "Free Oil Change", pointsRequired: 800, description: "Engine oil change service" },
  ] });
  // message templates (DATA-032)
  await prisma.messageTemplate.createMany({ data: [
    { organisationId: org.id, name: "Booking Confirmation", channel: "WHATSAPP", body: "Hi {name}, your {service} booking for {bike} at {branch} is confirmed for {date} {time}. Ref: {ref}" },
    { organisationId: org.id, name: "Service Reminder", channel: "WHATSAPP", body: "Hi {name}, your {bike} is due for service. Book now: {link}" },
    { organisationId: org.id, name: "Invoice Ready", channel: "WHATSAPP", body: "Hi {name}, invoice {invoice} is ready for collection. Total: {total}" },
  ] });
  // integration configs (DATA-044) — disabled by default; providers abstracted in src/providers
  await prisma.integrationConfig.createMany({ data: [
    { organisationId: org.id, provider: "WHATSAPP", enabled: false },
    { organisationId: org.id, provider: "SMS", enabled: false },
    { organisationId: org.id, provider: "EMAIL", enabled: false },
    { organisationId: org.id, provider: "OPENAI", enabled: false },
    { organisationId: org.id, provider: "PAYMENT", enabled: false },
  ] });
  // system roles mirror enum Role (ROLE-001..)
  const roleNames = ["SUPER_ADMIN", "OWNER", "HEAD_OFFICE_ADMIN", "MANAGER", "SALES_MANAGER", "SALES_ADVISOR", "SERVICE_MANAGER", "SERVICE_ADVISOR", "COUNTER_STAFF", "CUSTOMER_SERVICE", "MECHANIC", "PARTS_MANAGER", "INVENTORY", "MARKETING", "ACCOUNTING", "AUDITOR"];
  for (const rn of roleNames) {
    await prisma.roleConfig.create({ data: { organisationId: org.id, name: rn, isSystem: true } });
  }
  // inventory location + appointment slot samples (KL branch)
  await prisma.inventoryLocation.create({ data: { branchId: kl.id, name: "Main Store", code: "KL-01" } });
  const slotTimes = ["09:00", "11:00", "14:00", "16:00"];
  for (let d = 0; d < 7; d++) {
    for (const st of slotTimes) {
      await prisma.appointmentSlot.create({ data: { branchId: kl.id, date: utcDay(d), startTime: st, maxBookings: 2 } });
    }
  }
  // demo leads (segment 3): website/whatsapp enquiries in various pipeline stages
  const srcById: Record<string, string> = {};
  for (const nm of sourceNames) {
    const s = await prisma.leadSource.findFirst({ where: { organisationId: org.id, name: nm } });
    if (s) srcById[nm] = s.id;
  }
  const stageById: Record<string, string> = {};
  for (const [i, nm] of stageNames.entries()) {
    const s = await prisma.leadStage.findFirst({ where: { organisationId: org.id, name: nm } });
    if (s) stageById[nm] = s.id;
  }
  const leadDefs: [string, string, string, string, string, number, string][] = [
    // name, phone, source, stage, model, valueRM, assignedFirst
    ["Farid Zulkifli", "011-2233 4455", "WhatsApp", "Contacted", "Yamaha Y16ZR", 11000, "Syafiq"],
    ["Siti Nurhaliza", "013-9988 7766", "Website", "Qualified", "Honda ADV160", 13500, "Daniel"],
    ["Kevin Lim", "016-5544 3322", "Walk-in", "Test Ride", "Kawasaki Ninja 250", 24000, "Syafiq"],
    ["Aina Mardhiah", "017-1122 3344", "Social Media", "New Enquiry", "Modenas Dominar D400", 19000, ""],
    ["Raj Kumar", "012-7788 9900", "Phone", "Proposal", "Suzuki GSX-R150", 16500, "Daniel"],
  ];
  let leadCount = 0;
  for (const [name, phone, src, stage, model, valRM, assigned] of leadDefs) {
    const u = assigned ? staff[assigned] : null;
    await prisma.lead.create({
      data: {
        leadNumber: "LD-" + Date.now().toString().slice(-8) + "-" + String(leadCount + 1).padStart(3, "0"),
        organisationId: org.id,
        branchId: kl.id,
        customerName: name,
        phone,
        sourceId: srcById[src],
        stageId: stageById[stage],
        motorcycleInterest: model,
        estimatedValueSen: RM(valRM),
        assignedUserId: u,
        nextFollowUpAt: u ? daysFromNow(int(0, 3)) : null,
        status: "OPEN",
      },
    });
    leadCount++;
  }
  // demo automation rule: auto-create follow-up task on new lead (AUTO-006/016)
  await prisma.automationRule.create({
    data: {
      organisationId: org.id,
      name: "Auto follow-up on new lead",
      triggerType: "EVENT",
      trigger: "LEAD_CREATED",
      actions: JSON.stringify([{ type: "CREATE_TASK", title: "Follow up new lead", dueInDays: 1, priority: "NORMAL" }]),
      active: true,
    },
  });
  counts.automationRules = 1;
  counts.leads = leadCount;
  counts.leadStages = stageNames.length; counts.leadSources = sourceNames.length;
  counts.serviceTypes = svcDefs.length; counts.loyaltyTiers = tierDefs.length; counts.rewards = 2;
  counts.messageTemplates = 3; counts.appointmentSlots = 7 * slotTimes.length;

  counts.orgs = 1; counts.branches = branches.length; counts.customers = customers.length; counts.motorcycles = bikeIds.length;
  counts.jobs = jobNumbers.length; counts.users = staffDefs.length;
  return counts;
}

// direct-run guard (tsx prisma/seed.ts)
import { pathToFileURL } from "node:url";
const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  runSeed()
    .then((c) => { console.log("Seed complete:", JSON.stringify(c)); return prisma.$disconnect(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
