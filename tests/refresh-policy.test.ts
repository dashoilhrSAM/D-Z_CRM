// 自动刷新抖动：平均间隔不变、尖峰被摊平 —— 以及"两份手抄常量"不许回来。
//
// 为什么有这些测试（2026-09-29 容量评估）：
//   T3（500 家门店）下自动刷新占全部渲染的 67%（90 万次/天），而这 90 万次
//   **全落在整秒上**（开门时所有人同时打开页面）→ 尖峰叠加。加 ±20% 抖动
//   不改变平均间隔（柜台与机修感觉不到），只把方波摊成斜坡。
//
// 断言分两层，都能失败：
//   ① 抖动数学（含"平均值必须等于基准"这条——抖动写歪成单向偏移就会红）；
//   ② 结构：两处消费者都走同一个 helper，且没人再用固定的 setInterval(…, 30000)。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AUTO_REFRESH_BASE_MS, AUTO_REFRESH_JITTER, jitteredDelayMs } from "@/lib/refresh-policy";

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("jitteredDelayMs", () => {
  it("随机值取中点时正好是基准间隔", () => {
    expect(jitteredDelayMs(30_000, 0.2, () => 0.5)).toBe(30_000);
  });

  it("上下界分别是基准 ± 抖动幅度", () => {
    expect(jitteredDelayMs(30_000, 0.2, () => 0)).toBe(24_000);
    expect(jitteredDelayMs(30_000, 0.2, () => 1)).toBe(36_000);
  });

  it("平均间隔 = 基准（抖动必须双向对称，否则等于偷偷改间隔）", () => {
    const samples = 2000;
    let sum = 0;
    for (let i = 0; i < samples; i++) sum += jitteredDelayMs();
    const avg = sum / samples;
    expect(Math.abs(avg - AUTO_REFRESH_BASE_MS)).toBeLessThan(AUTO_REFRESH_BASE_MS * 0.02);
  });

  it("真实随机数下永远落在 ±20% 之内，且不会贴到 0", () => {
    for (let i = 0; i < 3000; i++) {
      const d = jitteredDelayMs();
      expect(d).toBeGreaterThanOrEqual(Math.floor(AUTO_REFRESH_BASE_MS * (1 - AUTO_REFRESH_JITTER)));
      expect(d).toBeLessThanOrEqual(Math.ceil(AUTO_REFRESH_BASE_MS * (1 + AUTO_REFRESH_JITTER)));
    }
    // 下界保护：极端参数也不该把间隔压到 1 秒以下
    expect(jitteredDelayMs(100, 10, () => 0)).toBe(1000);
  });

  it("确实在抖动（不是每次返回同一个数）", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) seen.add(jitteredDelayMs());
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe("结构：刷新间隔只有一处定义", () => {
  const consumers = [
    "src/components/workshop/refresh-controls.tsx",
    "src/components/mechanic/mechanic-orders-view.tsx",
  ];

  it("两处消费者都用共享的抖动 helper，不再各写一份常量", () => {
    for (const file of consumers) {
      const src = read(file);
      expect(src, file + " 应该用 jitteredDelayMs").toContain("jitteredDelayMs");
      expect(src, file + " 不该再出现写死的 30000/30_000").not.toMatch(/30_?000/);
    }
  });

  it("抖动必须每次重取 —— 不能用固定周期的 setInterval", () => {
    for (const file of consumers) {
      const src = read(file);
      expect(src, file + " 仍在用 setInterval（固定周期会让抖动退化成固定相位）").not.toContain("setInterval(");
    }
    // 正向对照：helper 本身确实在两个文件里被调用（而不是只 import 了没用）
    expect(read(consumers[0])).toContain("jitteredDelayMs()");
    expect(read(consumers[1])).toContain("jitteredDelayMs()");
  });
});
