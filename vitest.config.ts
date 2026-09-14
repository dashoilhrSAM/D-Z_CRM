import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
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
