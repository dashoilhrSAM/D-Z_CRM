#!/usr/bin/env node
/**
 * load-mix.mjs — 阶段 B：并发压测（本机没有 k6，用 Node + Playwright 自建）。
 *
 * 打什么：**只读浏览配比**，照容量报告 §1.2 的口径 —— 自动刷新占大头、页面浏览次之。
 *   /workshop/dashboard 67% ｜ jobs 11% ｜ customers 11% ｜ bookings 11%
 * 刻意不含上传与写入：这一轮打在 perf.db 上，写入会污染那套造好的量数据，
 * 而且「写并发」是另一类问题（锁/事务），要单独一轮。
 *
 * 为什么可以用普通 GET 代替 router.refresh()：refresh 同样要过 middleware、
 * 发同样的 SQL、跑同样的 React 渲染，差别只在序列化格式；而整页 GET 的响应体更大，
 * 所以这个口径是**保守**的（只会把实例显得更弱）。RSC 协议需要 state-tree，
 * 不猜它 —— 猜错会得到一份看着正常、其实在测别的东西的读数。
 *
 * 用法：
 *   DATABASE_URL="file:./perf.db" next start -p 3210 &
 *   APP=http://127.0.0.1:3210 SERVER_PID=$(lsof -ti :3210) \
 *     PASSWORD=... node scripts/perf/load-mix.mjs
 * 环境变量：STEPS=5,15,30,60,100（并发梯度）STEP_MS=15000 WARMUP_MS=8000
 *
 * 读数里最该看的三列：p95（体感）、错误数（**尤其 307**：那是会话掉了，
 * 会话一掉整轮读数作废）、cores（服务端 CPU 核数 = Vercel Fluid 的计费单位）。
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";

const APP = process.env.APP ?? "http://127.0.0.1:3210";
const EMAIL = process.env.EMAIL ?? "ManagerDemo@gmail.com";
const PASSWORD = process.env.PASSWORD;
const STEPS = (process.env.STEPS ?? "5,15,30,60,100").split(",").map(Number);
const STEP_MS = Number(process.env.STEP_MS ?? 15000);
const WARMUP_MS = Number(process.env.WARMUP_MS ?? 8000);
const SERVER_PID = process.env.SERVER_PID;

// 配比可用 MIX 覆盖，用来做「去掉某个嫌疑路由」的对照实验：
//   MIX="67:/workshop/dashboard,33:/workshop/jobs"
const MIX = (process.env.MIX ?? "67:/workshop/dashboard,11:/workshop/jobs,11:/workshop/customers,11:/workshop/bookings")
  .split(",")
  .map((s) => {
    const [w, ...rest] = s.split(":");
    return { weight: Number(w), path: rest.join(":") };
  });
const TOTAL_WEIGHT = MIX.reduce((a, m) => a + m.weight, 0);

function pick() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const m of MIX) {
    r -= m.weight;
    if (r <= 0) return m.path;
  }
  return MIX[0].path;
}

function cpuSeconds(pid) {
  if (!pid) return null;
  try {
    const out = execFileSync("ps", ["-o", "time=", "-p", String(pid)], { encoding: "utf8" }).trim();
    const m = out.match(/^(?:(\d+)-)?(\d+):(\d+(?:\.\d+)?)$/);
    if (!m) return null;
    return Number(m[1] ?? 0) * 86400 + Number(m[2]) * 60 + Number(m[3]);
  } catch {
    return null;
  }
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

async function runStep(concurrency, durationMs, cookie, label) {
  const lat = [];
  const status = new Map();
  let bytes = 0;
  let done = false;
  const deadline = Date.now() + durationMs;
  const cpu0 = cpuSeconds(SERVER_PID);
  const t0 = Date.now();

  async function worker() {
    while (!done) {
      const path = pick();
      const s = performance.now();
      try {
        const res = await fetch(APP + path, { headers: { cookie }, redirect: "manual" });
        const buf = await res.arrayBuffer();
        bytes += buf.byteLength;
        status.set(res.status, (status.get(res.status) ?? 0) + 1);
      } catch {
        status.set(-1, (status.get(-1) ?? 0) + 1);
      }
      lat.push(performance.now() - s);
      if (Date.now() > deadline) done = true;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  const wall = (Date.now() - t0) / 1000;
  const cpu1 = cpuSeconds(SERVER_PID);
  lat.sort((a, b) => a - b);
  const n = lat.length;
  const errs = [...status.entries()].filter(([k]) => k < 0 || k >= 400).reduce((a, [, v]) => a + v, 0);
  const redirects = [...status.entries()].filter(([k]) => k >= 300 && k < 400).reduce((a, [, v]) => a + v, 0);

  return {
    label,
    concurrency,
    n,
    rps: n / wall,
    p50: pct(lat, 50),
    p95: pct(lat, 95),
    p99: pct(lat, 99),
    max: lat[n - 1] ?? 0,
    errs,
    redirects,
    mbps: bytes / wall / 1e6,
    cores: cpu0 != null && cpu1 != null ? (cpu1 - cpu0) / wall : null,
    statuses: [...status.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
  };
}

if (!PASSWORD) {
  console.error("需要 PASSWORD=...（本项目登录是 Server Action，脚本不内置任何口令）");
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(APP + "/login", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForLoadState("networkidle", { timeout: 60000 });
await page.waitForTimeout(800);   // 等 React 水合：水合前点击会变成原生表单 GET
await page.fill("input[type=email]", EMAIL);
await page.fill("input[type=password]", PASSWORD);
await Promise.all([page.waitForURL("**/workshop/**", { timeout: 60000 }), page.click("button[type=submit]")]);
await page.waitForTimeout(1200);

const cookies = await page.context().cookies();
const cookie = cookies.map((c) => c.name + "=" + c.value).join("; ");
console.log("登录 ok，cookie 数 =", cookies.length, "｜目标 =", APP, "｜配比 =", MIX.map((m) => m.weight + "% " + m.path).join(" "));
await browser.close();

const rows = [];
const warm = await runStep(5, WARMUP_MS, cookie, "warmup");
console.log("预热：" + warm.n + " 请求，p95 " + Math.round(warm.p95) + "ms（预热读数不计入下表）");
if (warm.redirects > 0) {
  console.log("!! 预热就出现 " + warm.redirects + " 个 3xx —— 会话没带上，整轮读数不可用，先修会话再跑。");
  process.exit(1);
}

for (const c of STEPS) {
  const r = await runStep(c, STEP_MS, cookie, "c=" + c);
  rows.push(r);
  console.log(
    "并发 " + String(r.concurrency).padEnd(4) +
    "请求 " + String(r.n).padEnd(7) +
    r.rps.toFixed(1).padStart(6) + " req/s  " +
    "p50 " + String(Math.round(r.p50)).padStart(5) + "ms  " +
    "p95 " + String(Math.round(r.p95)).padStart(5) + "ms  " +
    "p99 " + String(Math.round(r.p99)).padStart(5) + "ms  " +
    "错误 " + String(r.errs).padEnd(4) +
    "3xx " + String(r.redirects).padEnd(4) +
    (r.cores != null ? "服务端 " + r.cores.toFixed(2) + " 核" : "")
  );
}

console.log("\n=== 判读 ===");
const worst = rows[rows.length - 1];
const base = rows[0];
console.log("从并发 " + base.concurrency + " 到 " + worst.concurrency + "：吞吐 " + base.rps.toFixed(1) + " → " + worst.rps.toFixed(1) + " req/s，" +
  "p95 " + Math.round(base.p95) + " → " + Math.round(worst.p95) + "ms（放大 " + (worst.p95 / Math.max(1, base.p95)).toFixed(1) + " 倍）");
const knee = rows.find((r) => r.p95 > 500) ?? null;
console.log(knee ? ("p95 首次超过 500ms 出现在并发 " + knee.concurrency + "（" + knee.rps.toFixed(1) + " req/s）") : "全程 p95 未超过 500ms");
const totalErr = rows.reduce((a, r) => a + r.errs, 0);
console.log(totalErr === 0 ? "无错误请求" : ("总错误 " + totalErr + "（" + JSON.stringify(rows.map((r) => r.statuses)) + "）"));
const cpuRow = rows[rows.length - 1];
if (cpuRow.cores != null) {
  console.log("满载时服务端 " + cpuRow.cores.toFixed(2) + " 核，即每个请求约 " + ((cpuRow.cores * 1000) / cpuRow.rps).toFixed(2) + " 核·毫秒（Vercel Fluid 的 Active CPU 计费单位）");
}
