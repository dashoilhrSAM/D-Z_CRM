---
date: 2026-10-01
title: P5 收尾 —— 把已退役的 branch 分区参数从 30 多处调用点删干净
branch: feat/p5-drop-inert-branch-args
---

## 改动

上一片（PR #118）把 `branch` 的**语义**退役了，但为了不在同一个 PR 里改 25 个文件，
留下了约 30 处**恒为空的无操作**调用点（`scopedBranchId(session)` 一定返回 null、
`applyBranchScope(...)` 一定原样返回 where）。这一片把它们删干净 —— **行为零变化**。

**做法：先删函数，让编译器列清单。** 删掉 `scopedBranchId` / `applyBranchScope` 的导出之后，
`tsc --noEmit` 直接给出 31 个文件的完整清单（含行号），比人工 grep 可靠 —— 它连"我只是 import 了但没用"
都算进去。然后按语义分四类替换：

| 类别 | 处数 | 替换 |
|---|---|---|
| **读过滤**（把 branch 传进模块 `list()`/`where`） | ~12 | 直接去掉这个条件（查询只按 `organisationId` 收窄） |
| **取哪家门店**（`scopedBranch ? findUnique : findFirst(isMain)`） | ~11 | 一律 `findFirst({ organisationId, isMain: true })` —— 一家店只有一个门店 |
| **作用域对象**（notifications/audit-logs 的 `baseWhere`/`scopeWhere`） | 3 | 去掉分支分支，只留组织条件 |
| **"只能改本分行的对象"检查**（发票折扣、车辆转让） | 2 | 删除 —— 分行不再是隔离边界，越权防护仍是 `organisationId` 收窄 |

另外把 `ReportScope.branchId`（考勤报表）改成**可选**并注明"已不再参与过滤"，
保留字段是为了不破坏既有调用方 —— 一个 org 就是一家店，新代码不该传它。

### 两条源码守卫一并翻到新不变量

`tests/attendance.test.ts` 里有两条**按写法断言**的守卫（"页面/导出路由必须含 `scopedBranchId(`"）——
它们钉的是旧语义。改成断言**更重要的那条**：必须按 `organisationId` 收窄
（否则会把别家店的考勤/行踪列出来）。红线换坐标，没有降级。
`tests/role-matrix.test.ts` 增加结构断言：`scopedBranchId` / `applyBranchScope`
**不应再被导出**（退役的 API 不许回来）。

## 影响

- **行为零变化**：这些调用点在这片之前就已经是空操作（上一片验证过：`test.manager` 与 `test.owner`
  看到同样的 7 条工单；这片跑完仍是同样结果，e2e 55 全绿）。
- `src/lib/branch-scope.ts` 现在只剩三件事，且都是**当下真实存在**的概念：
  `canManageOrgSettings`（功能开关）、`isOrgLevelRole`（数据范围，已退化）、
  `writeBranchId`（记账：新行落在哪家门店）、`scopedStaffWhere`（列本 org 可指派员工）。
  **不再有任何"看着像隔离、其实是空操作"的函数。**

## 交接说明

**实测证据**：

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | **0 错误**（清单从 31 个文件收敛到 0） |
| `pnpm test` | **1102 通过 / 98 文件** |
| `pnpm lint` | 退出码 0（0 error） |
| `pnpm build` + kickstart | 通过 / 三服务 200 |
| Playwright | **55 通过** |

**这片的"验证"就是编译器**：删掉导出后 tsc 精确列出每一处，修到 0；
因为改动全在"删掉一个恒空的参数"，运行时行为不可能改变 —— 而 e2e 55 全绿正是这个论断的证据。

**踩到的两个小坑**：
1. 我第一版把 `applyBranchScope` 当成了死代码 —— 因为 grep 用了 `--include=*.ts` 而调用点在 `.tsx` 里。
   **数调用点时必须同时包含 `.tsx`**（否则会得出"没人用，可以删"的错误结论）。
2. 结构化替换脚本每处都断言"原文命中且次数正确"，其中 `src/actions/workshop.ts` 三处缩进不同
   （两处 4 空格、一处 2 空格），一次命中数对不上就被拦下来了 —— 比静默改错好。

### P5 完成，多租户 0→5 阶段全部收口

- **P5 剩余**：`?branch=` 的 3 处残留（`workshop/bookings` 的 searchParams 声明、`rider/book`、
  `qr/workshop`）—— 它们现在**已经不参与过滤**，纯粹是没人用的参数，可随手删；
- 生产侧仍待办（需要业主操作）：授一个平台管理员、CI 的 4 个 Secrets。
