import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; logged?: boolean };

/** 性能诊断开关（默认关）：见文件末尾的说明。 */
const queryLogging = process.env.PRISMA_LOG_QUERIES === "1";

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    transactionOptions: { maxWait: 10000, timeout: 60000 },
    // 注意：$on("query") **只在构造时声明了 query 事件级别才会触发**。
    // 第一次写这个探针时漏了这一行，结果每条路由都读到「0 条查询」——
    // 那不是「没有查询」，是探针根本没在听。
    ...(queryLogging ? { log: [{ emit: "event", level: "query" }] as Prisma.LogDefinition[] } : {}),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * 性能诊断：PRISMA_LOG_QUERIES=1 时把每条 SQL 的耗时打到 stdout。
 *
 * 默认关闭，**生产不开**：日志本身有成本，而且会把 SQL（可能含客户数据）写进日志。
 * 用途是量「一次页面渲染到底发几条 SQL、DB 时间占多少」—— 这是容量模型里唯一
 * 靠估算的数字（见 docs/CAPACITY_AND_UPGRADE_PLAN.md §6 阶段 A）。用法：
 *   DATABASE_URL="file:./perf.db" PRISMA_LOG_QUERIES=1 next start -p 3210
 * 然后按路由抓 stdout 里的 [sql] 行计数。
 */
if (process.env.PRISMA_LOG_QUERIES === "1" && !globalForPrisma.logged) {
  globalForPrisma.logged = true;
  type QueryEvent = { duration: number; query: string };
  type QueryHook = { $on: (event: "query", cb: (e: QueryEvent) => void) => void };
  (db as unknown as QueryHook).$on("query", (ev) => {
    console.log("[sql] " + ev.duration + "ms " + ev.query.replace(/\s+/g, " ").slice(0, 200));
  });
}
