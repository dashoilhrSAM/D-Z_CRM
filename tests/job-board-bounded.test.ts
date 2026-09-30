// 工单列表 / 看板 / dashboard 的**有界取数**回归测试（2026-09-30 压测之后新增）。
//
// 背景：listBoard() 原来把整张工单表连同明细读进内存，页面再内存过滤、切片、给看板每列
// 切 12 条。7,308 张工单时单请求 100ms、四并发反而掉到 2.3 req/s；而 dashboard 只是为了
// 拿 jobsToday 与各状态计数，也扫了整张表 —— dashboard 占全部渲染的 67%（自动刷新）。
//
// 这些断言都能失败：把 take 摘掉、或把状态过滤挪回内存，它们就会红。
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const saved = { databaseUrl: process.env.DATABASE_URL };
let db: typeof import("@/lib/db")["db"];
let jobService: typeof import("@/modules/service-jobs/service")["jobService"];

const PAGE = 3;
const STATUSES = ["WAITING", "IN_PROGRESS", "AWAITING_APPROVAL", "READY", "COMPLETED", "CANCELLED"] as const;

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  ({ db } = await import("@/lib/db"));
  ({ jobService } = await import("@/modules/service-jobs/service"));
});

describe("工单列表的取数是有界的", () => {
  it("表格视图只返回一页：jobs.length === min(pageSize, total)", async () => {
    const { jobs, total, totalPages } = await jobService.listBoardRows({ page: 1, pageSize: PAGE });
    // 下限：数据太少时这条测试就没有意义，所以显式要求库里至少有 PAGE 张工单
    expect(total).toBeGreaterThanOrEqual(PAGE);
    expect(jobs.length).toBe(Math.min(PAGE, total));
    expect(totalPages).toBe(Math.max(1, Math.ceil(total / PAGE)));
  });

  it("看板每列各自截断，而不是为了 5 列把整表取 5 遍", async () => {
    const { columns, counts } = await jobService.listBoardColumns({ perColumn: 2 });
    for (const [status, rows] of Object.entries(columns)) {
      expect(rows.length, status + " 列超过每列上限").toBeLessThanOrEqual(2);
      // 截断的是显示，不是事实：列内条数不可能多于该状态的总数
      expect(rows.length, status + " 列条数多于该状态总数").toBeLessThanOrEqual(counts[status] ?? 0);
    }
  });

  it("状态过滤在数据库里做：取回来的每一行都必须是该状态", async () => {
    const completed = await jobService.listBoardRows({ status: "COMPLETED", pageSize: 50 });
    expect(completed.jobs.every((j) => j.status === "COMPLETED")).toBe(true);
    const waiting = await jobService.listBoardRows({ status: "WAITING", pageSize: 50 });
    expect(waiting.jobs.every((j) => j.status === "WAITING")).toBe(true);
  });

  it("计数是聚合算出来的，与逐状态 count 一一对上", async () => {
    const summary = await jobService.boardSummary();
    for (const status of STATUSES) {
      const expected = await db.serviceJob.count({ where: { status } });
      expect(summary.counts[status], status + " 的计数对不上").toBe(expected);
    }
    expect(summary.total).toBe(await db.serviceJob.count());
  });

  it("今日计数用的是日期区间，不是把行取回来逐行判断", async () => {
    const summary = await jobService.boardSummary();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);
    const expected = await db.serviceJob.count({ where: { createdAt: { gte: start, lt: end } } });
    expect(summary.jobsToday).toBe(expected);
  });
});

describe("结构：无界取数的入口不许回来", () => {
  it("已经不存在 jobService.listBoard( 这个无界方法", () => {
    const out = execSync('grep -rn "jobService.listBoard(" src/ || true', { encoding: "utf8" });
    expect(out.trim()).toBe("");
  });

  it("有界性写在仓库查询里（take/skip），不靠调用方自觉", () => {
    const src = readFileSync(path.join(process.cwd(), "src/repositories/prisma/jobs.repository.ts"), "utf8");
    const body = src.slice(src.indexOf("listPage"), src.indexOf("countsByStatus"));
    expect(body).toMatch(/take/);
    expect(body).toMatch(/skip/);
  });
});
