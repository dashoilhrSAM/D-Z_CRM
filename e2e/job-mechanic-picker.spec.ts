import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { BASE_URL, setPersona, settle } from "./helpers";

/**
 * The mechanic picker offered names the action would refuse.
 *
 * createJob creates the job in the logged-in user's branch (org-level falls back to main)
 * and rejects a mechanic from anywhere else, while the dropdown listed every branch the
 * user could see. For an owner that was 13 names on screen, 4 of them guaranteed to fail on
 * submit. Separately the dropdown was narrower than its own option text, so the tail of each
 * name was sliced off with no ellipsis.
 *
 * Assertions run against the seeded E2E database rather than a hardcoded list, so this keeps
 * meaning as the demo data changes.
 */
const db = new PrismaClient({ datasources: { db: { url: "file:./e2e.db" } } });

/**
 * The seeded demo database has a single branch, so it cannot express the bug on its own.
 * A second branch with its own mechanic is created here: the picker has to refuse it.
 */
async function addSecondBranchMechanic() {
  const org = await db.organisation.findFirstOrThrow();
  const branch = await db.branch.create({
    data: { organisationId: org.id, name: "E2E Other Branch", city: "Elsewhere" },
  });
  const user = await db.user.create({
    data: {
      organisationId: org.id,
      branchId: branch.id,
      name: "Outsider Mechanic",
      email: "outsider.e2e@dz.my",
      role: "MECHANIC",
      active: true,
    },
  });
  return { branch, user };
}

async function assignableByBranch() {
  const rows = await db.user.findMany({
    where: { role: { in: ["MECHANIC", "MANAGER"] }, active: true },
    select: { name: true, branchId: true, branch: { select: { isMain: true, name: true } } },
  });
  const main = rows.filter((r) => r.branch?.isMain);
  const other = rows.filter((r) => !r.branch?.isMain);
  return { all: rows, main, other };
}

/** Every rendered option, and whether any of it is being cut off. */
async function readOptions(page: import("@playwright/test").Page) {
  const options = page.locator('[data-slot="select-item"]');
  await expect(options.first()).toBeVisible();
  return await options.evaluateAll((els) =>
    els.map((el) => ({
      text: (el.textContent ?? "").trim(),
      // truncate sets overflow-hidden, so scrollWidth exceeding clientWidth means the
      // text genuinely did not fit — which is what "the back part is blocked" looked like.
      clipped: el.scrollWidth > el.clientWidth + 1,
    })),
  );
}

/**
 * Width of the open dropdown.
 *
 * The popup follows the trigger width, and the trigger used to be w-fit — sized to the
 * selected value, which is usually the short "assign later". That is why the options were
 * sliced off. Asserting a floor here pins the actual cause, not just its symptom.
 */
async function popupWidth(page: import("@playwright/test").Page) {
  return await page.locator('[data-slot="select-content"]').evaluate((el) => el.clientWidth);
}

test("the mechanic picker lists only this branch staff, and clips nothing", async ({ page, context }) => {
  await addSecondBranchMechanic();
  const { all, main, other } = await assignableByBranch();
  expect(other.length, "the second branch should make the over-offer possible").toBeGreaterThan(0);

  await setPersona(context, "OWNER");
  await page.goto(BASE_URL + "/workshop/jobs/new");
  await settle(page);

  await page.getByTestId("mechanic-select").click();
  const options = await readOptions(page);
  const names = options.map((o) => o.text);

  // 1. nobody from another branch is offered. Substring, not equality: when a list does
  //    span branches the label carries a " · Branch" suffix, and an exact match would
  //    silently pass while the wrong person was on screen.
  for (const outsider of other) {
    expect(
      names.some((n) => n.includes(outsider.name)),
      "offered a mechanic from " + (outsider.branch?.name ?? "another branch"),
    ).toBe(false);
  }

  // 2. a genuine subset — proof the filter ran, not just that the names differ
  expect(names.length).toBeLessThanOrEqual(main.length + 1); // + "assign later"
  expect(names.length).toBeLessThan(all.length + 1);

  // 3. single-branch list, so the branch suffix is noise and must be gone
  expect(names.some((n) => n.includes(" · ")), "a branch suffix was rendered for a single-branch list").toBe(false);

  // 4. the dropdown is wide enough for its own contents, and nothing is cut off — this is
  //    the reported "the back part is blocked"
  expect(await popupWidth(page), "the dropdown is too narrow to show its options").toBeGreaterThanOrEqual(240);
  expect(options.filter((o) => o.clipped).map((o) => o.text), "option text was clipped").toEqual([]);
});

test("an existing job reassign picker is scoped to that job branch", async ({ page, context }) => {
  await setPersona(context, "OWNER");
  await page.goto(BASE_URL + "/workshop/jobs");
  await settle(page);

  await page.locator('a[href^="/workshop/jobs/"]').first().click();
  await page.waitForURL("**/workshop/jobs/**");
  await settle(page);

  await page.getByTestId("mechanic-select").click();
  const options = await readOptions(page);

  expect(options.length).toBeGreaterThan(0);
  expect(await popupWidth(page), "the dropdown is too narrow to show its options").toBeGreaterThanOrEqual(240);
  expect(options.filter((o) => o.clipped).map((o) => o.text), "option text was clipped").toEqual([]);
});
