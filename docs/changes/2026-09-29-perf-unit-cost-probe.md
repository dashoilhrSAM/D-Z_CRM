---
date: 2026-09-29
title: 压测阶段 A：把「每次渲染几条 SQL」从估算变成读数（并查出一个没有 LIMIT 的列表页）
branch: perf/unit-cost-and-cache
---

## 改动

容量报告里唯一靠估算的数字是「每次渲染约 6 条 SQL」——它决定了「要不要加缓存、加哪一层」。
这一版把它变成可复现的读数。

### 1. 可开关的 SQL 日志（src/lib/db.ts）

PRISMA_LOG_QUERIES=1 时把每条 SQL 的耗时打到 stdout。**默认关闭，生产不开**（日志有成本，
而且会把 SQL 写进日志）。配套脚本 scripts/perf/measure-unit-cost.mjs：
起一个隔离实例 → 登录 → 逐路由单独发一次请求（用 page.request，不走客户端 JS，避免预取串扰）
→ 读该窗口内的 [sql] 行 → 输出「查询数 / DB 耗时 / 墙钟 / 响应字节」，最后对账。

### 2. 实测读数（perf.db，4202 客户 / 5553 车 / 7308 工单）

| 路由 | 查询数 | DB 耗时 | 墙钟 | 响应字节 |
| --- | --- | --- | --- | --- |
| /workshop/dashboard | 4 | ~0ms | 27ms | 74.5KB |
| /workshop/bookings | 6 | ~0ms | 23ms | 70.5KB |
| /workshop/settings | 6 | ~0ms | 25ms | 66.8KB |
| /rider/home | 6 | ~0ms | 33ms | 74.6KB |
| /workshop/inventory/stock | 7 | ~0ms | 35ms | 74.6KB |
| /workshop/jobs | 15 | 29ms | 107ms | 67.9KB |
| **/workshop/customers** | **34** | 30ms | **272ms** | **144.6KB** |

对账：逐路由累计 237 条 = 窗口内实际 237 条（读数可信）。

## 影响

**推翻了一个结论**：原报告把「参考数据缓存」列为 P1 第三项，但实测里 ServiceType / ServicePackage /
Campaign **几乎没出现在热点查询中**（Permission 出现 3 次算是多的）。真正的问题在别处：

**/workshop/customers 的取数没有 LIMIT。** customers.repository.ts 的 listWith() 是
customer.findMany({ orderBy: { name }, include: withList }) —— **没有 where、没有 take**；
分页是在内存里 slice(25)。perf.db 里 4,202 个客户，所以每次打开这一页都要把整张客户表
连同车辆/工单/发票/提醒一起拉出来，然后丢掉 99% 的行。

同一份代码在两套数据量下的 A/B（都带真实会话，各三次）：

| 数据量 | 墙钟 | 响应字节 |
| --- | --- | --- |
| dev.db（2 个客户） | 36 / 41 / 54 ms | 87.8 KB |
| perf.db（4,202 个客户） | 278 / 282 / 311 ms | 144.6 KB |

即**页面代价随整张客户表增长**，而不是随「一页显示多少行」。500 家门店时这张表是十几万行，
而这是柜台每天要开的页面。（顺便：listSummaries 只有一个调用方 —— 这个改动是可控的。）

## 交接说明

- **两个探针坑**（都表现成「一切正常」，实际什么都没测到）：
  ① Prisma 的 $on("query") 只在**构造时**声明了 log:[{emit:"event",level:"query"}] 才会触发；
     漏了它每条路由都读到「0 条查询」——那不是「没有查询」，是探针没在听。
  ② 必须用 page.request（纯 HTTP）而不是 page.goto：后者会触发客户端预取，其它路由的 SQL
     会混进当前窗口。窗口间留 900ms 落盘，并用「累计 vs 总数」对账。
- 起测量实例的命令（**别打 :3002/:3003/:3102，更别打生产**）：
  DATABASE_URL="file:./perf.db" PRISMA_LOG_QUERIES=1 next start -p 3210 > /tmp/unit-cost.log 2>&1
- **未做**（下一步）：① 修 listWith 的 LIMIT + 把搜索下推到 DB（现在是拉全表再内存过滤）；
  ② 压测阶段 B（并发）：本机**没有 k6**，计划用 Node+Playwright 自建并发 harness；
  ③ 参考数据缓存按实测优先级往后放（热点里几乎没有它）。
