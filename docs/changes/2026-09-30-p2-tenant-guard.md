---
date: 2026-09-30
title: P2 租户强制层与审计（scopedDb + 用测试测出未收窄查询）
branch: docs/perf-load-results
---

## 改动

P2 的目标是"把隔离从『每个调用点记得写』变成『忘了写就会被抓出来』"。
这一轮交付的是**机制 + 可测的清单 + 第一个真实改造**，不是一次性改完 175 个文件。

### 1. 租户守卫（`src/lib/tenant/guard.ts`，新）

两种模式，用途不同：

**审计模式（`TENANT_GUARD=report|throw`）** —— 挂在一个**普通** Client 上，只**检查**每条查询
有没有带租户条件，不注入任何东西。价值在于：照常跑一遍已有的 927 条单测，
拿到的是**代码实际发出的查询**，而不是静态猜"哪些看起来没收窄"。

```bash
node scripts/tenant-guard-audit.mjs      # 跑全量单测 + 聚合，输出生产侧调用点清单
```

**强制模式（`scopedDb(prisma, orgId)`）** —— 绑定租户的 client：读/写自动注入租户条件，
`create` 自动补租户值，**`findUnique` 直接拒绝**（它的 where 只吃唯一键，结构上写不出租户条件
——那正是 IDOR 的经典形态）；空 `organisationId` 抛错。

判定依据是 P1b 的 `scope-map.ts`（每张表怎么到达租户的唯一定义）。

### 2. 审计在开发过程中被自己抓出三次假绿/误报（值得记下来）

1. **审计一个字的输出都没有，而它看起来像"零违规"**。原因：用 `process.on("exit")` 收尾写盘，
   在 vitest 的 worker 里**根本不触发**。改成每条即时落盘。教训与项目里反复出现的那条一样：
   *best-effort + 空 catch = 假绿*。
2. **`require("node:fs")` 在 ESM 模块里不存在**，而它被 `try/catch` 吞掉了 —— 于是"写盘失败"
   与"没有违规"长得一模一样。现在写盘失败会 `console.error`（吵出来）。
3. **两类误报**：`findUnique` 一开始被无条件标红，于是
   `findUnique({ where: { organisationId_year: {...} } })` 这种**完全合规**的复合键查询也被算进去
   （-64）；`whereHasTenant` 只在 AND/OR/NOT 里找键，进不了任意嵌套对象，同样的复合键又误报一次
   （-113）。修完后数字从 646 降到 469。

**守卫的能力边界（必须知道）**：它只看**一条查询的 args**，看不到查询**之后**的手工校验。
所以它的输出是**分诊清单，不是判决书**。实测例子：`bulk/apply.ts:60` 被点名 14 次，
但下一行就是 `branch.organisationId !== input.organisationId` 的手工校验 —— 那是安全的。

### 3. 第一个真实改造：客户列表 / 详情（P2 清单里的最高频生产命中）

`src/repositories/prisma/customers.repository.ts` 原先**每个方法都没有租户条件**：
列表页会列出**所有租户**的客户，详情页按 cuid 直查也是跨租户的。

- 读方法一律把 `organisationId` 做成**必需参数**（`list` / `listWith` / `listPageWith` /
  `getById` / `getByPhone` / `search` / `count`），`getById` 从 `findUnique` 改成带租户的 `findFirst`。
- `CustomerService.listSummaries` / `getPassport` / `search` 同步；两个页面传 `session.orgId`
  （详情页把 `getSessionUser()` 提到查询之前）。
- 原生 SQL 分支加 `c."organisationId" = ${organisationId}`。

**为什么用"必需参数"而不是"记得在 where 里写"**：改完后 `tsc` 一次性指出 10 个调用点
（2 个页面 + 8 处测试夹具）—— 编译器替我们盯着每一个调用方，漏了根本编译不过。

**中途自己踩的一个坑**：给那条原生 SQL 加租户条件时写成了
`WHERE org = ? AND (A OR B OR C` —— **括号没闭合**；更要紧的是如果没有这层括号，
`AND` 比 `OR` 结合得紧，`A AND B OR C OR D` 会变成 `(A AND B) OR C OR D`，
**等于只给第一个分支加了租户条件，后两个分支照样跨租户**。是测试把它抓出来的。

### 4. 测试

- `tests/tenant-guard.test.ts`（新，12 条）：证明强制层真的拦得住 ——
  别家的 id `findFirst` 查不到、`updateMany`/`deleteMany` 影响 0 行、`create` 自动补租户、
  `findUnique` 抛错且错误信息说清怎么改；以及判定函数对复合唯一键/AND/OR/裸 id 的处理。
- `tests/customer-list-page.test.ts`：加了一条**跨租户断言**（另一个租户建一个同名客户，
  本租户的列表只能命中自己的那一个，并带对照组证明那个同名客户确实存在），
  以及一条结构守卫（仓库里的每个客户查询都必须带 `organisationId`，含原生 SQL）。

## 验证

| 门槛 | 结果 |
| --- | --- |
| `tsc --noEmit` | 0 错误 |
| `pnpm test` | **927 通过（81 文件）** |
| `pnpm build` | 通过 |
| Playwright | **55 通过** |
| 审计复测 | 客户路径已从生产清单消失；生产侧剩余头部项主要落在 bulk / commission / completion |

### 一次自己犯的流程错误（值得记）

加完 `tests/tenant-guard.test.ts` 后我跑了 `vitest` 却没重跑 `tsc --noEmit`，
于是 `next build` 的 TS 检查在一个 `create` 调用上报错（生成的 client 类型要求 `data` 里有
`organisationId`，而运行时是靠 `scopedDb` 注入的 —— 类型表达不了这件事）。
构建中断还把 `.next/BUILD_ID` 删了，三个本地服务因此起不来。
**教训：新加文件之后必须跑完整基线（tsc + test + build），不能只跑测试。**

## 交接说明

- **P2 剩余工作（有据可查，不用再猜）**：直接看 `node scripts/tenant-guard-audit.mjs` 的
  "生产代码里的未收窄查询"清单，按次数从高到低分诊。已抽查的两类：
  · **误报**（查询后有手工校验）：`src/modules/bulk/apply.ts:60`、`:65`、`src/modules/bulk/export.ts`；
  · **真问题**（查完没有任何归属校验）：`src/modules/commission/engine.ts:45`、
    `src/services/completion.ts:95` —— 都是 `serviceJob.findUnique({ where: { id } })`。
- **改造的推广路径**：像 customers 那样把 `organisationId` 做成**必需参数**，
  编译器会给出完整的调用点清单；`scopedDb` 适合用在拿不到干净签名的地方。
- **审计不要做成硬门禁**：它有已知误报（手工校验、传递安全），设成 CI 阻断会逼人加豁免注释。
  正确的用法是定期跑、看趋势（数字应该单调下降）。
- 回归：`.tenant-guard.jsonl` 是本地诊断产物，已加进 `.gitignore`。
