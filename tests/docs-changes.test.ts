// The change log is one file per change so that two branches cannot conflict.
//
// This test exists because the previous arrangement made conflicts unavoidable: every branch
// inserted a row at the top of the §9 ledger and a paragraph at the top of HANDOFF, so the
// second of any two open branches always conflicted. It happened twice, and both times the fix
// was manual splicing of documentation.
//
// A rule that is only written in a README gets forgotten, so the freeze is enforced here.
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

/** Entries dated after this must live in docs/changes/, not in the frozen tables. */
const FROZEN_AT = "2026-09-11";

describe("the frozen change tables stay frozen", () => {
  /**
   * The guard that would have stopped the repeated conflict. Adding a row with a date past the
   * freeze means someone is using the old workflow again, and the next merge will conflict.
   */
  it("no new rows were added to the §9 ledger after the freeze", () => {
    const src = read("docs/SETUP_AND_PREPARATION.md");
    // matchAll, not match: a /g regex returns whole matches and drops the capture group, so the
    // first version of this compared empty strings and passed no matter what was added.
    const dates = [...src.matchAll(/^\| (\d{4}-\d{2}-\d{2}) \|/gm)].map((m) => m[1]);
    expect(dates.length, "the ledger table went missing — update this guard").toBeGreaterThan(50);
    const newest = [...dates].sort().pop() ?? "";
    expect(newest, "could not read a date out of the ledger — this guard would be vacuous").toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      newest <= FROZEN_AT,
      "the §9 ledger has an entry dated " + newest + ", past the " + FROZEN_AT + " freeze.\n" +
      "Write the change as docs/changes/<date>-<slug>.md instead (pnpm new:change <slug>).\n" +
      "Two branches both inserting here is what caused the merge conflicts this freeze exists to stop.",
    ).toBe(true);
  });

  it("tells the reader where to write instead", () => {
    expect(read("docs/SETUP_AND_PREPARATION.md")).toContain("本表已冻结");
    expect(read("docs/HANDOFF.md")).toContain("逐次改动不要再往本文件加段落");
  });
});

describe("one file per change", () => {
  const dir = path.join(root, "docs", "changes");
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort()
    : [];

  it("documents the convention", () => {
    expect(existsSync(path.join(dir, "README.md")), "docs/changes/README.md explains why this exists").toBe(true);
    expect(read("docs/changes/README.md")).toContain("新建一个文件");
  });

  it("ships a scaffold, so the workflow is one command", () => {
    expect(existsSync(path.join(root, "scripts", "new-change.mjs"))).toBe(true);
  });

  it("has at least one entry", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("every entry is named with its date, so the newest sorts last", () => {
    for (const f of files) {
      expect(f, f + " should start with YYYY-MM-DD-").toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/);
    }
  });

  it("every entry carries the frontmatter the index reads", () => {
    for (const f of files) {
      const src = read(path.join("docs", "changes", f));
      expect(src.startsWith("---\n"), f + " must open with frontmatter").toBe(true);
      expect(src, f + " needs a date").toMatch(/^date: \d{4}-\d{2}-\d{2}$/m);
      expect(src, f + " needs a non-empty title").toMatch(/^title: \S.*$/m);
      expect(src, f + " needs a branch").toMatch(/^branch: \S+$/m);
    }
  });

  it("every entry is dated consistently with its own filename", () => {
    for (const f of files) {
      const src = read(path.join("docs", "changes", f));
      const date = (src.match(/^date: (\d{4}-\d{2}-\d{2})$/m) ?? [])[1];
      expect(date, f + " frontmatter date does not match its filename").toBe(f.slice(0, 10));
    }
  });
});
