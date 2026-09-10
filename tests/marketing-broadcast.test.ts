// MKT: one broadcast pipeline for every marketing send.
// Covers the guarantees that used to differ between the two hand-rolled loops:
// real-outcome counting, opt-out handling, and the frequency cap.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSendDirect, dbMock } = vi.hoisted(() => {
  const mockSendDirect = vi.fn();
  const dbMock = { message: { findMany: vi.fn() } };
  return { mockSendDirect, dbMock };
});

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/modules/messaging/service", () => ({ messagingModule: { sendDirect: mockSendDirect } }));

import { broadcast, limitRecipients, applyFrequencyCap, DEFAULT_FREQUENCY_CAP_DAYS } from "@/modules/marketing/broadcast";

describe("limitRecipients", () => {
  it("de-duplicates and reports overflow past the run cap", () => {
    expect(limitRecipients(["a", "b", "a", "c"], 10)).toEqual({ recipients: ["a", "b", "c"], overflow: 0 });
    expect(limitRecipients(["a", "b", "c"], 2)).toEqual({ recipients: ["a", "b"], overflow: 1 });
  });

  it("ignores empty ids", () => {
    expect(limitRecipients(["a", "", "b"], 10).recipients).toEqual(["a", "b"]);
  });
});

describe("applyFrequencyCap", () => {
  it("drops customers contacted recently and counts them", () => {
    const out = applyFrequencyCap(["a", "b", "c"], new Set(["b"]));
    expect(out.eligible).toEqual(["a", "c"]);
    expect(out.capped).toBe(1);
  });
});

describe("broadcast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.message.findMany.mockResolvedValue([]);
  });

  it("counts only real successes and never counts a failure as sent", async () => {
    mockSendDirect
      .mockResolvedValueOnce({ sent: true })
      .mockResolvedValueOnce({ sent: false })
      .mockRejectedValueOnce(new Error("provider down"));

    const r = await broadcast({ customerIds: ["a", "b", "c"], body: "hi", referenceType: "CAMPAIGN" });

    expect(r.total).toBe(3);
    expect(r.sent).toBe(1);
    expect(r.failed).toBe(2);
  });

  it("counts opt-outs separately from failures (MSG-017)", async () => {
    mockSendDirect
      .mockRejectedValueOnce(new Error("CUSTOMER_OPTED_OUT"))
      .mockResolvedValueOnce({ sent: true });

    const r = await broadcast({ customerIds: ["a", "b"], body: "hi", referenceType: "CAMPAIGN", isMarketing: true });

    expect(r.optedOut).toBe(1);
    expect(r.failed).toBe(0);
    expect(r.sent).toBe(1);
  });

  it("skips customers messaged within the cap window for marketing sends", async () => {
    dbMock.message.findMany.mockResolvedValue([{ customerId: "b" }]);
    mockSendDirect.mockResolvedValue({ sent: true });

    const r = await broadcast({ customerIds: ["a", "b"], body: "hi", referenceType: "CAMPAIGN", isMarketing: true });

    expect(mockSendDirect).toHaveBeenCalledTimes(1);
    expect(mockSendDirect).toHaveBeenCalledWith(expect.objectContaining({ customerId: "a" }));
    expect(r.capped).toBe(1);
  });

  it("does not apply the cap to non-marketing sends", async () => {
    dbMock.message.findMany.mockResolvedValue([{ customerId: "b" }]);
    mockSendDirect.mockResolvedValue({ sent: true });

    const r = await broadcast({ customerIds: ["a", "b"], body: "hi", referenceType: "REMINDER", isMarketing: false });

    expect(mockSendDirect).toHaveBeenCalledTimes(2);
    expect(r.capped).toBe(0);
    expect(dbMock.message.findMany).not.toHaveBeenCalled();
  });

  it("can be run with the cap explicitly disabled", async () => {
    dbMock.message.findMany.mockResolvedValue([{ customerId: "b" }]);
    mockSendDirect.mockResolvedValue({ sent: true });

    const r = await broadcast({ customerIds: ["a", "b"], body: "hi", referenceType: "CAMPAIGN", isMarketing: true, frequencyCapDays: null });

    expect(mockSendDirect).toHaveBeenCalledTimes(2);
    expect(dbMock.message.findMany).not.toHaveBeenCalled();
    expect(r.capped).toBe(0);
  });

  it("reports overflow when the run exceeds its recipient limit", async () => {
    mockSendDirect.mockResolvedValue({ sent: true });
    const r = await broadcast({ customerIds: ["a", "b", "c"], body: "hi", referenceType: "POSTER", maxRecipients: 1 });
    expect(r.total).toBe(1);
    expect(r.overflow).toBe(2);
  });

  it("passes marketing intent, reference and branch through to the sender", async () => {
    mockSendDirect.mockResolvedValue({ sent: true });
    await broadcast({
      customerIds: ["a"], body: "promo", referenceType: "CAMPAIGN", referenceId: "camp1",
      branchId: "b-kl", isMarketing: true,
    });
    expect(mockSendDirect).toHaveBeenCalledWith(expect.objectContaining({
      customerId: "a", body: "promo", referenceType: "CAMPAIGN", referenceId: "camp1",
      branchId: "b-kl", isMarketing: true, channel: "WHATSAPP",
    }));
  });

  it("leaves a sane default frequency cap in place", () => {
    expect(DEFAULT_FREQUENCY_CAP_DAYS).toBe(7);
  });
});
