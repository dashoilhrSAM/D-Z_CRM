#!/usr/bin/env node
/**
 * 租户守卫审计：用项目**自己的测试**找出"没带租户条件"的查询。
 *
 * 为什么这样做，而不是静态扫描源码：
 *   静态判断"这条查询收窄了吗"要做数据流分析（org 是从会话来的？还是参数来的？
 *   有没有经关系收窄？），假阳假阴都多。而把守卫挂在 Prisma 上跑一遍真实测试，
 *   拿到的是**代码实际发出的查询** —— 谁在裸奔一清二楚。
 *
 * 用法：node scripts/tenant-guard-audit.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), ".tenant-guard.jsonl");
if (existsSync(FILE)) rmSync(FILE);

console.log("跑全量单测（TENANT_GUARD=report）…\n");
try {
  execFileSync("pnpm", ["test"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, TENANT_GUARD: "report", TENANT_GUARD_FILE: FILE },
  });
} catch {
  // 测试本身红不红不是这个脚本关心的（守卫只记录，不改变行为）
}

if (!existsSync(FILE)) {
  console.log("没有收集到任何查询——若测试确实跑过，说明守卫没挂上（检查 TENANT_GUARD 是否生效）");
  process.exit(0);
}
const rows = readFileSync(FILE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const byKind = {};
const byModelOp = {};
for (const r of rows) {
  byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  const k = r.model + "." + r.operation;
  byModelOp[k] = (byModelOp[k] ?? 0) + 1;
}
console.log("\n════════ 租户守卫审计结果 ════════");
console.log("未收窄的查询次数:", rows.length);
console.log("\n按类型:");
for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
  const desc = {
    "missing-tenant": "where 里没有租户条件（读/写都可能串租户）",
    "unique-lookup": "findUnique 按唯一键直查 —— 结构上写不出租户条件（IDOR 的经典来源）",
    "missing-tenant-on-create": "create 的 data 里没有租户值（该行逃出唯一约束）",
  }[k] ?? "";
  console.log("  " + k.padEnd(26) + n.toString().padStart(6) + "   " + desc);
}
console.log("\n按 模型.操作 排前 20:");
for (const [k, n] of Object.entries(byModelOp).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log("  " + k.padEnd(42) + n.toString().padStart(6));
}
// 调用点才是可行动的：同一个"Customer.findMany"可能来自好几个文件。
// **必须把生产代码与测试夹具分开** —— 测试自己造数据、自己删数据，天然不带租户条件，
// 混在一起会淹没真正的漏洞（第一版就是这么把 8 条 Customer.findMany 读成"很严重"的）。
const bySite = {};
for (const r of rows) {
  const at = r.at ?? "(未知调用点)";
  const isTest = at.startsWith("tests/") || at.startsWith("e2e/") || at.startsWith("scripts/");
  const k = (isTest ? "[夹具] " : "[生产] ") + at + "  →  " + r.model + "." + r.operation;
  bySite[k] = (bySite[k] ?? 0) + 1;
}
const prod = Object.entries(bySite).filter(([k]) => k.startsWith("[生产]"));
const fixture = Object.entries(bySite).filter(([k]) => k.startsWith("[夹具]"));
console.log("\n══ 生产代码里的未收窄查询（要改的清单）══");
if (prod.length === 0) console.log("  无 🎉");
for (const [k, n] of prod.sort((a, b) => b[1] - a[1])) console.log("  " + String(n).padStart(4) + "  " + k.replace("[生产] ", ""));
console.log("\n（另有 " + fixture.length + " 个测试夹具调用点，属正常：夹具自己造数、自己清数）");

console.log("\n明细留在 " + path.relative(process.cwd(), FILE) + "（已加进 .gitignore）");
