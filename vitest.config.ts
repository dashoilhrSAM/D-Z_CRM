import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // 单测**全部打同一个 SQLite 文件**（prisma/dev.db）。本地多核跑得动，但 GitHub 的 2 核
    // runner 上多个 worker 抢同一把写锁 → `P1008 Socket timeout` 与 5s 用例超时
    // （2026-09-30 CI 实测：commission-settlement 建组织 P1008、invoice-number 并发取号超时）。
    // 与 playwright.config.ts 的 `workers: 1`（注释写着 "shared SQLite demo DB — serialize"）
    // 是同一条理由：**共享库的用例必须串行**。本地保持并行，别拖慢日常开发。
    fileParallelism: !process.env.CI,
    testTimeout: process.env.CI ? 20_000 : 5_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // server-only 在 node 环境按浏览器条件解析会抛错，导致测试无法 import 服务端模块
      // （第一个撞上的是 src/lib/auth/permissions.ts）。边界由 next build 保证，测试里用空替身。
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
