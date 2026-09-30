---
date: 2026-09-30
title: P0 多租户安全止血（匿名数据面、跨租户读写、清空按钮）
branch: docs/perf-load-results
---

## 改动

多租户隔离方案（`docs/MULTI_TENANT_PLAN.md`）批准后的第一期：**只止血，不动架构**。
本期不引入 `scopedDb` / `requireTenant()`，也不改 schema —— 那些是 P1/P2。

### 1. 生产数据库（已执行，可逆）

`scripts/harden-supabase-exposure.mjs`（新，幂等，默认只读检查）：

1. `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon` —— 83 张表。
2. `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon` ——
   否则下次迁移建表又会自动带上 anon 授权（本项目已有 57 个迁移）。
3. 22 张**没开 RLS** 的表 `ENABLE ROW LEVEL SECURITY`（含整个考勤/薪资/佣金簇）。
4. `docs/rls-policies.sql` 的助手函数改成 fail-closed：
   - `app_jwt_claim()` 只认 **`app_metadata`**（原来读 `user_metadata` —— 那是登录用户
     自己就能用 `updateUser({data})` 改的，等于**用户可以自选租户**）；
   - `app_is_admin()` / `app_is_staff()` 加上 `app_current_org_id() <> ''` 前置
     （原来空 claim 时 `'' <> 'CUSTOMER'` 恒真 —— 「没登录 = 员工」）；
   - 删掉 46 条策略里的 `app_current_branch_id() = ''`（无 claim 时恒真 = 分行过滤整体失效）。
5. `scripts/gen-rls-policies.ts` 同步这三处，避免下次重新生成时把修复覆盖掉。

### 2. 应用代码

- **`src/actions/developer.ts`**：`resetBusinessData()` 原本对 40 张表 `deleteMany({})`
  —— **没有任何租户收窄，一点就清空所有租户的业务数据**。删除顺序与作用域抽到
  `src/lib/tenant/business-data-scope.ts`（唯一定义，避免"加了表忘了加作用域"漂移），
  每张表按 `organisationId` 或关系路径收窄；`getDeveloperOverview` 的 5 个计数同样收窄。
- **`src/app/api/export/route.ts` / `attendance/export/route.ts`**：`organisation.findFirst()`
  → 会话里的 `orgId`（原来任何登录用户导出的都是第一家店的客户/线索/产品**含成本价**）。
- **`src/app/invoice/[id]/page.tsx` / `quotation/[id]/page.tsx`**：发票/工单按租户收窄，
  抬头改取本租户（原来任何员工能读别家发票，且抬头印别家公司名与税号）。
- **`src/actions/workshop.ts` `resetRiderPassword`**：取客户时同时比对 `organisationId`
  （原来会用 service role 改掉**别家 rider 的密码** = 跨租户账号接管）。
- **`src/app/qr/rider|motorcycle/[id]/page.tsx`**：删掉 `OR [{qrToken}, {id}]` 的 id 兜底
  （cuid 可枚举，兜底让不可枚举 token 的防护形同虚设）；加归属校验 ——
  顾客本人**或本租户员工**（这张码本来就是印给店里扫的，不能退化成只剩骑手），
  未登录去 `/login`（该页同时有员工与骑手两个 tab）。
- **`src/app/rider/motorcycles/[id]/page.tsx`**：保养史按车主收窄（原来改 URL id 就能读别人的）。
- **`src/actions/rider.ts` 六个入口全部改为会话取身份**：
  - `bookService` / `updateProfile` —— `customerId` 不再由客户端传；
  - `respondApproval` / `respondQuotation` —— 原先**完全没有会话检查**，任何调用者都能
    批准/拒绝**别家**的维修授权与报价。现在先按 `job: { customerId: 本人 }` 证明归属再调服务
    （服务签名未改，作用域读放在 action 里，与 `listApprovalsForCustomer` 同一谓词）；
  - `addMotorcycle` / `updateMotorcycle` —— `customerId` 从入参移除，车辆按 `customerId: 本人` 取，
    审计行原先写的是**受害者**的 `organisationId`（假脚印），现在写本人的；
  - `markNotificationsRead` / `submitReview` —— 同样的问题，`submitReview` 的
    `branchId` 也改为服务端推导（工单门店 → 顾客门店 → 本组织主店），
    原先可以以别人名义写评价并触发一条发往那人的致谢消息。
- **客户端不再谎报成功**：`broadcast-button` / `review-card` / `notifications-list` /
  `approval-card` / `quotation-card` 原先都不看服务端返回值就弹成功 toast。
  服务端被拒时用户会看到"已发送/已批准"，比报错难查得多 —— 五处都补了 `if (!res.ok)`。
- **无鉴权的 Server Action 补门禁**：`slots.ts`（整文件零会话检查）、`notifications.ts`、
  `tasks.ts` + `modules/tasks/service.ts`、`ai.ts`、`rider.ts`（`bookService`/`updateProfile`
  改为从会话取顾客，`customerId` 不再由客户端传）、`marketing.ts`（含**会花钱的
  `broadcastCampaign`**）、`messaging.ts`、`integrations.ts`、`motorcycles.ts`、`products.ts`。
- **`src/actions/notifications.ts`**：`markAllNotificationsRead` 原本是
  `updateMany({ where: { readAt: null } })` —— **无条件**，一次点掉所有组织所有同事的通知。
  作用域改为**与列表页完全一致**（分行/组织 + 系统通知），**刻意不按 userId 收窄**：
  通知是"给这个店看的"，列表里有 `userId: null` 与同事的行，按 userId 收会变成"点了没反应"。
- **`src/middleware.ts`**：matcher 补 `/invoice`、`/quotation`、`/qr`（这三段原先完全不经过
  middleware，会话不刷新、角色跳转矩阵也不适用）。

### 3. 测试

- `tests/business-data-scope.test.ts`（新，5 条）：结构断言"没有任何一项退化成空条件"，
  以及**行为断言** —— 真建两个租户，按 A 的作用域跑完整删除循环，A 清空、**B 一行不少**
  （带对照组证明库里确实有两家）。
- `tests/tenant-isolation-guards.test.ts`（新，8 条）：`organisation.findFirst()` 的**棘轮**
  （当前 78 处，只许降不许升）+ 本期每个修复点的防回退断言。
- `tests/api-auth.test.ts`：补 matcher 覆盖断言。
- `tests/broadcast-messaging.test.ts`：更新 mock（`campaign.findFirst`、
  `permission.findUnique`、完整 SessionUser 形状）—— 不更新会红。

### 4. 顺带修掉一个"新库建不起来"的既有缺陷（与本方案无关，但挡路）

`prisma/migrations/20260923120000_service_job_item_catalogue_link` 与
`20260923072852_invoice_counter` **重复**：后者已经用 "RedefineTables" 把
`ServiceJobItem` 重建并带上 `productId/serviceTypeId/packageId` 与三个索引，前者又
`ADD COLUMN` 了一遍。

两种库里执行顺序**相反**，所以在已迁移的库上看不出来：
- dev.db / 生产：前者先跑，后者后加（`_prisma_migrations.finished_at` 更晚）；
- **全新的库**：按目录名字典序，`20260923072852` 在前 → 前者三条 `ADD COLUMN` 全部撞
  `duplicate column name: productId` → **迁移链中断**。

表现为 `prisma migrate deploy` / `pnpm db:reset` / Playwright 的 `global-setup`
在新建库时直接失败 —— 新同事上手、CI、e2e 从零跑，全都会卡在这里。

SQLite 没有 `ADD COLUMN IF NOT EXISTS`，所以把前者的重复语句去掉、留成有说明的空操作；
列与索引最终形态不变（由 `invoice_counter` 提供）。已迁移的库不受影响
（Prisma 按目录名记录已应用迁移，不因文件内容变化而重跑）。

## 生产实测（改前 → 改后）

只用 `.env` 里那个**随浏览器分发的公开 anon key**、不登录，`GET /rest/v1/<表>?select=id&limit=0`：

| 表 | 改前 anon 可见 | 改后 |
| --- | --- | --- |
| AttendancePunch（考勤自拍 + GPS） | 7 行 | **401** |
| Quotation | 11 行 | **401** |
| StaffPayout（薪资） | 5 行 | **401** |
| Document | 1 行 | **401** |
| ChecklistItem（策略就是 `true`） | 10 行 | **401** |
| Customer / ServiceJob / Invoice | 0（正常） | **401** |

改后：`anon 有 SELECT 的表 = 0`、`未开 RLS 的表 = 0`、生产应用 `/`、`/login`、`/catalogue`
全部 HTTP 200、Supabase Auth `/auth/v1/settings` 200 —— **应用零影响**
（应用走 Prisma，连接角色 `postgres` 带 `rolbypassrls`，且全项目不用 PostgREST 读业务数据）。

## 基线验证（全部通过）

| 门槛 | 结果 |
| --- | --- |
| `pnpm exec tsc --noEmit` | **0 错误**（退出码 0） |
| `pnpm test` | **889 通过 / 78 文件**（退出码 0） |
| `pnpm build` | 退出码 0 |
| `pnpm exec playwright test --project=desktop-chromium` | **55 通过（5.3m）**，退出码 0 |
| 生产匿名数据面 | 7 张探针表全部 401 |

## 影响

- **应用功能零影响**：数据全走 Prisma（bypassrls），Supabase client 只用于 `auth.*` 与
  admin API，Storage 用 service_role。唯一需要 PostgREST 的场景本来就不存在。
- **PostgREST 面在 P3 之前一律拒绝**：因为 `app_jwt_claim` 只认 `app_metadata`，而
  `injectBizClaims` 目前还写 `user_metadata`。这是**刻意的**（宁可 fail-closed，也不要可伪造的
  租户身份）；P3 把 claim 改写到 `app_metadata` 后，它才会重新对合法用户开放。
- **权限门用 `view` 而不是 `edit`**：这些页面的按钮本来就不看 edit 权限，收成 edit 会让
  SALES_MANAGER / SERVICE_MANAGER / PARTS_MANAGER / AUDITOR 当场失去在用的功能。
  矩阵的 view/edit 缺口单列待决策，不在本期顺手改。

## 交接说明

- **`ChecklistTemplate` 无法真隔离**：既没有 `organisationId`，`branchId` 又是**从没人写过**的
  裸标量（`seed-core` 与 `createChecklistTemplate` 都不写），模板实际是全局单例。
  因此 `checklists.ts` 里 `updateMany({ data: { isDefault: false } })` 等 7 处**故意保持原状**
  并在文件里留了说明 —— 不做一个"看起来修好了"的恒假过滤。P1 必须给它加列 + 回填。
- **`rider.ts` 的同类入口**（`respondApproval` / `respondQuotation` / `addMotorcycle` /
  `updateMotorcycle` / `markNotificationsRead` / `submitReview`）本期已一并处理，
  见上；同类模式若再出现（拿客户端传的 `customerId` 直接查库），按同一口径修。
- **P1 必做**：47 个模型补 `organisationId`（`ChecklistTemplate`、`StaffPayout`、`Motorcycle`
  这些在原地修不了的）、全局唯一键改复合（`plate`/`sku`/`jobNumber`/`invoiceNumber`/
  `User.email`/`authId`）、三个全局编号分配器加 org 收窄、`Organisation.slug`。
- **P2 必做**：`scopedDb` 强制层 + 消灭剩余 78 处 `organisation.findFirst()`（棘轮预算同步调小）
  + `$queryRaw` 收口 + 重写 RLS 生成器（修 36 条同义反复、补 22 张表的策略）。
- 生产回滚：`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;` 与逐表
  `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`（见脚本头部注释）。
