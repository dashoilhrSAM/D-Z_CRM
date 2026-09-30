---
date: 2026-09-30
title: 修掉客户列表页的无界取数：并发 1 从 3.1 提到 85.8 req/s
branch: perf/bounded-list-queries
---

## 改动

压测（阶段 B）查出 /workshop/customers 在并发下吞吐反向下降。根因是取数没有边界：
listWith() 是 customer.findMany({ orderBy, include }) —— 没有 where、没有 take，
分页在内存里 slice(25)。4,202 个客户时每次打开都要把整张表连同车辆/工单/发票/提醒
拉进内存再丢掉 99%。

改法（**保持用户可见行为不变**）：

1. 仓库新增 listPageWith({ q, skip, take })：无搜索词时走纯 Prisma 的 findMany(skip/take)
   + count（两条查询、行数受 take 约束）；有搜索词时用 lower()+LIKE 的原始 SQL 只取
   「当前页的 id + 总数」，再交给 Prisma 取整行。
2. 服务层 listSummaries({ q, page, pageSize }) 返回 { items, total, totalPages }；
   单行 → 读模型的算法**逐字未改**，只是抽成 toSummary() 复用。
3. 页面不再内存过滤 + 切片，直接用返回的分页结果；表头总数改用 total（语义同原来的
   summaries.length：搜索时是命中数）。

**为什么搜索要用原始 SQL**：Prisma 的 contains 在 PG 上区分大小写（柜台打 "ahmad"
会一无所获），而 mode:"insensitive" 不被 SQLite 支持 —— 本项目本地 SQLite、生产 PG
两套引擎，lower() 是两边行为一致的写法。SQL 只用标准语法，标识符双引号（Prisma 未做
@@map，两侧表名一致）。无搜索词的热路径完全不碰原始 SQL。

## 影响（同一实例、同一份 perf.db、同一个 harness）

| /workshop/customers | 改前 | 改后 |
| --- | --- | --- |
| 并发 1 | 3.14 req/s，p50 315ms | **85.8 req/s，p50 12ms** |
| 并发 4 | 1.23 req/s，p50 3631ms | **72.7 req/s，p50 58ms** |
| 并发 8 | 0.56 req/s，p50 14252ms | **50.9 req/s，p50 164ms** |

并发下「越并发越慢」的形态消失了：现在是 85.8 → 72.7 → 50.9 的正常排队。

同一配比的混合负载（67% dashboard + 三个列表页各 11%）：并发 5 时 **10.5 → 33.7 req/s**，
每请求 **1626 → 731 核·毫秒**（Vercel Fluid 的计费单位），p95 2395ms → 797ms。

页面正确性（端到端，不只是单测）：第 1/2 页各 25 行、25 个详情链接，表头总数 4202 与
库内 count 一致；q=ahmad（小写）命中 221 —— 证明大小写不敏感那条原始 SQL 分支在工作
（库里存的是 "Ahmad Abdullah"）。

## 交接说明

- **还没修完**：混合负载在并发 30 时仍会塌（10.5 req/s、p95 10.8s，与修前同级）。
  下一个瓶颈是 /workshop/jobs（单并发 9.9 req/s、四并发 2.3 req/s，同样是无界取数：
  repo 的 list(where) 只有 rowInclude、没有 take，页面再内存过滤 + 切片）。
  建议单独一个分支做，因为看板视图是否要一次性拿全量属于产品决定。
- 回归测试 tests/customer-list-page.test.ts（6 条）：有界性、过滤先于分页、两页不重叠、
  大小写不敏感三条分支、空搜索词不退化成全表读，外加结构守卫（页面不许再出现无参
  listSummaries()）。**反向验证过**：把 take 摘掉 → 「expected 32 to be 25」2 条红；
  还原 → 6 条绿。
- 排序口径有一处刻意变化：原来在 JS 里 localeCompare 重排，现在只由数据库 name ASC 决定
  —— 两处都排会让分页边界与显示顺序不一致（可能重复或漏行）。
- 基线：tsc 0 ／ vitest 861 → 867（75 文件）／ build 通过。
- 未做：生产 PG 上的验证。原始 SQL 的跨引擎一致性只在本机 SQLite 上测过，lower/COALESCE/
  EXISTS/LIMIT/OFFSET 都是两引擎同义的标准语法，但真机验证仍建议在 Supabase 分支库上跑一次。
