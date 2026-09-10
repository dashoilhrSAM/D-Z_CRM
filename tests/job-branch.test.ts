// The mechanic picker and the action that accepts the assignment must agree about who is
// assignable. They did not: the dropdown listed every branch the user could see, while
// createJob refused anyone outside the job's own branch, so an owner was offered names
// that were guaranteed to fail on submit.
//
// The fix was to write the rule down once. These tests cover the rule, and guard the three
// consumers against quietly growing their own copy again.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ASSIGNABLE_ROLES, staffWhereForBranch } from "@/lib/job-branch";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

describe("staffWhereForBranch", () => {
  it("restricts to one branch when a branch is known", () => {
    expect(staffWhereForBranch("branch-a")).toMatchObject({ branchId: "branch-a", active: true });
  });

  it("offers mechanics and managers, since both can be given a job", () => {
    expect(ASSIGNABLE_ROLES).toEqual(["MECHANIC", "MANAGER"]);
    expect(staffWhereForBranch("branch-a")).toMatchObject({ role: { in: ["MECHANIC", "MANAGER"] } });
  });

  /**
   * A null branch means "do not filter", matching the scope helper: a half-configured
   * account should see too much rather than be locked out of its own workshop. The point of
   * pinning it is that it must be an explicit absence of the key, not branchId: null — which
   * Prisma would treat as a filter for rows with no branch at all.
   */
  it("omits the branch filter entirely rather than filtering on null", () => {
    const where = staffWhereForBranch(null);
    expect("branchId" in where).toBe(false);
    expect(where).toMatchObject({ active: true });
  });

  it("never returns inactive staff", () => {
    expect(staffWhereForBranch("b")).toMatchObject({ active: true });
  });
});

describe("one definition of the assignable-branch rule", () => {
  const consumers = [
    "src/actions/workshop.ts",
    "src/app/workshop/jobs/new/page.tsx",
    "src/app/workshop/jobs/[id]/page.tsx",
  ];

  /**
   * createJob puts a new job in the session's branch (org-level falls back to main). Both
   * picking pages used to work that out, or rather not work it out, on their own. If any of
   * them stops importing the shared module this bug is free to come back.
   */
  it("every page and action that assigns a mechanic uses the shared resolver", () => {
    for (const file of consumers) {
      expect(read(file), file + " stopped using the shared branch rule").toContain("lib/job-branch");
    }
  });

  it("no longer derives the new-job branch inline inside createJob", () => {
    const definition = read("src/lib/job-branch.ts");
    expect(definition).toContain("export async function resolveNewJobBranchId");

    // Scoped to createJob on purpose: other actions in this file still resolve a branch
    // with their own inline copy (for bookings, staff and purchase orders). Those are a
    // separate piece of work, and a whole-file assertion here would fail on them without
    // saying anything about the bug this covers.
    const src = read("src/actions/workshop.ts");
    const start = src.indexOf("export async function createJob");
    const end = src.indexOf("export async function", start + 10);
    const createJob = src.slice(start, end === -1 ? undefined : end);
    expect(createJob).toContain("resolveNewJobBranchId");
    expect(createJob).not.toContain("isMain: true");
  });
});

describe("mechanic option labels", () => {
  it("appends the branch only when a list spans branches", async () => {
    const { spansBranches, mechanicLabel } = await import("@/components/workshop/mechanic-option");
    const one = [{ id: "1", name: "Aizat", branchName: "D&Z Smart Workshop" }];
    const two = [...one, { id: "2", name: "Outsider", branchName: "E2E Other Branch" }];

    expect(spansBranches(one)).toBe(false);
    expect(mechanicLabel(one[0], spansBranches(one))).toBe("Aizat");

    expect(spansBranches(two)).toBe(true);
    expect(mechanicLabel(two[1], spansBranches(two))).toBe("Outsider · E2E Other Branch");
  });

  it("treats a missing branch name as no branch at all", async () => {
    const { spansBranches, mechanicLabel } = await import("@/components/workshop/mechanic-option");
    const rows = [{ id: "1", name: "A", branchName: null }, { id: "2", name: "B", branchName: null }];
    expect(spansBranches(rows)).toBe(false);
    expect(mechanicLabel(rows[0], spansBranches(rows))).toBe("A");
  });
});
