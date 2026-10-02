import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // 单测共用 prisma/dev.db：并行既会争抢写锁，也会互相覆盖全局配置。
    // 模板测试临时覆盖 standard 时，开店测试会读到它的三项服务而非内置四项。
    // 与 playwright.config.ts 的 `workers: 1`（注释写着 "shared SQLite demo DB — serialize"）
    // 是同一条理由：共享库的用例必须串行。
    fileParallelism: false,
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
