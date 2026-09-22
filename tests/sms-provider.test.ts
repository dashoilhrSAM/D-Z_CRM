// SMS provider 的出口契约（TextBee：用自己的安卓手机 + SIM 卡发短信）。
//
// 为什么值得单测：这个 provider 是与外部网关的唯一接触面，它的失败方式决定了
// 线上用户体验——把「网关拒绝」当成成功，用户会一直等一条永远不来的短信（本项目
// 最忌讳的静默失败）。所以这里锁住：正确的端点与头部、缺配置即失败、
// HTTP 错误要带出上游原因、且**错误里绝不含我们发出去的验证码正文**。
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextbeeSmsProvider } from "@/providers/sms/textbee";

const provider = new TextbeeSmsProvider();
const OTP_BODY = "D&Z: 123456 ialah kod pengesahan anda. Sah 5 minit.";
const TO = "+60131252832";

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TextBee provider", () => {
  it("缺 API key → FAILED（绝不假装成功）", async () => {
    delete process.env.TEXTBEE_API_KEY;
    const res = await provider.send(TO, OTP_BODY);
    expect(res.ok).toBe(false);
    expect(res.status).toBe("FAILED");
    expect(res.error).toContain("textbee api key");
  });

  it("打到正确的端点、带 x-api-key、体是 recipients/message", async () => {
    process.env.TEXTBEE_API_KEY = "tb_test_key";
    delete process.env.TEXTBEE_DEVICE_ID;
    const spy = stubFetch(async () => new Response(JSON.stringify({ data: { id: "msg_123" } }), { status: 200 }));

    const res = await provider.send(TO, OTP_BODY);

    expect(res.ok).toBe(true);
    expect(res.externalId).toBe("msg_123");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.textbee.dev/api/v1/gateway/send-sms");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("tb_test_key");
    const body = JSON.parse(String(init.body));
    expect(body.recipients).toEqual([TO]);
    expect(body.message).toBe(OTP_BODY);
    expect(body.deviceId, "没配 deviceId 时不应塞空值进请求体").toBeUndefined();
  });

  it("配了 TEXTBEE_DEVICE_ID 就带上（多设备时指定用哪台手机）", async () => {
    process.env.TEXTBEE_API_KEY = "tb_test_key";
    process.env.TEXTBEE_DEVICE_ID = "dev_9";
    const spy = stubFetch(async () => new Response("{}", { status: 200 }));

    await provider.send(TO, OTP_BODY);
    const body = JSON.parse(String((spy.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.deviceId).toBe("dev_9");
    delete process.env.TEXTBEE_DEVICE_ID;
  });

  it("网关拒绝（401/500）→ FAILED 且带出上游原因", async () => {
    process.env.TEXTBEE_API_KEY = "tb_test_key";
    stubFetch(async () => new Response(JSON.stringify({ message: "Invalid API key" }), { status: 401 }));
    const res = await provider.send(TO, OTP_BODY);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Invalid API key");
  });

  it("网络异常 → FAILED（不是抛出去把整条 hook 打挂）", async () => {
    process.env.TEXTBEE_API_KEY = "tb_test_key";
    stubFetch(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const res = await provider.send(TO, OTP_BODY);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("transport error");
  });

  it("失败信息里绝不出现我们发出去的验证码正文", async () => {
    process.env.TEXTBEE_API_KEY = "tb_test_key";
    stubFetch(async () => new Response("upstream boom", { status: 502 }));
    const res = await provider.send(TO, OTP_BODY);
    expect(res.error ?? "").not.toContain("123456");
  });
});
