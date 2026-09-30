// 工单列表 / 看板 / dashboard 的**有界取数**回归测试（2026-09-30 压测之后新增）。
//
// 背景：listBoard() 原来把整张工单表连同明细读进内存，页面再内存过滤、切片、给看板每列
// 切 12 条。7,308 张工单时单请求 100ms、四并发反而掉到 2.3 req/s。
//
// 【为什么整套夹具都挂在一个自建分店下】第一版是把「聚合计数」与「另一条 count」分两次读、
// 不加作用域。它单独跑时永远绿，但整套测试并行跑时会偶发红 —— 别的测试文件正在写同一个
// dev.db，两次读之间数据就变了（实测连跑 4 轮红 4 轮，报「expected 4 to be 6」这类）。
// 计数类断言必须落在**自己造的那一份数据**上，否则测的是别人的写入。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const saved = { databaseUrl: process.env.DATABASE_URL };
const tag = "plpj" + Date.now().toString(36);

let db: typeof import("@/lib/db")["db"];
let jobService: typeof import("@/modules/service-jobs/service")["jobService"];

const fx = { orgId: "", branchId: "", customerId: "", motorcycleId: "" };
const jobIds: string[] = [];
// 夹具的确定性分布：5 完成 / 2 待修 / 1 就绪，合计 8 —— 断言直接写这些数字
const PLAN: [string, number][] = [["COMPLETED", 5], ["WAITING", 2], ["READY", 1]];
const TOTAL = 8;

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  ({ db } = await import("@/lib/db"));
  ({ jobService } = await import("@/modules/service-jobs/service"));

  const org = await db.organisation.create({ data: { name: "PLPJ " + tag } });
  fx.orgId = org.id;
  const branch = await db.branch.create({ data: { organisationId: fx.orgId, name: "PLPJ " + tag, city: "Test" } });
  fx.branchId = branch.id;
  const customer = await db.customer.create({ data: { organisationId: fx.orgId, name: "PLPJ " + tag + " Customer" } });
  fx.customerId = customer.id;
  const moto = await db.motorcycle.create({
    data: { customerId: fx.customerId, brand: "Honda", model: "Wave", year: 2020, plate: ("PLPJ" + tag).toUpperCase().slice(0, 14) },
  });
  fx.motorcycleId = moto.id;

  let i = 0;
  for (const [status, n] of PLAN) {
    for (let k = 0; k < n; k++) {
      i++;
      const job = await db.serviceJob.create({
        data: {
          jobNumber: "PLPJ-" + tag + "-" + i,
          branchId: fx.branchId,
          customerId: fx.customerId,
          motorcycleId: fx.motorcycleId,
          mileage: 1000 + i,
          status: status as never,
        },
      });
      jobIds.push(job.id);
    }
  }
});

afterAll(async () => {
  // 夹具必须自足：清掉自己造的每一行（先子表后父表），否则第二次跑就挂在外键上
  if (jobIds.length) await db.serviceJob.deleteMany({ where: { id: { in: jobIds } } });
  if (fx.motorcycleId) await db.motorcycle.deleteMany({ where: { id: fx.motorcycleId } });
  if (fx.customerId) await db.customer.deleteMany({ where: { id: fx.customerId } });
  if (fx.branchId) await db.branch.deleteMany({ where: { id: fx.branchId } });
  if (fx.orgId) await db.organisation.delete({ where: { id: fx.orgId } });
  process.env.DATABASE_URL = saved.databaseUrl;
});

describe("工单列表的取数是有界的", () => {
  it("表格视图只返回一页：jobs.length === min(pageSize, total)", async () => {
    const { jobs, total, totalPages } = await jobService.listBoardRows({ branchId: fx.branchId, page: 1, pageSize: 3 });
    expect(total).toBe(TOTAL);
    expect(jobs.length).toBe(3);
    expect(totalPages).toBe(Math.ceil(TOTAL / 3));

    const p3 = await jobService.listBoardRows({ branchId: fx.branchId, page: 3, pageSize: 3 });
    expect(p3.jobs.length).toBe(TOTAL - 6);
    const firstIds = new Set(jobs.map((j) => j.id));
    expect(p3.jobs.some((j) => firstIds.has(j.id))).toBe(false);
  });

  it("计数是聚合算出来的，且与夹具的真实分布一致", async () => {
    const summary = await jobService.boardSummary(fx.branchId);
    expect(summary.counts.COMPLETED).toBe(5);
    expect(summary.counts.WAITING).toBe(2);
    expect(summary.counts.READY).toBe(1);
    expect(summary.total).toBe(TOTAL);
    // 夹具都是刚建的 → 今日计数就是全部
    expect(summary.jobsToday).toBe(TOTAL);
  });

  it("状态过滤在数据库里做：取回来的每一行都必须是该状态", async () => {
    const waiting = await jobService.listBoardRows({ branchId: fx.branchId, status: "WAITING", pageSize: 50 });
    expect(waiting.total).toBe(2);
    expect(waiting.jobs.every((j) => j.status === "WAITING")).toBe(true);
  });

  it("看板每列各自截断，而不是为了 5 列把整表取 5 遍", async () => {
    const { columns } = await jobService.listBoardColumns({ branchId: fx.branchId, perColumn: 2 });
    // COMPLETED 有 5 张，但每列上限 2 —— 这条就是「有界」的证据
    expect(columns.COMPLETED.length).toBe(2);
    expect(columns.WAITING.length).toBe(2);
    expect(columns.READY.length).toBe(1);
  });

  it("今日过滤用的是日期区间，不是把行取回来逐行判断", async () => {
    const today = await jobService.listBoardRows({ branchId: fx.branchId, todayOnly: true, pageSize: 50 });
    expect(today.total).toBe(TOTAL);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);
    const expected = await db.serviceJob.count({ where: { branchId: fx.branchId, createdAt: { gte: start, lt: end } } });
    // 两次读之间不会有别的写入能影响这个分店 —— 夹具是自足的
    expect(today.total).toBe(expected);
  });
});

describe("dashboard 的生命周期分布：分组计数与逐行归类等价", () => {
  // 这一段改的是 dashboard 的 lifecycle 块：原来把活跃工单/预约逐行取回来再逐行归类，
  // 现在是 groupBy 计数。**归类只取决于状态**，所以两者必须给出同一组数字；
  // 而「已挂到工单上的预约要跳过（由工单那侧计）」这个条件也从 continue 挪进了 where。
  it("夹具分店的生命周期桶与工单状态分布一致", async () => {
    const { dashboardService } = await import("@/services/dashboard");
    const dash = await dashboardService.get(fx.branchId);
    const byLabel = new Map(dash.lifecycleDist.map((d) => [d.label, d.count]));
    // 夹具：2 张 WAITING、1 张 READY（5 张 COMPLETED 不在「在办」状态里，不该被计入）
    expect(byLabel.get("checked_in")).toBe(2); // WAITING
    expect(byLabel.get("ready")).toBe(1); // READY
    expect(byLabel.get("in_service")).toBe(0); // 夹具里没有 IN_PROGRESS
    // 桶总数必须等于「在办工单数 + 未挂工单的在办预约数」——这里没有预约
    const sum = dash.lifecycleDist.reduce((s, d) => s + d.count, 0);
    expect(sum).toBe(3);
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
