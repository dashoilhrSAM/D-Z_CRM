import { defineConfig, devices } from "@playwright/test";

const BASE_URL = "http://localhost:3102";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: process.env.CI ? undefined : "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1, // shared SQLite demo DB — serialize the journeys
  timeout: 120_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        // HRM 考勤要真实调用 getUserMedia：给它一个合成摄像头，
        // 否则打卡弹窗永远停在"正在启动摄像头"，测的就成了空壳。
        launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
      },
    },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
  // The E2E server runs under launchd (com.dz-platform.e2e) on port 3102 with
  // DATABASE_URL=file:./e2e.db — Playwright reuses it (sandbox-safe). Fallback
  // In CI, initialize before starting Next.js: webServer runs before globalSetup.
  webServer: {
    command: (process.env.CI ? "pnpm exec tsx e2e/global-setup.ts && " : "")
      + 'DATABASE_URL="file:./e2e.db" pnpm start --port 3102',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
