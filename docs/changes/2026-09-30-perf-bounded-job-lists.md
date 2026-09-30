---
date: 2026-09-30
title: 工单列表 / 看板 / dashboard 的有界取数：并发 1 从 9.9 提到 107.1 req/s
branch: perf/bounded-jobs-list
---

## 改动

上一版修了客户列表页；这一版修工单侧 —— 而工单侧的病灶更深：**dashboard 只是为了拿两个
数字（jobsToday 与各状态计数），就把整张工单表连同明细读进内存**，而 dashboard 占全部
渲染的 67%（自动刷新）。

1. 仓库新增 listPage({ where, skip, take })、countsByStatus(where)（groupBy 分组计数，
   一条查询拿全部数字、不取行）、countWhere(where)。原有的 list() 保留给别处，但列表面不再用。
2. 服务层把无界的 listBoard() 拆成三条按需路径：
   - boardSummary(branchId, mechanicId)：各状态计数 + 今日新建数（2 条查询、不取行）
   - listBoardRows({ branchId, status, statuses, mechanicId, todayOnly, page, pageSize })：表格分页
   - listBoardColumns({ branchId, mechanicId, perColumn })：看板**每列各取前 N 条**（5 条有界查询）
   单行 → 行的映射抽成 toBoardRow()，算法逐字未改。
3. 三个调用方全部迁移：工单列表页（表格 + 看板）、机修看板（状态过滤下推 + 上限 300）、
   dashboard（数字走聚合；「今日工单」卡片只取前 9 张）。

## 影响（同一实例、同一份 perf.db 7,308 张工单、同一个 harness）

| 路由 | 改前 | 改后 |
| --- | --- | --- |
| /workshop/jobs 并发 1 | 9.9 req/s，p50 100ms | **107.1 req/s，p50 9ms** |
| /workshop/jobs 并发 4 | 2.3 req/s，p50 1959ms | **100.4 req/s，p50 41ms** |
| /workshop/jobs?view=kanban | （未单独测过；与列表同源） | 43.8 req/s（并发 1）／34.3（并发 4） |
| /workshop/dashboard | 145 req/s，p50 7ms | 126 req/s，p50 8ms（噪声范围内） |

工单列表并发 4 时是 **44 倍**吞吐。dashboard 基本不变 —— 原因值得记：dashboard 传的是
主店 branchId，只扫主店的工单；而 org 级账号打开工单列表页时 **branchId 为 null，等于扫
全库工单**。所以这个修复对 OWNER/MANAGER 这类账号的价值远大于对分店账号。

## 交接说明

- **行为变化（都是有意的，逐个列出来方便 review）**：
  ① 机修看板：状态过滤下推到数据库，并加 300 上限（按创建时间倒序）。单个分店的未完工单
     不会接近 300；真超过时会少显示最旧的，这是刻意的安全网。
  ② 工单页状态药丸的计数：现在对 MECHANIC 是按本人收窄的（原来药丸用全店计数、只有
     「All」药丸按本人收窄 —— 同一屏两套口径，属原有不一致）。列表与计数现在一致。
  ③ 看板每列显示「最新的 12 条」（原来也是 createdAt 倒序的前 12 条，顺序不变，只是取数有界）。
  ④ dashboard 的「今日工单」卡片：仍是今日新建、按时间倒序的前 9 张。
- 回归测试 tests/job-board-bounded.test.ts（7 条）：分页有界、看板每列有界且不超过该状态总数、
  状态过滤返回的每一行都必须是该状态、计数与逐状态 count 一一对上、今日计数用日期区间算、
  以及结构守卫（不存在 jobService.listBoard( 了、有界性写在仓库查询里）。
  **反向验证过**：摘掉 take → 「expected 7 to be 3」与「COMPLETED 列超过每列上限」2 条红；还原 → 7 条绿。
- 基线：tsc 0 ／ vitest 861 → 868（本分支从 main 切出，75 文件）／ build 通过。
- 注意：本分支与 perf/bounded-list-queries（客户页）改的是不同文件，互不依赖；但两分支
  各自带一个测试文件，合并顺序不影响。
