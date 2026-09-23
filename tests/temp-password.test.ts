// 柜台临时密码的护栏。
//
// 生成器的错误不会报错，只会让骑手"照着念的密码登不进去"——柜台最烦的一类故障。
// 所以把三条硬要求钉住：长度、字符集无歧义、必须含三类字符（否则可能触不到密码策略）。
import { describe, expect, it } from "vitest";
import { AMBIGUOUS_CHARS, generateTempPassword } from "@/lib/auth/temp-password";

describe("柜台临时密码", () => {
  it("默认 10 位，且可以指定长度", () => {
    expect(generateTempPassword()).toHaveLength(10);
    expect(generateTempPassword(16)).toHaveLength(16);
  });

  it("绝不含易混字符（柜台是口述/手抄交付的）", () => {
    for (let i = 0; i < 200; i++) {
      const p = generateTempPassword();
      for (const bad of AMBIGUOUS_CHARS) {
        expect(p.includes(bad), `密码里出现了易混字符 ${bad}: ${p}`).toBe(false);
      }
    }
  });

  it("保证同时含大写、小写、数字（纯随机会有概率不满足密码策略）", () => {
    for (let i = 0; i < 200; i++) {
      const p = generateTempPassword();
      expect(/[A-Z]/.test(p), p).toBe(true);
      expect(/[a-z]/.test(p), p).toBe(true);
      expect(/[0-9]/.test(p), p).toBe(true);
    }
  });

  it("不会每次都得到同一串（随机源必须是 crypto，不是固定/常量）", () => {
    const set = new Set(Array.from({ length: 50 }, () => generateTempPassword()));
    expect(set.size).toBeGreaterThan(45);
  });

  it("长度下限有守卫（6 位以下直接拒绝，避免生成不安全的密码）", () => {
    expect(() => generateTempPassword(5)).toThrow();
  });
});
