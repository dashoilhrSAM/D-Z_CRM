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
  spawnSync: () => ({ stdout: "200", stderr: "", status: 0, signal: null, pid: 1, output: [null, "200", ""] }),
}));

it("recreates an empty SQLite file before migrating a wiped E2E database", async () => {
  fixture.root = mkdtempSync(join(tmpdir(), "dz-e2e-setup-"));
  const previousUrl = process.env.DATABASE_URL;
  try {
    mkdirSync(join(fixture.root, "prisma"));
    writeFileSync(join(fixture.root, "prisma/e2e.db"), "stale demo data");
    writeFileSync(join(fixture.root, "prisma/e2e.db-journal"), "stale journal");
    await globalSetup();
    expect(readFileSync(join(fixture.root, "prisma/e2e.db")).length).toBe(0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
