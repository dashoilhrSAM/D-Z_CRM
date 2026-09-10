// Lead branch attribution — leads are branch-scoped operational data and the leads list
// filters by session.branchId, so a branch-level user's lead must land in their own branch.
// Regression: createLead used to hardcode the main branch, making the new lead invisible
// to the very user who created it.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate, dbMock } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  const dbMock = {
    organisation: { findFirst: vi.fn() },
    branch: { findFirst: vi.fn() },
    leadSource: { findFirst: vi.fn(), create: vi.fn() },
  };
  return { mockCreate, dbMock };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/modules/leads/service", () => ({
  leadsModule: { create: mockCreate, findDuplicates: vi.fn().mockResolvedValue([]) },
}));
vi.mock("@/lib/session-user", () => ({ getSessionUser: vi.fn() }));

import { createLead } from "@/actions/leads";
import { getSessionUser } from "@/lib/session-user";

const asMock = getSessionUser as unknown as ReturnType<typeof vi.fn>;

describe("createLead branch attribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.organisation.findFirst.mockResolvedValue({ id: "o1" });
    dbMock.leadSource.findFirst.mockResolvedValue({ id: "src1" });
    mockCreate.mockResolvedValue({ id: "l1", leadNumber: "LD-1" });
  });

  it("attributes the lead to the session branch for a branch-level user", async () => {
    asMock.mockResolvedValue({ role: "MANAGER", branchId: "b-testing" });
    dbMock.branch.findFirst.mockResolvedValue({ id: "b-testing" });

    await createLead({ customerName: "Ahmad", phone: "+60123456789", sourceId: "src1" });

    expect(dbMock.branch.findFirst).toHaveBeenCalledWith({ where: { id: "b-testing", organisationId: "o1" } });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ branchId: "b-testing", organisationId: "o1" }));
  });

  it("falls back to the main branch for an org-level role", async () => {
    asMock.mockResolvedValue({ role: "OWNER", branchId: null });
    dbMock.branch.findFirst.mockResolvedValue({ id: "b-main" });

    await createLead({ customerName: "Bala", phone: "+60199999999", sourceId: "src1" });

    expect(dbMock.branch.findFirst).toHaveBeenCalledWith({ where: { organisationId: "o1", isMain: true } });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ branchId: "b-main" }));
  });
});
