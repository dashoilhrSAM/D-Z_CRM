// `?next=` 回跳路径的开放重定向防护。
//
// 为什么值得单独一组测试：登录页一旦消费 `?next=`，三个已有入口
// （`/qr/rider/[id]`、`/qr/motorcycle/[id]`、`/qr/workshop/[id]`）就同时变成
// "可被构造的重定向" —— 而触发点发生在用户**刚输完密码**那一刻，是最容易跟走的时候。
// 所以这里的断言全部围绕"什么情况下必须回退到默认落点"。
import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/next-path";

const FALLBACK = "/workshop/dashboard";

describe("safeNextPath：只认站内绝对路径", () => {
  it("正常回跳原样返回（门店链接、QR 落地页）", () => {
    expect(safeNextPath("/t/d-z-smart-workshop", FALLBACK)).toBe("/t/d-z-smart-workshop");
    expect(safeNextPath("/qr/rider/abc123", FALLBACK)).toBe("/qr/rider/abc123");
    expect(safeNextPath("/workshop/jobs?status=OPEN", FALLBACK)).toBe("/workshop/jobs?status=OPEN");
  });

  it("缺失/空 → 回退", () => {
    expect(safeNextPath(null, FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath(undefined, FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("", FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("   ", FALLBACK)).toBe(FALLBACK);
  });

  it("**绝对 URL → 回退**（最典型的开放重定向）", () => {
    expect(safeNextPath("https://evil.example/steal", FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("http://evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("javascript:alert(1)", FALLBACK)).toBe(FALLBACK);
  });

  it("**协议相对 URL（`//host`）→ 回退**", () => {
    expect(safeNextPath("//evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("//evil.example/path", FALLBACK)).toBe(FALLBACK);
    // 反斜杠变体：某些浏览器把 `/\` 当成 `//`
    expect(safeNextPath("/\\evil.example", FALLBACK)).toBe(FALLBACK);
  });

  it("相对路径（不以 / 开头）→ 回退", () => {
    expect(safeNextPath("workshop/dashboard", FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("../admin", FALLBACK)).toBe(FALLBACK);
  });

  it("夹带空白/控制字符 → 回退（浏览器会做奇怪归一化）", () => {
    expect(safeNextPath("/wo rkshop", FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("/\t/evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("/\n//evil.example", FALLBACK)).toBe(FALLBACK);
  });

  it("回退值是调用方给的 —— 函数自己不猜落点", () => {
    expect(safeNextPath("https://evil.example", "/rider/home")).toBe("/rider/home");
  });
});
