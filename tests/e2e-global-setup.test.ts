import { expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import globalSetup from "../e2e/global-setup";

const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:path")>();
  return { ...actual, resolve: (...args: string[]) =>
    args.length === 2 && args[1] === ".." ? fixture.root : actual.resolve(...args) };
});
// Keep file operations real; replace seeding, auth and launchd subprocesses.
vi.mock("node:child_process", () => ({
  execSync: (command: string) => {
    if (command === "pnpm exec prisma migrate deploy") {
      expect(existsSync(join(fixture.root, "prisma/e2e.db")), "migration needs an existing SQLite file").toBe(true);
      expect(readFileSync(join(fixture.root, "prisma/e2e.db")).length).toBe(0);
      expect(existsSync(join(fixture.root, "prisma/e2e.db-journal"))).toBe(false);
    }
    return Buffer.alloc(0);
  },
  spawnSync: () => {
    expect(process.env.CI, "CI prepares the database before its server exists").not.toBe("true");
    return { stdout: "200", stderr: "", status: 0, signal: null, pid: 1, output: [null, "200", ""] };
  },
}));

it.each([false, true])("recreates an empty SQLite file before migration (CI=%s)", async (ci) => {
  fixture.root = mkdtempSync(join(tmpdir(), "dz-e2e-setup-"));
  const previousUrl = process.env.DATABASE_URL;
  const previousCi = process.env.CI;
  try {
    if (ci) process.env.CI = "true";
    else delete process.env.CI;
    mkdirSync(join(fixture.root, "prisma"));
    writeFileSync(join(fixture.root, "prisma/e2e.db"), "stale demo data");
    writeFileSync(join(fixture.root, "prisma/e2e.db-journal"), "stale journal");
    await globalSetup();
    expect(readFileSync(join(fixture.root, "prisma/e2e.db")).length).toBe(0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousCi === undefined) delete process.env.CI;
    else process.env.CI = previousCi;
  }
});

it("CI prepares its database before starting a fresh server, with no later reset", async () => {
  vi.stubEnv("CI", "true");
  try {
    const { default: config } = await import("../playwright.config");
    expect(config.globalSetup, "globalSetup runs after webServer and must not wipe its open database").toBeUndefined();
    expect(config.webServer).toMatchObject({ reuseExistingServer: false });
    const command = (config.webServer as { command: string }).command;
    const prepare = command.indexOf("tsx e2e/global-setup.ts");
    expect(prepare, "cold startup must initialize the database").toBeGreaterThanOrEqual(0);
    expect(command.indexOf("pnpm start")).toBeGreaterThan(prepare);
  } finally {
    vi.unstubAllEnvs();
  }
});
