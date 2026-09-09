// Messaging module — real provider delivery, opt-out guard, template rendering.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSend, mockMessageCreate, dbMock } = vi.hoisted(() => {
  const mockSend = vi.fn();
  const mockMessageCreate = vi.fn();
  const dbMock = {
    customer: { findUnique: vi.fn() },
    customerConsent: { findUnique: vi.fn() },
    messageTemplate: { findUnique: vi.fn() },
    message: { create: mockMessageCreate },
  };
  return { mockSend, mockMessageCreate, dbMock };
});

vi.mock("@/providers", () => ({
  messagingProvider: { name: "mock-whatsapp", send: mockSend },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import { messagingModule, renderTemplate } from "@/modules/messaging/service";

const customer = { id: "c1", phone: "+60123456789", name: "Ahmad", organisationId: "o1", branchId: "b1" };

describe("messagingModule.sendDirect", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delivers via the provider and persists the real status + externalId", async () => {
    mockSend.mockResolvedValue({ ok: true, externalId: "wa-123", status: "SENT" });
    dbMock.customer.findUnique.mockResolvedValue(customer);
    dbMock.customerConsent.findUnique.mockResolvedValue(null);
    const out = await messagingModule.sendDirect({ customerId: "c1", body: "Hello", referenceType: "TEST" });
    expect(out.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledWith("+60123456789", "Hello");
    expect(mockMessageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "SENT", externalId: "wa-123", referenceType: "TEST", customerId: "c1", direction: "OUT", channel: "WHATSAPP" }),
    });
  });

  it("persists FAILED when the provider throws (MSG-020)", async () => {
    mockSend.mockRejectedValue(new Error("boom"));
    dbMock.customer.findUnique.mockResolvedValue(customer);
    dbMock.customerConsent.findUnique.mockResolvedValue(null);
    const out = await messagingModule.sendDirect({ customerId: "c1", body: "Hi" });
    expect(out.sent).toBe(false);
    expect(mockMessageCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "FAILED", externalId: null }) });
  });

  it("blocks marketing sends for opted-out customers", async () => {
    dbMock.customer.findUnique.mockResolvedValue(customer);
    dbMock.customerConsent.findUnique.mockResolvedValue({ marketingOptIn: false });
    await expect(messagingModule.sendDirect({ customerId: "c1", body: "promo", isMarketing: true })).rejects.toThrow("CUSTOMER_OPTED_OUT");
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("messagingModule.sendFromTemplate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders {name} + vars and delivers via the provider", async () => {
    mockSend.mockResolvedValue({ ok: true, externalId: "wa-t", status: "SENT" });
    dbMock.customer.findUnique.mockResolvedValue({ ...customer, phone: null });
    dbMock.customerConsent.findUnique.mockResolvedValue(null);
    dbMock.messageTemplate.findUnique.mockResolvedValue({ id: "t1", channel: "WHATSAPP", body: "Hi {name}, ref {ref}" });
    const out = await messagingModule.sendFromTemplate({ customerId: "c1", templateId: "t1", vars: { ref: "DZ-5" } });
    expect(out.body).toBe("Hi Ahmad, ref DZ-5");
    expect(mockSend).toHaveBeenCalledWith("Ahmad", "Hi Ahmad, ref DZ-5");
  });
});

describe("renderTemplate", () => {
  it("leaves unknown tokens untouched", () => {
    expect(renderTemplate("Hi {name} {missing}", { name: "Ali" })).toBe("Hi Ali {missing}");
  });
});
