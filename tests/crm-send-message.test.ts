// CrmService.sendMessage must delegate to messagingModule so marketing opt-out (MSG-017),
// the real delivery status/externalId and MSG-020 failure records all apply — and so the
// message is attributed to the customer's branch instead of a hardcoded `branchId: null`.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSend, mockMessageCreate, dbMock } = vi.hoisted(() => {
  const mockSend = vi.fn();
  const mockMessageCreate = vi.fn();
  const dbMock = {
    customer: { findUnique: vi.fn() },
    customerConsent: { findUnique: vi.fn() },
    message: { create: mockMessageCreate },
  };
  return { mockSend, mockMessageCreate, dbMock };
});

vi.mock("@/providers", () => ({ messagingProvider: { name: "mock-whatsapp", send: mockSend } }));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import { CrmService } from "@/modules/crm/service";

const customer = { id: "c1", phone: "+60123456789", name: "Ahmad", organisationId: "o1", branchId: "b-testing" };

describe("CrmService.sendMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.customer.findUnique.mockResolvedValue(customer);
    dbMock.customerConsent.findUnique.mockResolvedValue(null);
    mockMessageCreate.mockResolvedValue({ id: "m1" });
  });

  it("delivers via the provider and records the real status plus branch attribution", async () => {
    mockSend.mockResolvedValue({ ok: true, externalId: "wa-9", status: "SENT" });

    await new CrmService({} as never).sendMessage({ customerId: "c1", body: "Hi" });

    expect(mockSend).toHaveBeenCalledWith("+60123456789", "Hi");
    expect(mockMessageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "SENT", externalId: "wa-9", branchId: "b-testing", direction: "OUT", channel: "WHATSAPP",
      }),
    });
  });

  it("still blocks marketing sends to opted-out customers (MSG-017)", async () => {
    dbMock.customerConsent.findUnique.mockResolvedValue({ marketingOptIn: false });

    await expect(
      new CrmService({} as never).sendMessage({ customerId: "c1", body: "promo", isMarketing: true }),
    ).rejects.toThrow("CUSTOMER_OPTED_OUT");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("records FAILED when the provider throws (MSG-020)", async () => {
    mockSend.mockRejectedValue(new Error("boom"));

    await new CrmService({} as never).sendMessage({ customerId: "c1", body: "Hi" });

    expect(mockMessageCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "FAILED" }) });
  });
});
