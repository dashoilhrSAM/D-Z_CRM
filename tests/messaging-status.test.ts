import { describe, expect, it } from "vitest";

describe("消息渠道状态（老板还没拿到 WhatsApp key）", () => {
  it("两样都配齐才算真的会发", async () => {
    const { readMessagingStatus } = await import("@/lib/messaging-status");
    const live = readMessagingStatus({ WHATSAPP_API_TOKEN: "t", WHATSAPP_PHONE_ID: "p" });
    expect(live.live).toBe(true);
    expect(live.missing).toEqual([]);
  });

  it("**什么都没配 → 不算 live，而且要列出缺什么**", async () => {
    const { readMessagingStatus } = await import("@/lib/messaging-status");
    const none = readMessagingStatus({});
    expect(none.live).toBe(false);
    expect(none.missing).toEqual(["WHATSAPP_API_TOKEN", "WHATSAPP_PHONE_ID"]);
  });

  it("**只配了 token 没配 phone id 也不算 live** —— 这正是会「选成真通道但发送失败」的情况", async () => {
    const { readMessagingStatus } = await import("@/lib/messaging-status");
    const half = readMessagingStatus({ WHATSAPP_API_TOKEN: "t" });
    expect(half.live, "只有 token 时不能显示成已配置").toBe(false);
    expect(half.missing).toEqual(["WHATSAPP_PHONE_ID"]);
  });

  it("空字符串等于没配（env 里常见）", async () => {
    const { readMessagingStatus } = await import("@/lib/messaging-status");
    const blank = readMessagingStatus({ WHATSAPP_API_TOKEN: "", WHATSAPP_PHONE_ID: "p" });
    expect(blank.live).toBe(false);
    expect(blank.missing).toEqual(["WHATSAPP_API_TOKEN"]);
  });

  it("送达回执是另一回事：不影响发送，但没配就收不到送达状态", async () => {
    const { receiptsConfigured } = await import("@/lib/messaging-status");
    expect(receiptsConfigured({})).toBe(false);
    expect(receiptsConfigured({ WHATSAPP_VERIFY_TOKEN: "v", WHATSAPP_APP_SECRET: "s" })).toBe(true);
  });
});
