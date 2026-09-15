#!/usr/bin/env tsx
/**
 * 设置门店考勤坐标（地理围栏锚点）。
 * =================================
 * 平时应该用 /workshop/settings 界面改（那里有校验和审计）。这个脚本是给
 * **首次初始化**和**部署后批处理**用的——两者都需要一条不用打开浏览器、
 * 也不会忘记写审计的路径。
 *
 * 与界面同源：校验规则、审计动作名（ATTENDANCE_GEOFENCE_SET）都跟
 * src/actions/settings.ts 的 updateBranch 保持一致，免得两条路各写一套。
 *
 * ⚠️ 这个脚本走的是**当前 DATABASE_URL 指向的库**，而本地生成的 Prisma client 是
 * **sqlite 方言**（prisma/schema.prisma），连不上生产 PG。所以：
 *   · 本地/CI/演示库 → 用这个脚本；
 *   · 生产 → 在 /workshop/settings 界面里填（那是应用内的 PG client，还会自动写审计），
 *     或部署后用 service key 走 PostgREST PATCH。
 *
 * 用法：
 *   pnpm exec tsx scripts/set-branch-geofence.ts --main 3.1111141 101.6316582
 *   pnpm exec tsx scripts/set-branch-geofence.ts --name "D&Z Smart Workshop" 3.1111141 101.6316582
 *   pnpm exec tsx scripts/set-branch-geofence.ts --list          # 只看现状
 *   pnpm exec tsx scripts/set-branch-geofence.ts --main --clear  # 清掉（回到"不做围栏判断"）
 */
import { PrismaClient } from "@prisma/client";
import * as path from "node:path";

try { process.loadEnvFile(path.join(process.cwd(), ".env")); } catch {}

const db = new PrismaClient();

/** 与 src/lib/geo.ts 的 isValidLatLng 同规则（0,0 视为无效——那是"没有定位"的伪装值）。 */
function isValidLatLng(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

const argOf = (name: string): string | null => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const has = (name: string) => process.argv.includes("--" + name);

async function list() {
  const rows = await db.branch.findMany({ select: { name: true, city: true, latitude: true, longitude: true, isMain: true }, orderBy: [{ isMain: "desc" }, { name: "asc" }] });
  console.log("branches:");
  for (const b of rows) {
    const coords = b.latitude != null && b.longitude != null ? b.latitude + ", " + b.longitude : "(未设坐标 → 打卡记 NO_GEOFENCE)";
    console.log("  " + (b.isMain ? "* " : "  ") + b.name + " · " + b.city + " · " + coords);
  }
}

async function main() {
  console.log("target db:", process.env.DATABASE_URL ?? "(from .env)");
  await list();

  const clear = has("clear");
  const nameArg = argOf("name");
  const byMain = has("main");
  if (!clear && !nameArg && !byMain) return; // 只 --list

  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== nameArg);
  const lat = clear ? null : Number(positional[0]);
  const lng = clear ? null : Number(positional[1]);
  if (!clear && (!Number.isFinite(lat!) || !Number.isFinite(lng!))) {
    console.error("用法: --main|--name <名> <lat> <lng>  |  --main|--name <名> --clear");
    process.exit(1);
  }
  if (!clear && !isValidLatLng(lat!, lng!)) {
    console.error("坐标不合法（注意 (0,0) 视为无效——那是「没有定位」的伪装值）");
    process.exit(1);
  }

  const branch = byMain
    ? await db.branch.findFirst({ where: { isMain: true }, select: { id: true, name: true, latitude: true, longitude: true } })
    : await db.branch.findFirst({ where: { name: nameArg! }, select: { id: true, name: true, latitude: true, longitude: true } });
  if (!branch) { console.error("找不到分行"); process.exit(1); }

  const before = { latitude: branch.latitude, longitude: branch.longitude };
  if (before.latitude === lat && before.longitude === lng) {
    console.log("\n已是目标值，无需改动:", branch.name);
    return;
  }
  await db.branch.update({ where: { id: branch.id }, data: { latitude: lat, longitude: lng } });

  // 与界面同一动作名：老板在界面里改和在这里改，审计里要看得出是同一类事
  const org = await db.organisation.findFirst({ select: { id: true } });
  if (org) {
    await db.auditLog.create({
      data: {
        organisationId: org.id,
        branchId: branch.id,
        userId: null,
        action: "ATTENDANCE_GEOFENCE_SET",
        entity: "Branch",
        entityId: branch.id,
        before: JSON.stringify(before),
        after: JSON.stringify({ latitude: lat, longitude: lng }),
      },
    });
  }
  console.log("\n✓ " + branch.name);
  console.log("  before:", JSON.stringify(before));
  console.log("  after :", JSON.stringify({ latitude: lat, longitude: lng }));
  console.log("  审计  : ATTENDANCE_GEOFENCE_SET 已记录");
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error("failed:", e); await db.$disconnect(); process.exit(1); });
