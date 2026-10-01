---
date: 2026-10-01
title: P5 主体 —— branch 不再做数据分区：隔离职责退役，`?branch=` 失效
branch: feat/p5-retire-branch-scope
---

## 改动

P5 的最后一块，也是这个项目里**唯一一次改变"谁能看到什么"**的改动。所以它值得被仔细写下来。

### 1. 退役了什么

| API | 旧语义 | 现在 |
|---|---|---|
| `scopedBranchId(session)` | org 级 → null；分支级 → 自己的 branchId | **恒 `null`**（等价于"不加 branch 过滤"） |
| `applyBranchScope(where, s, exp)` | 分支级强制锁本分行（忽略 `?branch=`）；org 级按显式 `?branch=` 过滤 | **原样返回 `where`**（`?branch=` 也一并失效） |
| `scopedStaffWhere(s, roles)` | 只列本分行的可指派员工 | 列**本 org 全部**可指派员工 |
| `isOrgLevelRole` / `canManageOrgSettings` | 数据范围轴 / 功能开关轴 | **保留** —— 见下 |

**为什么这条轴必须退役**：它的规则是"总部角色不过滤、分支角色过滤"，于是
**同一家店里的两个人看到的数据不一样**，而那纯粹是他们账号上 `branchId` 字段的差别 ——
不是角色、不是权限，是一个**记账字段**在当权限用。多租户模型里"店"是 `Organisation`，
`Branch` 只是隐藏的 1:1 门店记录，所以这条轴既没有意义，又留着这个漏洞。

**两个谓词只退役一个**：`isOrgLevelRole` 是**数据范围**轴（退役），
`canManageOrgSettings` 是**功能开关**轴（继续有效，`MANAGER` 在里面 —— 那是 2026-09-17 owner
明确要的"manager 能用总部级后台功能"）。文件头的注释里把这个区别写清楚了，
免得下一个人看到"分行退役了"就把两个一起删。

### 2. 写入路径：权限 vs 记账分开了

新行（工单/任务/线索）仍然需要一个 `branchId` 才能落库 —— 但那是**记账**（这一行算在哪家门店头上），
不是权限。所以新增 `writeBranchId(session)`，并把三处写入路径从退役助手改过来，**行为保持不变**：

- `src/lib/job-branch.ts` `resolveNewJobBranchId`：自己的门店（属于本 org 才算）→ 退回主门店；
- `src/actions/leads.ts` `defaultOrgBranch`：同上；
- `src/actions/tasks.ts` createTask：总部级用显式指定的，分行级用自己所属门店（与原来逐字一致）。

### 3. 两条"钉住旧语义"的测试改了（这是重点）

- `tests/role-matrix.test.ts` 原来断言 `scopedBranchId(MANAGER, b1) === "b1"`（"分行级必须锁在本店"）——
  改成断言**新不变量**：任何人都返回 null、`applyBranchScope` 不注入条件、
  而 `writeBranchId` 仍然解析出归属门店。
- `tests/attendance.test.ts` 原来断言考勤导出路由**必须**含 `scopedBranchId(` ——
  改成断言**更重要的那条**：必须按 `organisationId` / `org.id` 收窄
  （否则导出会把别家店的行踪也带出去）。**红线没有降级，只是换了正确的坐标。**

### 4. 三份文档在描述已退役的行为

`docs/TESTING_ACCOUNTS.md` / `TESTING_BRANCH_GUIDE.md` / `ACCOUNTS_BY_BRANCH.md` 都写着
"分支级账号只见本分行数据（严格隔离）"—— 改完之后它们是**假的**。
已在文首加 P5 说明、把"隔离模型"一节标为历史记录，并指出**隔离的替代品是租户**。
（`docs/SETUP_AND_PREPARATION.md` 里那几条是**带日期的历史记录**，当时为真，保留。）

## 影响

**行为变化（这是本次唯一需要你点头的部分，已确认）**：
`D&Z Testing Branch` 的账号**现在能看到主店的数据**。
实测：`test.manager@dz.my` 与 `test.owner@dz.my` 在工单列表上看到**同样的 7 条**
（按旧文档，前者应当是"只见本分行（空数据）"）。

也就是说：**演示用的分行隔离没有了**。要演示隔离，得开两个租户。
这是施工单上写明的方向（"一个 org = 一家店、全员看全店"），但它确实是一次可见性放宽，
所以留在 PR 描述和本文档里备查。

## 交接说明

**实测证据**：

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `pnpm test` | **1102 通过 / 98 文件**（改了 2 条断言，无新增文件） |
| `pnpm lint` | 退出码 0（830 warning / 0 error） |
| `pnpm build` + kickstart | 通过 / 三服务 200 |
| Playwright | **55 通过** |
| 浏览器实测（dev.db，2 个门店） | `test.owner` 工单 **7** 条 ｜ `test.manager`（旧语义下应为 0）工单 **7** 条 → **sameVisibility: true** |

**没有做变异测试**：这次改的是"删掉一个语义"，没有新增守卫；取而代之的证据是
① 两条测试断言从"旧语义"翻到"新不变量"（它们现在会拦住回退），
② 浏览器实测的可见性变化（7 = 7），③ 全量 + e2e 全绿。

### 已知残留（下一片，纯清理，不影响行为）

`scopedBranchId(session)` / `applyBranchScope(...)` 仍出现在约 30 处调用点里 ——
它们现在**恒为无操作**（返回 null / 原样返回 where）。留着是为了不在同一个 PR 里
改 25 个文件；机械清理（把这些恒空的分支参数从调用点删掉）作为下一片。
**风险**：名字还在，读代码的人会以为它还有作用 —— 所以 `branch-scope.ts` 文件头
和每个函数上都写了"已退役"。这是**明知的技术债，且写下来了**，不是忘了。
