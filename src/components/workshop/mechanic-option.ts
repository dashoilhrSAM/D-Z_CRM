// The shape of a mechanic offered for assignment, and how to label one.
//
// This was declared identically in three form components (create, repair, edit), which is
// how the label logic ended up duplicated too. One definition, one place to change the
// label.

export interface MechanicOption {
  id: string;
  name: string;
  branchName?: string | null;
}

/**
 * Whether to show the branch next to a mechanic name.
 *
 * Only when the list genuinely spans branches. The assignment pickers are scoped to the
 * job's own branch, so there the suffix is noise — and it was the suffix that pushed the
 * text past the width of the dropdown and got it sliced off.
 */
export function spansBranches(mechanics: MechanicOption[]): boolean {
  return new Set(mechanics.map((m) => m.branchName ?? "")).size > 1;
}

/** The label for one option. */
export function mechanicLabel(m: MechanicOption, showBranch: boolean): string {
  return showBranch && m.branchName ? m.name + " · " + m.branchName : m.name;
}
