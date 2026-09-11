#!/usr/bin/env node
/**
 * Start a new change entry.
 *
 * Creates docs/changes/YYYY-MM-DD-<slug>.md and nothing else. That is the whole point: two
 * branches working at the same time create two different files, so merging them cannot
 * conflict. Adding a row to a shared ledger and a paragraph to a shared handoff could not
 * avoid it — both branches edit the same lines.
 *
 * Usage:
 *   pnpm new:change fix-rider-news-leak
 */
import { existsSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";

const slug = process.argv[2];
if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error("Usage: pnpm new:change <slug>   (lowercase letters, digits and dashes)");
  console.error("Example: pnpm new:change fix-rider-news-leak");
  process.exit(1);
}

const dir = path.join(process.cwd(), "docs", "changes");
const date = new Date().toISOString().slice(0, 10);
const file = path.join(dir, date + "-" + slug + ".md");

if (existsSync(file)) {
  console.error("Already exists: " + path.relative(process.cwd(), file));
  process.exit(1);
}

const branch = (() => {
  try {
    return require("node:child_process").execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  } catch { return ""; }
})();

const body = [
  "---",
  "date: " + date,
  "title: ",
  "branch: " + branch,
  "---",
  "",
  "## 改动",
  "",
  "",
  "## 影响",
  "",
  "",
  "## 交接说明",
  "",
  "",
].join("\n");

writeFileSync(file, body);
console.log("Created " + path.relative(process.cwd(), file));
const all = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort();
console.log("Change entries now: " + all.length + " (newest: " + all[all.length - 1] + ")");
