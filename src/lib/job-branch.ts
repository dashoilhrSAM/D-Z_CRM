// Which branch a job belongs to — and therefore which mechanics can be assigned to it.
//
// WHY THIS EXISTS AS ONE FUNCTION
// --------------------------------
// The mechanic dropdown and the action that accepts the assignment each worked out the
// branch for themselves, and they disagreed. createJob put the job in the branch of the
// logged-in user (org-level roles fall back to the main branch) and refused a mechanic
// from anywhere else, while the dropdown listed everyone the user could see. For an owner
// that meant thirteen names on screen, four of which were guaranteed to fail on submit
// with "Mechanic belongs to a different branch."
//
// The rule was never wrong in either place; it was written down twice. So it lives here
// once, and both the pages and the actions call it.
import type { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { scopedBranchId, type BranchScopeSession } from "@/lib/branch-scope";

/** The roles that can be given a job. */
export const ASSIGNABLE_ROLES: readonly Role[] = ["MECHANIC", "MANAGER"];

/**
 * The branch a NEW job created by this session will belong to.
 *
 * Branch-level users are locked to their own branch; org-level users (owner, super admin,
 * head office) fall back to the main branch, which is what createJob has always done.
 * Returns null only when the database has no usable branch, which createJob treats as a
 * hard error rather than silently guessing.
 */
export async function resolveNewJobBranchId(session: BranchScopeSession): Promise<string | null> {
  const org = await db.organisation.findFirst({ select: { id: true } });
  if (!org) return null;
  const scope = scopedBranchId(session);
  const branch = await db.branch.findFirst({
    where: { organisationId: org.id, ...(scope ? { id: scope } : { isMain: true }) },
    select: { id: true },
  });
  return branch?.id ?? null;
}

/**
 * Where-clause for the staff assignable to a branch. Pure, so the rule is testable.
 *
 * A null branchId means "no branch filter", which is deliberately the same behaviour the
 * scope helper has: a half-configured account should see too much rather than be locked
 * out of its own workshop.
 */
export function staffWhereForBranch(branchId: string | null, roles: readonly Role[] = ASSIGNABLE_ROLES): Prisma.UserWhereInput {
  return { role: { in: [...roles] }, active: true, ...(branchId ? { branchId } : {}) };
}

/**
 * The assignable staff for a branch, shaped for the pickers.
 *
 * branchName is only meaningful when a list can span branches. Callers that scoped to one
 * branch should pass it through showBranch on the component so the redundant suffix does
 * not eat the width the name needs.
 */
export async function loadAssignableStaff(branchId: string | null, roles: readonly Role[] = ASSIGNABLE_ROLES) {
  const rows = await db.user.findMany({
    where: staffWhereForBranch(branchId, roles),
    select: { id: true, name: true, branch: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map((m) => ({ id: m.id, name: m.name, branchName: m.branch?.name ?? null }));
}
