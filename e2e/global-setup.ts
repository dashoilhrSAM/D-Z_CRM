import { execSync, spawnSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

/** Wipe + migrate + seed the E2E database (§76: never test against real data). */
export default async function globalSetup() {
  process.env.DATABASE_URL = "file:./e2e.db";
  const root = path.resolve(__dirname, "..");
  // hard wipe so the seed always starts from an empty schema (seed is not idempotent)
  for (const f of ["prisma/e2e.db", "prisma/e2e.db-journal"]) {
    fs.rmSync(path.join(root, f), { force: true });
  }
  // migrate deploy can fail with P1003 when the SQLite file does not exist.
  fs.writeFileSync(path.join(root, "prisma/e2e.db"), "", { flag: "wx" });
  execSync("pnpm exec prisma migrate deploy", { cwd: root, env: process.env, stdio: "inherit" });
  execSync("pnpm exec tsx prisma/seed.ts", { cwd: root, env: process.env, stdio: "inherit" });
  // e2e 用真实 Supabase 登录：播种后把 User/Customer 绑定到 auth 用户（email → authId）
  execSync("pnpm exec tsx e2e/link-auth.ts", { cwd: root, env: process.env, stdio: "inherit" });

  // The E2E server runs under launchd (com.dz-platform.e2e, port 3102). Its
  // PrismaClient may hold a stale SQLite handle from before the wipe — restart
  // it so every query hits the freshly seeded database.
  try {
    execSync("launchctl kickstart -k gui/$(id -u)/com.dz-platform.e2e", { stdio: "ignore" });
  } catch {
    console.log("[global-setup] (could not kickstart e2e launchd service — continuing)");
  }
  // wait for the server to come back
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const r = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "3", "http://localhost:3102/workshop/dashboard"], { encoding: "utf8" });
    if (r.stdout.trim() === "200") { console.log("[global-setup] e2e server healthy on :3102"); break; }
    await new Promise((res) => setTimeout(res, 2000));
  }
  console.log("[global-setup] e2e.db wiped, migrated + seeded (pristine demo state)");
}
