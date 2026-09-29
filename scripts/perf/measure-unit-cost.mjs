#!/usr/bin/env node
/**
 * measure-unit-cost.mjs — 量「一次页面渲染到底发几条 SQL、DB 花多少时间、返回多大」。
 *
 * 为什么需要它：容量模型（docs/CAPACITY_AND_UPGRADE_PLAN.md）里「每次渲染 6 条 SQL」
 * 是**估算**，而估算决定了「要不要加缓存、加哪一层」这些结论。这个脚本把它变成读数。
 *
 * 用法（起一个开了 SQL 日志的隔离实例，别打 :3002/:3003/:3102，更别打生产）：
 *   DATABASE_URL="file:./perf.db" PRISMA_LOG_QUERIES=1 next start -p 3210 > /tmp/unit-cost.log 2>&1 &
 *   APP=http://127.0.0.1:3210 SQL_LOG=/tmp/unit-cost.log \
 *     EMAIL=ManagerDemo@gmail.com PASSWORD=... node scripts/perf/measure-unit-cost.mjs
 *
 * 两个已经踩过的探针坑（都表现成「一切正常」，实际什么都没测到）：
 *   ① Prisma 的 $on("query") **只在构造时声明了 log:[{emit:"event",level:"query"}] 才会触发**；
 *      漏了它每条路由都读到「0 条查询」——那不是「没有查询」，是探针没在听。
 *   ② 必须用 page.request（纯 HTTP）而不是 page.goto：后者会触发客户端预取，
 *      其它路由的 SQL 会混进当前窗口。窗口之间留 900ms 让日志落盘，
 *      最后用「逐路由累计 vs 窗口内总数」对账（对不上就说明有串扰）。
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

const APP = process.env.APP ?? "http://127.0.0.1:3210";
const LOG = process.env.SQL_LOG ?? "/tmp/unit-cost.log";
const EMAIL = process.env.EMAIL ?? "ManagerDemo@gmail.com";
const PASSWORD = process.env.PASSWORD;
const ROUTES = (process.env.ROUTES ?? [
  "/workshop/dashboard",
  "/workshop/jobs",
  "/workshop/customers",
  "/workshop/bookings",
  "/workshop/inventory/stock",
  "/workshop/settings",
  "/rider/home",
].join(",")).split(",");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readFrom(path, offset) {
  const fd = fs.openSync(path, "r");
  const size = fs.fstatSync(fd).size;
  const len = Math.max(0, size - offset);
  const buf = Buffer.alloc(len);
  if (len > 0) fs.readSync(fd, buf, 0, len, offset);
  fs.closeSync(fd);
  return buf.toString("utf8");
}

if (!PASSWORD) {
  console.error("需要 PASSWORD=...（本项目登录是 Server Action，脚本不内置任何口令）");
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(APP + "/login", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForLoadState("networkidle", { timeout: 60000 });
await page.waitForTimeout(800);            // 等 React 水合：水合前点击会变成原生表单 GET 提交
await page.fill("input[type=email]", EMAIL);
await page.fill("input[type=password]", PASSWORD);
await Promise.all([page.waitForURL("**/workshop/**", { timeout: 60000 }), page.click("button[type=submit]")]);
await page.waitForTimeout(1500);
console.log("登录 ok →", page.url().replace(APP, ""));

const before0 = fs.statSync(LOG).size;
let measuredTotal = 0;
const rows = [];

for (const route of ROUTES) {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const before = fs.statSync(LOG).size;
    const t0 = Date.now();
    let status = 0;
    let bytes = 0;
    try {
      const resp = await page.request.get(APP + route, { timeout: 60000 });
      status = resp.status();
      bytes = (await resp.body()).length;
    } catch {
      status = -1;
    }
    const wall = Date.now() - t0;
    await sleep(900);
    const sqlLines = readFrom(LOG, before).split("\n").filter((l) => l.startsWith("[sql] "));
    const sqlMs = sqlLines.reduce((a, l) => a + (parseFloat(l.slice(6)) || 0), 0);
    measuredTotal += sqlLines.length;
    samples.push({ status, wall, bytes, queries: sqlLines.length, sqlMs: Math.round(sqlMs), sqlLines });
  }
  const mid = samples.slice().sort((a, b) => a.queries - b.queries)[1] ?? samples[0];
  rows.push({ route, ...mid, all: samples.map((s) => s.status + "/" + s.queries + "/" + s.wall) });
}

console.log("\n路由".padEnd(28) + "HTTP  查询数  DB耗时  墙钟   响应字节   三次(状态/查询/墙钟)");
for (const r of rows) {
  console.log(r.route.padEnd(26) + String(r.status).padEnd(6) + String(r.queries).padEnd(7) +
    (r.sqlMs + "ms").padEnd(8) + (r.wall + "ms").padEnd(7) + String(r.bytes).padEnd(11) + r.all.join(" "));
}

const worst = rows.slice().sort((a, b) => b.queries - a.queries)[0];
console.log("\n查询最多的路由:", worst.route, "(" + worst.queries + " 条)");
const counts = new Map();
for (const l of worst.sqlLines ?? []) {
  const m = l.match(/\[sql\] \d+ms (.+)$/);
  if (!m) continue;
  const q = m[1].replace(/"/g, "").slice(0, 90);
  counts.set(q, (counts.get(q) ?? 0) + 1);
}
for (const [q, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log("   x" + n + "  " + q);

const allSql = readFrom(LOG, before0).split("\n").filter((l) => l.startsWith("[sql] ")).length;
console.log("\n对账：逐路由累计 " + measuredTotal + " 条 vs 窗口内实际 " + allSql + " 条（不等就说明窗口间有串扰，读数不可用）");

await browser.close();
