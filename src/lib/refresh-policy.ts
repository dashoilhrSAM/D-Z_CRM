/**
 * 自动刷新策略 —— **一处定义**（此前工作台刷新控件与机修端各写了一份 30 秒常量）。
 *
 * 2026-09-29 容量评估：T3（500 家门店）下自动刷新占全部渲染的 **67%**
 * （90 万次/天）。而这 90 万次**全部落在整秒上** —— setInterval 虽然从
 * "这个页面打开的时刻"起算，但所有人都是开门时打开页面，于是尖峰叠加：
 * 同一秒里几百个刷新同时打到服务端，DB 峰值 QPS 被这波抬高一截。
 *
 * 加 ±20% 抖动：**平均间隔不变**（30 秒还是 30 秒，柜台与机修感觉不到），
 * 只是把同时刻的方波摊成斜坡。这是零 UX 代价的那一半。
 *
 * 刻意**没有**顺手把间隔改成 120 秒：那会真的降低实时性，是业务取舍
 * （报告里算过 30s→120s 可省约 45% 的 Vercel 账单），什么时候换由老板
 * 按门店体验决定，不写在源码常量里。
 */

/** 自动刷新基准间隔（毫秒）。 */
export const AUTO_REFRESH_BASE_MS = 30_000;

/** 抖动幅度（相对基准的比例，0.2 = ±20%）。 */
export const AUTO_REFRESH_JITTER = 0.2;

/**
 * 下一次刷新的延迟：基准 ± 抖动。带下界，避免极端随机值把间隔压到接近 0。
 * random 可注入 —— 这样它能被单测，而不是只能"相信"。
 */
export function jitteredDelayMs(
  base: number = AUTO_REFRESH_BASE_MS,
  jitter: number = AUTO_REFRESH_JITTER,
  random: () => number = Math.random,
): number {
  const span = base * jitter;
  const offset = (random() * 2 - 1) * span;
  return Math.max(1000, Math.round(base + offset));
}
