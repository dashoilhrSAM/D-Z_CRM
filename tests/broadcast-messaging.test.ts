// Campaign broadcast — must send through messagingModule so MSG-017 opt-out, the real
// delivery status and MSG-020 failure records all apply, and must count only real successes.
// Regression for the previous direct-provider bypass where `sent++` ran unconditionally.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSend, mockMessageCreate, dbMock } = vi.hoisted(() => {
  const mockSend = vi.fn();
  const mockMessageCreate = vi.fn();
  const dbMock = {
    customer: { findUnique: vi.fn(), findMany: vi.fn() },
    customerConsent: { findUnique: vi.fn() },
    campaign: { findUnique: vi.fn() },
    branch: { findFirst: vi.fn() },
    organisation: { findFirst: vi.fn() },
    message: { create: mockMessageCreate },
  };
  return { mockSend, mockMessageCreate, dbMock };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/marketing/service", () => ({ marketingService: {} }));
vi.mock("@/providers", () => ({ messagingProvider: { name: "mock-whatsapp", send: mockSend } }));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/session-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ role: "MANAGER", branchId: "b-testing" }),
}));

import { broadcastCampaign } from "@/actions/marketing";

const customerA = { id: "c1", phone: "+60111111111", name: "Ahmad", organisationId: "o1", branchId: "b-testing" };
const customerB = { id: "c2", phone: "+60222222222", name: "Bala", organisationId: "o1", branchId: "b-testing" };

describe("broadcastCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.organisation.findFirst.mockResolvedValue({ id: "o1" });
    dbMock.branch.findFirst.mockResolvedValue({ id: "b-testing" });
    dbMock.campaign.findUnique.mockResolvedValue({ id: "camp1", name: "Raya", audience: "ALL", audienceRules: null, branchId: "b-kl", discountPercent: 10 });
    dbMock.customer.findMany.mockResolvedValue([customerA, customerB]);
    dbMock.customer.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(where.id === "c1" ? customerA : customerB));
    mockMessageCreate.mockResolvedValue({ id: "m1" });
  });

  it("counts only real successes, not failed sends", async () => {
    dbMock.customerConsent.findUnique.mockResolvedValue(null);
    mockSend
      .mockResolvedValueOnce({ ok: true, externalId: "wa-1", status: "SENT" })
      .mockResolvedValueOnce({ ok: false, externalId: null, status: "FAILED" });

    const r = await broadcastCampaign({ campaignId: "camp1", message: "Promo" });

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(r.sent).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.skipped).toBe(0);
    expect(r.audience).toBe(2);
  });

  it("skips opted-out customers instead of messaging them (MSG-017)", async () => {
    dbMock.customerConsent.findUnique.mockImplementation(({ where }: { where: { customerId: string } }) =>
      Promise.resolve(where.customerId === "c1" ? { marketingOptIn: false } : { marketingOptIn: true }));
    mockSend.mockResolvedValue({ ok: true, externalId: "wa-x", status: "SENT" });

    const r = await broadcastCampaign({ campaignId: "camp1" });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith("+60222222222", expect.any(String));
    expect(r.skipped).toBe(1);
    expect(r.sent).toBe(1);
  });

  it("persists the real FAILED status when the provider reports failure (MSG-020)", async () => {
    dbMock.customerConsent.findUnique.mockResolvedValue(null);
    mockSend.mockResolvedValue({ ok: false, externalId: null, status: "FAILED" });

    await broadcastCampaign({ campaignId: "camp1" });

    expect(mockMessageCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "FAILED" }) });
  });

  it("attributes messages to the campaign's own branch", async () => {
    dbMock.customerConsent.findUnique.mockResolvedValue(null);
    mockSend.mockResolvedValue({ ok: true, externalId: "wa-1", status: "SENT" });

    await broadcastCampaign({ campaignId: "camp1" });

    // A campaign belongs to a branch; the operator running the broadcast may be viewing
    // from elsewhere (org-level role, or a different branch), so the campaign wins.
    expect(mockMessageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ branchId: "b-kl", referenceType: "CAMPAIGN", referenceId: "camp1" }),
    });
  });
});
