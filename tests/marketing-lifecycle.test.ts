// Campaign lifecycle: SCHEDULED campaigns used to never activate and ACTIVE ones never
// ended, so the status shown disagreed with what the discount engine actually did.
import { describe, it, expect } from "vitest";
import { effectiveCampaignStatus } from "@/modules/marketing/lifecycle";

const now = new Date("2026-09-10T12:00:00Z");
const past = new Date("2026-09-01T00:00:00Z");
const future = new Date("2026-09-20T00:00:00Z");

describe("effectiveCampaignStatus", () => {
  it("never auto-activates a draft — a draft is an unfinished edit", () => {
    expect(effectiveCampaignStatus({ status: "DRAFT", startDate: past, endDate: future }, now)).toBe("DRAFT");
  });

  it("treats ENDED as terminal", () => {
    expect(effectiveCampaignStatus({ status: "ENDED", startDate: past, endDate: future }, now)).toBe("ENDED");
  });

  it("keeps a scheduled campaign scheduled before its start date", () => {
    expect(effectiveCampaignStatus({ status: "SCHEDULED", startDate: future, endDate: null }, now)).toBe("SCHEDULED");
  });

  it("activates a scheduled campaign once its start date passes", () => {
    expect(effectiveCampaignStatus({ status: "SCHEDULED", startDate: past, endDate: future }, now)).toBe("ACTIVE");
  });

  it("activates exactly on the start date", () => {
    expect(effectiveCampaignStatus({ status: "SCHEDULED", startDate: now, endDate: null }, now)).toBe("ACTIVE");
  });

  it("ends a scheduled campaign whose whole window already passed", () => {
    expect(effectiveCampaignStatus({ status: "SCHEDULED", startDate: past, endDate: past }, now)).toBe("ENDED");
  });

  it("keeps an active campaign active inside its window", () => {
    expect(effectiveCampaignStatus({ status: "ACTIVE", startDate: past, endDate: future }, now)).toBe("ACTIVE");
  });

  it("ends an active campaign once its end date passes", () => {
    expect(effectiveCampaignStatus({ status: "ACTIVE", startDate: past, endDate: past }, now)).toBe("ENDED");
  });

  it("treats an open-ended active campaign as still running", () => {
    expect(effectiveCampaignStatus({ status: "ACTIVE", startDate: past, endDate: null }, now)).toBe("ACTIVE");
  });

  it("does not end a campaign exactly at its end date", () => {
    expect(effectiveCampaignStatus({ status: "ACTIVE", startDate: past, endDate: now }, now)).toBe("ACTIVE");
  });
});
