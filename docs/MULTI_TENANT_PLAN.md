# D&Z CRM — 多租户隔离改造方案（一家 dealer / workshop = 一个独立租户）

> 状态：**方案待评审，未执行**。本文不含任何已落地的代码、schema 或数据库改动。
> 目标口径（来自 owner）：把每一家 dealer/workshop 彻底分开；**不再有 branch 概念**；**customer 不共用**；每间 workshop 数据完全隔离；并且要能"管理"这些租户。
> 证据来源：源码静态审计（842 处 Prisma 调用 / 175 个文件）、生产库只读实测（Supabase PostgreSQL）、现有测试与脚本。所有 file:line 均已核对。

---

## 0. 结论摘要

### 0.1 现状判定：**这个项目现在不是多租户，只是"单租户 + 一个分行概念"**

`organisationId` 字段确实铺了 35 个模型，代码注释也写着 "multi-tenant ready (§86)"。
但**"有字段"不等于"有隔离"**。真正的隔离语义建立在三个支点上，三个支点目前**全部缺失**：

| 支点 | 现状 | 证据 |
|---|---|---|
| **① 请求带租户身份** | 不存在。租户 = `db.organisation.findFirst()` 的返回值 | src 内 **74 处** `organisation.findFirst()`（全项目 108 处 organisation 查询） |
| **② 查询强制带租户谓词** | 不存在。零安全网，全靠人手写对 | `src/lib/db.ts` 是裸 `PrismaClient`；全项目无 `$extends`/`$use`/tenant guard |
| **③ 越权有第二道闸** | 名义上有 RLS，但**应用连接 `rolbypassrls = true`**，且 22 张表根本没开 RLS | 生产实测，见 §1.4 |

**结论：今天往库里加第二个 `Organisation`，得到的不是隔离，是随机串数据。**
新 rider 注册会落到"按名字排序第一"的那家店（`auth-supabase.ts:204,440`），新建 staff/产品/线索会落到 `findFirst` 撞到的那家店，发票抬头会印成别家的公司名与税号。

### 0.2 最重要的时间窗口：**现在做，成本≈0**

生产库只读实测（`DST_DATABASE_URL`）：

```
Organisation 1 · Branch 2 · User 20 · Customer 4 · ServiceJob 35 · Invoice 22 · Booking 10 · Motorcycle 7
```

**只有一个真实租户、4 个客户、35 张工单。** 数据回填、唯一键改造、编号系列重排的迁移风险几乎为零。
等第 2、3 家 dealer 上线后再做，同一套改动的成本会随"必须带停机窗口 + 数据对不上要人工核"而指数上升。

### 0.3 三件必须先做的事（与多租户可以解耦）

1. **P0 安全止血**——生产上**现在**就有匿名可读的数据裸露（已实测复现），以及一个**一点就清空所有租户业务数据**的按钮（`src/actions/developer.ts:140-152`）。这两件事与多租户架构无关，应立刻处理。
2. **确立租户上下文**（§3.1–3.2）——这是所有其它改动的前置：S2/S3/S4 的修法取决于"租户从哪里来"。
3. **给"隔离"建可执行的验收**（§4.6）——否则改完没有任何东西能证明改对了。

> 这三件事**不是本方案的新主张**：项目自己的 `docs/CAPACITY_AND_UPGRADE_PLAN.md:180-182` 已经写下
> "Prisma 直连，**RLS 对 Prisma 无效**；隔离完全依赖每处查询都带 organisationId。今天只有 1 个 org，少写一个条件完全看不出来；500 家 dealer 时它就是一个**跨租户数据泄露**"，
> 并在 `:307`、`:321` 把"静态检查每条租户表查询必须带 organisationId""生产跨租户**负向测试**必须失败"列为 P1 前置。
> 本方案是把那份容量评估里已经点名的三件缺失控制（静态检查 / `SET LOCAL` + RLS / 跨租户负向测试）具体化并排期。

### 0.4 已定稿的路线

**共享数据库 + 共享 schema + `organisationId` 行级隔离 + 数据访问层强制 + RLS 兜底**，分 6 期（P0–P5），约 **6–9 周**单人全职。
不推荐 DB-per-tenant / schema-per-tenant，理由见 §2.1。

配套两项已拍板决定：**`Branch` 保留表、降级为隐藏的 1:1 门店记录并移除全部 UI**（§2.2）；**身份用 `AuthLink` 多对多映射 + `Organisation.slug` 作为运营句柄 + 四级解析链、暂不做子域名**（§2.3）。
三项决定的完整记录与连带影响见 **§8**。

---

## 1. 现状分析（带证据）

### 1.1 已有的地基（可复用，不用推倒重来）

| 资产 | 位置 | 价值 |
|---|---|---|
| `Organisation` 租户模型 + 35 个模型已有 `organisationId` | `prisma/schema.prisma:35` | 方向已经对了，只是没走完 |
| 统一会话解析 `getSessionUser()`，含 `orgId`/`branchId`/`role` | `src/lib/session-user.ts:35-51` | 请求级租户的天然挂载点，已被 66 个文件引用 |
| 角色×模块矩阵（唯一定义源） | `src/lib/auth/role-modules.ts` | 平台级权限可直接复用这套结构 |
| 审计日志 `AuditLog` + `audit()` | `prisma/schema.prisma:1651`、`src/lib/auth/audit.ts` | 已带 `organisationId`，支持管理台合规留痕 |
| **全项目作用域写得最好的两个模块** | `src/actions/bulk.ts`、`src/modules/documents/service.ts:137-150` | 现成的"正确姿势"范本（见下） |
| 静态断言测试的项目惯例 | `tests/automation-multi-org.test.ts` | 已经用"grep 源码禁止某个模式"来防回归，新防线可照抄 |
| 多租户 cron 的正确写法 | `src/modules/automation/scan.ts`、`src/actions/reminders.ts:11-51` | 已按租户循环 + 截断自报，2026-09-29 修过 |
| 数据导入管线 | `src/modules/bulk/**` | 开通新租户导入客户/车辆/产品/员工的现成工具 |
| 容量模型 | `docs/CAPACITY_AND_UPGRADE_PLAN.md` | 已有 500 店规模的量化推演，多租户方案要与它对齐 |

**范本一：`src/modules/documents/service.ts:137-150`** —— 全项目唯一把"组织相等"当作**不可跳过的第一道门**的 helper：

```ts
export async function canAccessDocument(user, doc) {
  if (doc.organisationId !== user.organisationId) return false;   // ← 先判租户
  if (doc.uploadedById && doc.uploadedById === user.id) return true;
  const seesModule = await can({...}, permissionModule, "view");
  if (!seesModule) return false;
  if (isHeadOfficeRole(user.role)) return true;
  return doc.branchId !== null && doc.branchId === user.branchId;
}
```
它的调用方 `src/app/api/documents/[id]/file/route.ts:23-30` 也照做了（取行 → 判定 → 403 → 审计）。**这是全项目的正确样板。**

**范本二：`src/actions/bulk.ts`** —— 唯一一个每个入口都带 `organisationId`、且校验"文件里的分行属于本组织"的 action 文件（`:77`、`:136`）。

### 1.2 量化风险面

| 指标 | 数值 | 说明 |
|---|---|---|
| `db.<model>.<op>` 调用 | **842** 处 / 175 文件 | 手写作用域的规模 |
| 无 `organisationId` 列的模型 | **47 / 83**（不含 `Organisation` 自身） | 含 `ServiceJob`/`Invoice`/`Booking`/`Motorcycle`/`Payment`/`Quotation`/`Campaign`/`StaffPayout`/`Notification`… |
| 仅按 id 取值的 where | **231** 处 | `where: { id }`，结构上无法带租户谓词 |
| 取 id 参数的 server action | **90** 个 | 其中 **53 个完全没有会话校验**，**77 个没有 organisationId 比对** |
| 动态路由页/route | **17** 个 | 其中 **11 个无 org 校验**，**6 个完全没有鉴权** |
| `organisation.findFirst()` | **74** 处 / 55 文件（src） | 事实上的"多租户策略" |
| `$queryRaw`（绕过一切 ORM 守卫） | 3 处 / 2 文件 | 租户守卫必须单独覆盖 |
| `isMain` 兜底且**不带** org 过滤 | 10 处 | `workshop/layout.tsx:45`、`dashboard/page.tsx:26`、`inventory/*` 四个页… |

**`StaffPayout`（薪资）既无 `organisationId` 也无 `branchId`**（`schema.prisma:419-420`），**`Motorcycle` 无 `organisationId` 也无 `branchId`**（`:499-503`）。这两张表**在原地无法修**——必须加列。这是"先补 schema 再谈隔离"最硬的论据。

### 1.3 被"看起来存在"误导的三处

#### （a）`branch-scope.ts` 的"严格隔离"对跨租户恒真

```ts
// src/lib/branch-scope.ts:43-46
export function scopedBranchId(session) {
  if (isOrgLevelRole(session.role)) return null;   // ← OWNER/MANAGER 级返回 null
  return session.branchId ?? null;
}
```
于是所有 `if (scope && row.branchId !== scope) return 拒绝` 形状的判定，**对任何租户的 org 级角色都直接放行**。
受影响：`src/actions/invoices.ts:40,70,116`、`src/actions/payouts.ts:155`、`src/actions/bulk.ts:73`。

#### （b）RLS 在生产上**既没生效、也不完整**

生产库只读实测：

- Prisma 连接角色 = `postgres`，`rolbypassrls = true` → **应用自己的查询完全绕过 RLS**。
  （代码自己也写了：`src/lib/branch-scope.ts:7` "App UI 走 Prisma（非 RLS），RLS 只防 Supabase PostgREST 直连。"）
- **22 张表根本没开 RLS**：`Document`、`StaffPayout`、`AttendancePunch`、`AttendanceCorrection`、`AttendanceReview`、`Quotation`、`CommissionLedger`、`CommissionRule`、`CommissionTier`、`CommissionTierSet`、`CommissionClaim`、`BulkImportSession`、`InvoiceCounter`、`Occasion`、`TrendTopic`、`PromoProduct`、`BrandProfile`、`ServiceJobPhoto`、`ScheduledMessage`…
- 61 条策略里**只有 25 条真正引用 `app_current_org_id()`**；其余 36 条是 `EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ...)` 形式的**同义反复**——它只断言"这行的分行属于*某个*组织"，没断言"属于*当前*组织"。
- 策略助手**默认放行**：`app_is_staff()` = `role <> 'CUSTOMER'`，空角色 → TRUE；`app_current_branch_id() = ''` 在无 claim 时 → TRUE。
- 同义反复的**根因在生成器**（这是为什么它不能靠"再跑一次生成器"修好）：
  - `scripts/gen-rls-policies.ts:47` 把 `"Organisation" o` JOIN 进来时**不带任何谓词**；`:54` 的 WHERE 只把外层表挂到 FK 链的下一跳。`o."id"` 从头到尾没和 `app_current_org_id()` 比过。
  - `:41` 的兜底 `if (!chain) return "true"` —— 于是 `ChecklistItem` 直接变成 `(true)`（`rls-policies.sql:74`）。
  - `orgChain()` 是 BFS，**会选错父表**：`ServiceJobPart` 经 `Product` 而不是 `ServiceJob` 推导租户（`rls-policies.sql:64`）——即使补上谓词，语义也是错的。
  - `:10` 读的是**生成出来的 client 的 DMMF，不是 `schema.prisma`**。生成器最后一次运行是 2026-09-01，之后新增的表**一个策略都没有**——这正是 22 张表裸奔的机制。它也没接进 `package.json` / `vercel.json` / 任何 CI，没有任何东西会在 `prisma migrate dev` 之后重新生成或校验它。

**实测复现（仅用 `.env` 里公开的 anon key，未登录，`limit=0` 只取计数）：**

| 表 | anon key 可见行数 |
|---|---|
| `AttendancePunch`（考勤照片 + GPS） | **7** |
| `Quotation` | **11** |
| `StaffPayout`（薪资） | **5** |
| `Document` | **1** |
| `ChecklistItem`（策略就是 `true`） | **10** |
| `Customer` / `ServiceJob` / `Invoice` | 0（正常，被 RLS 挡住） |

`NEXT_PUBLIC_SUPABASE_ANON_KEY` 是随浏览器分发的公开值。**这是当前生产上正在发生的裸露，不是理论风险。**

#### （c）rider 的"门店绑定"是死代码

`src/app/qr/workshop/[id]/page.tsx:21` 确实从 URL 正确解析出了租户；`src/actions/rider-context.ts:10-18` 把 `organisationId`/`branchId` 写进 `dz_org`/`dz_branch` cookie——**然后全项目没有任何一行代码读它，也没有写库**。
`grep -rn "dz_org\|dz_branch" src e2e tests` → 只有这两行写入。
**数据模型里根本不存在"客户 → 门店"的关联。** 所以 rider 属于哪家店，完全由注册时的 `findFirst` 决定，且**永远无法更改**。

### 1.4 会立刻炸的四类跨租户冲突（第二家店上线第一天）

| # | 冲突 | 位置 | 后果 |
|---|---|---|---|
| 1 | `Motorcycle.plate @unique`（`schema.prisma:507`） | 全局唯一 | **同一台车不能被两家店服务** |
| 2 | `ServiceJob.jobNumber @unique`（`:616`）+ 分配器全局扫描 `jobs.repository.ts:81-86`（`findFirst({orderBy:{jobNumber:"desc"}})`，基准 1023，前缀 `DZ`） | 全局唯一 | 编号串号；且 B 店能从自己的工单号**读出 A 店的业务量** |
| 3 | `Invoice.invoiceNumber @unique`（`:1000`）+ `InvoiceCounter { year Int @id }`（`:1857`）+ `services/completion.ts:32,56-64` | 全局唯一 | **发票号无法按店分系列**（税务/合规问题）。代码注释把因果写反了：`// 为什么按年份全局而不是按组织：invoiceNumber 是全局唯一键` —— 是约束造成的，不是业务要求 |
| 4 | `User.email @unique`（`:291`）+ `Customer.authId @unique`（`:457`）+ `User.authId @unique`（`:295`） | 全局唯一 | 同一个人**不能**在两家店有身份；同一台车主的手机号在两家店 → **两边都登不进去**（`auth-supabase.ts:290-293` 硬报错） |

其余同类：`Product.sku`、`PromoProduct.sku`、`Lead.leadNumber`（`leads/service.ts:38-43` 分配器也不带 org）、`LoyaltyAccount.membershipId`。

### 1.5 高风险跨租户读写（抽样，完整清单见附录 B）

**先看两条"现在就会造成不可逆损失"的：**

| 位置 | 问题 | 后果 |
|---|---|---|
| **`src/actions/developer.ts:140-152` `resetBusinessData()`** | 在 40 张表上循环 `deleteMany({})`，**完全没有 org 过滤**；UI 入口 `src/app/workshop/settings/developer/page.tsx:37`，仅由 `assertOwner()`（`:14-19`）把守 | **任何一家店的 owner 点一下"清空业务数据"，所有租户的业务数据一起没。** 它写的审计行只记录操作者自己的 `orgId`，事后连范围都对不上。这是全项目**最危险的单个操作** |
| **`src/app/api/export/route.ts:11`**、**`src/app/api/attendance/export/route.ts:34`** | `db.organisation.findFirst()` → CSV 导出**永远导出第一家店**的数据，与会话无关 | 登录任意账号即可下载**别家**的客户名单/线索/产品（含成本价）/考勤 |

其余抽样：

| 位置 | 问题 | 后果 |
|---|---|---|
| `src/actions/workshop.ts:547` `resetRiderPassword` | 取 `customer.authId` 后**不比 org**，`:567` 直接 `admin.updateUserById({password})` | **跨租户改掉别人的 rider 密码 = 账号接管** |
| `src/app/invoice/[id]/page.tsx:21` | 只判 `session.kind !== "staff"`，且 `/invoice/*` **不在 middleware matcher 内** | 任何租户的员工读任何租户的发票；`:32` 还印错公司名/税号 |
| `src/app/quotation/[id]/page.tsx:24` | `jobService.getDetail(id)` → `repo.getById(id)` 无 org 过滤 | 同上 |
| `src/app/workshop/customers/[id]/page.tsx:24` | `customerService.getPassport(id)` → `getById(id)` 无 org 过滤 | 跨租户读姓名/电话/邮箱/**authId**/内部备注/消费额 |
| `src/modules/customers/service.ts:21-33` → `customers.repository.ts:46-80` | 列表查询与搜索**完全不带 org**，含原生 SQL 分支 | 客户列表页显示**全部租户**的客户 |
| `src/app/workshop/jobs/new/page.tsx:22-23` | `db.customer.findMany({...})` / `db.motorcycle.findMany({...})` **没有 where** | 新工单下拉列出所有租户的客户与车牌 |
| `src/actions/slots.ts:28,34` | 整个文件零鉴权，按 id 改/删 `AppointmentSlot` | 任意调用者可改别家预约时段 |
| `src/actions/notifications.ts:13` | `updateMany({ where: { readAt: null } })` | 把**所有租户所有用户**的通知标记为已读 |
| `src/actions/checklists.ts:33,52` | `updateMany({ data: { isDefault: false } })` 无 where | 清掉所有租户的默认检查模板 |
| `src/actions/marketing.ts:181` → `:188` | 无鉴权、无 org，直接 `broadcast()` | **跨租户群发 WhatsApp，花别家的钱** |
| `src/app/api/poster/[id]/route.ts:12` | `requireStaff()` 后按 id 硬删 `MarketingAsset` | 跨租户硬删除 |
| `src/app/qr/rider/[id]/page.tsx:19`、`qr/motorcycle/[id]/page.tsx:21` | **零鉴权**，`{qrToken}` 与 `{id}` 双通道，`{id}` 直查绕过不可枚举 token | 匿名读 PII |
| `src/actions/rider.ts:13-39,53-57` | `customerId` 由客户端传入，无会话校验 | 任意调用者可改别家客户姓名/电话 |

**另一类隐性风险：没有任何"同租户外键"约束。** schema 与数据库都不阻止 `ServiceJobPart.productId` 指向别家的 `Product`、或 `ServiceJob` 引用别家的 `Inventory`。今天的隔离全靠代码，一旦有绕过入口（导入、脚本、后台修数据），脏关系无法被数据库拦住。

### 1.6 生产拓扑与迁移现实（直接决定方案可行性）

| 事实 | 证据 | 对方案的影响 |
|---|---|---|
| 生产走 **Supabase 事务池**（Supavisor，`?pgbouncer=true&connection_limit=1`），连接角色 `postgres`，**`rolbypassrls = true`** | `docs/DEPLOYMENT_CHECKLIST.md:94,51,61`；生产库只读实测 | RLS 天然对应用无效。要让 RLS 生效必须换非 bypass 角色 + 每请求 `SET LOCAL`（事务池下可行，但每请求多一条语句） |
| 本地 `DATABASE_URL` 是 SQLite，**repo 里没有 Postgres 的 `DATABASE_URL`**（只在 Vercel env） | `.env:1`；`.env` 只有 `DST_DATABASE_URL` | 任何回填脚本的本地验证与生产执行是两条路 |
| **生产没有迁移历史**：56 个迁移全是 SQLite 方言，无法在 PG 重放；实际机制是 `scripts/sync-prod-schema.mjs` 用 `prisma db push`（不带 `--accept-data-loss`）做**加列** | `vercel.json` buildCommand；`scripts/sync-prod-schema.mjs:380,42,355-368` | **加列能自动上生产；回填数据不能。** 必须另写幂等回填脚本，按"先加列（兼容旧代码）→ 再回填 → 再收紧约束"三步走 |
| 两个 schema 文件（`schema.prisma` SQLite / `schema.pg.prisma` PG，各 83 模型）**手工同步**，无生成器、无漂移检查 | 文件对比 | 每期改动都必须双改；这是本项目出过 4 次全站事故的地方 |
| `schema.pg.prisma` 的 datasource **没有 `directUrl`/`DIRECT_URL`** | `prisma/schema.pg.prisma:9-12` | 迁移类操作要靠 `sync-prod-schema.mjs` 自己把 `:6543` 改回 `:5432`（`:254-266`） |
| 备份 = **一份手写 dump**（`docs/backups/prod-backup-2026-09-02*.sql`），无脚本、无定时、无按租户导出 | `grep pg_dump` 零命中 | 多租户前必须先有"整库 + 按租户"两级备份，否则退租/误删不可恢复 |
| 测试安全网：`tests/` 76 个文件、`e2e/` 17 个 spec；**跨租户测试只有 1 个**（`tests/automation-multi-org.test.ts`） | 目录清点 | 改造期间这是唯一能证明"没改坏隔离"的东西，必须扩充 |

> ⚠️ 现状里有一个容易踩的坑：**约 15 个单测会读写甚至"对齐"共享的 `prisma/dev.db`**（`tests/service-catalogue.test.ts:5` 原文："这条测试会把 dev.db 对齐到目标状态"）。
> 改造期间跑测试会改本地库，**基线验证与数据库快照要分开做**，不要指望"跑一遍测试"能得到干净的库。

### 1.7 身份层：结构性阻塞

- **登录 = 1:1 硬绑定**：`db.user.findUnique({ where: { authId } })`（`session-user.ts:40`）、`db.customer.findUnique({ where: { authId } })`（`:45`、`rider-customer.ts:14`）。仅因为列是全局唯一才写得出来。
- **注册落到"名字排序第一"的店**：`auth-supabase.ts:204`、`:440` `findFirst({ orderBy: { name: "asc" } })`；且 `branchId` 从不设置。
- **手机号是全局命名空间**：`phone-identity.ts:27-35` 拉全表在 JS 里比（select 里连 `organisationId` 都没有）；`auth-supabase.ts:60-63` 是第二份副本且**无 `orderBy` → 随数据库返回顺序**。撞号 → 硬失败；或静默登进错误的店。Supabase 侧 `authUserByMsisdn`（`phone-identity.ts:43-50`）全局扫用户，`planPhoneLogin`（`phone-login.ts:45-50`）甚至会**删除**它判定为孤儿的 auth 用户。
- **JWT claim 是用户可写的**：`injectBizClaims` 用**用户自己的客户端** `supabase.auth.updateUser({ data: claims })`（`auth-supabase.ts:35,48`）写 `user_metadata`——而 Supabase 的 `user_metadata` 允许用户自行修改。RLS 的 `app_jwt_claim()` 又**优先读 `user_metadata`**。即：**租户 claim 不可作为授权依据**（详见 §3.3）。
- **claim 从不刷新 + `active` 从不校验**：`injectBizClaims` 只有 4 个调用点，全在登录路径；`updateStaff`（`workshop.ts:474-501`）改角色后不刷新 claim，但 middleware `:73-97` 又按 claim 决定跳转；`User.active` 在身份层**零处校验**，`toggleStaffActive` 不做 Supabase ban。**被辞退的员工仍可登录。**

---

## 2. 目标模型（三项决定已定稿，见 §8）

### 2.1 隔离粒度：共享库 + 行级（✅ 已定）

| 方案 | 隔离强度 | 迁移成本 | 运维成本（50–500 店） | 判定 |
|---|---|---|---|---|
| **A. DB-per-tenant**（每店一个库/Supabase 项目） | 最强 | 极高：57 个迁移 × N，Prisma 多客户端，SQLite 本地开发模式要重做 | 极高：连接数爆炸（serverless）、备份/监控/升级逐店跑、跨店报表不可得 | ❌ |
| **B. schema-per-tenant**（Postgres schema 隔离） | 强 | 高：运行时切 `search_path`，pgbouncer 事务池下易错；Prisma 官方不支持多 schema 动态切换 | 中高 | ❌ |
| **C. 共享库 + `organisationId` 行级 + 强制层 + RLS 兜底** | 足够（有强制层时） | 中：一次性补列 + 回填 | 低：一套迁移、一套备份、跨店报表天然可得 | ✅ **推荐** |

选 C 的决定性理由：**这个项目的代码已经有 35 个模型带 `organisationId`，且已有大量正确的收窄写法（bulk 模块、cron 模块）。** 把隔离从"记忆"变成"机制"，是在已有地基上加一层，不是重写。而 A/B 会把隔离推到路由/配置层，**没有一个统一的收口点**——842 处调用照样要靠人手写对。

> 若将来某个大客户在合同上要求物理隔离，C 也能局部升级：给该租户单独一个库 + 一个只指向该库的 deployment，业务代码不变（因为租户上下文是显式传入的）。

### 2.2 租户定义与 branch 的处置（✅ 已定：保留表 + 降级隐藏）

**租户 = `Organisation` = 一家 dealer/workshop。**

关于"不再有 branch"，**保留 `Branch` 表但降级为内部实现细节**（已拍板），而不是删表：

- 保留理由：`branchId` 出现在 **29 个模型 / 534 处源码引用**，且有 `@@unique([branchId, productId])`、`@@unique([branchId, date, startTime])` 等约束。删列是一次高风险大迁移，收益只是"看起来干净"。
- 产品层收敛（这才是 owner 要的）：
  1. 开通租户时**自动创建唯一一间 branch**（`isMain: true`），名字 = 店名；
  2. **移除所有 branch 选择/切换 UI**（`?branch=` 过滤、分行管理页、`MyBranchSettings`）；
  3. `branchId` 语义从"数据分区轴"降级为"该租户唯一门店的外键"，**所有查询统一按 `organisationId` 收窄**。
- 收益：隔离轴从 2 条降到 1 条。今天 `scopedBranchId()` 那类"org 级角色不过滤"的漏洞（§1.3a）会**整体消失**，而不是逐个补。
- 将来某家 dealer 真要多门店，再把 `Branch` 提回一等公民即可——数据模型没丢。

### 2.3 身份模型（**已定稿**：以运营管理最优为准）

事实约束：Supabase Auth 是**一个项目一个全局用户池**，`auth.users.email`/`phone` 在项目内唯一。
需求：customer 不共用；同一个人可能在两家店都有身份。

#### 决定 A · 一个 Supabase 项目 + 多对多身份映射表

```
model AuthLink {
  id             String   @id @default(cuid())
  authId         String   // supabase auth.users.id
  organisationId String
  kind           String   // "STAFF" | "CUSTOMER"
  userId         String?
  customerId     String?
  createdAt      DateTime @default(now())

  @@unique([authId, organisationId])        // 一人一店一条
  @@unique([organisationId, kind, userId])
  @@unique([organisationId, kind, customerId])
  @@index([authId])
}
```

- 一个自然人 = 一个 Supabase auth 账号（邮箱/手机仍全局唯一，符合 Supabase 现实）。
- 同一个人在 N 家店 = N 条 `AuthLink` + N 个业务主体（N 个 `User` 或 N 个 `Customer` 行）。
- **这正是"customer 不共用"要的语义**：客户档案按店隔离，跨店的是"登录凭证"，不是"客户数据"。
- 迁移量：生产 20 个 User + 4 个 Customer → 24 条 `AuthLink`，一次性回填。

配套唯一键改造（详见 §3 Layer 0）：`User.email` → `@@unique([organisationId, email])`；`authId` 的全局 `@unique` 移除。

#### 决定 B · 租户句柄 = `Organisation.slug`（**这是"最好管理"的核心答案**）

管理租户时最频繁的动作不是"隔离数据"，而是**指认一家店**：客户打电话说"我登不进去"、要发开通链接、要按店导出/备份、要开账单、要看日志、要查"这家店的工单为什么没发出去"。
`cuid`（`cmt0vj3410000i86ajk3ij5wi`）在这些场景里**不可用**。

因此把 `slug`（如 `dz-pj`、`aaa-motor-kl`）定为**租户的运营句柄**，贯穿全部运维面：

| 运维面 | 用 slug 的方式 |
|---|---|
| 登录入口 | `/t/dz-pj/login`（而不是让用户在表单里猜自己在哪家店） |
| 客户支持 | 客服直接给链接 `/t/dz-pj`，不需要查数据库 |
| 平台管理台 | `/platform/tenants/dz-pj` |
| 备份/导出文件 | `dz-pj-2026-10-01.sql` / `dz-pj-customers.csv` |
| 日志与告警 | Sentry / 审计日志带 slug，一眼看出是哪家店 |
| 计费与合同 | 账单、发票、对账按 slug |
| 门店二维码 | `/qr/workshop/<qrToken>` 落地后显示 slug 与店名 |

**slug 规则**：全局唯一、小写 kebab、**创建后不可改**（可加自定义域名字段做展示名，但句柄不可变——否则日志与备份对不上）。开通时从店名生成并检测冲突。

#### 决定 C · 租户解析：一个函数、四级优先，**不做子域名**

```ts
// src/lib/tenant/resolve.ts —— 全项目唯一解析入口
resolveTenant(req, session) :
  1. 签名 cookie `dz_tenant`（HMAC + httpOnly + SameSite=Lax + host-only）   ← 已确认过的店
  2. URL：/t/<slug>/*  或  /qr/workshop/<qrToken>                          ← 显式入口
  3. 已登录用户唯一所属租户（AuthLink 只有 1 条）                            ← 单店用户的常态
  4. 命中多条 → 返回候选列表，**由页面弹选择器，绝不静默挑一个**
```

**为什么现在不做 `acme.dzcrm.app` 子域名**（这是本决定里唯一需要解释的取舍）：

- 子域名的真实收益是**品牌**，不是管理。管理的三个刚需——指认租户（slug）、直达租户（`/t/<slug>`）、消歧（选择器）——**在单域名下已经全部满足**。
- 子域名的成本是实打实的：泛域名 DNS + 通配证书 + Vercel 域名配置 + Supabase Auth 的 redirect URL 白名单要放开通配 + cookie 作用域跨子域 + **本地开发必须起代理才能测**（本项目 e2e 依赖 `localhost:3102`，加一层解析会拖慢整条验证链）。
- **最关键的**：P3 这一期改的是**身份**，不是路由。把 DNS/证书/回调白名单和身份改造捆在一起，是为了零隔离收益去承担一次高风险的并发变更。
- **推迟的成本几乎为零**：解析链里预留第 0 级即可——
  ```ts
  // 现在留空，将来加泛域名时只改这两行
  0. req.headers.get("host") 的子域部分 → slug
  ```
  将来启用 = 加一条 DNS + Vercel 域名 + 上面两行，**业务代码零改动**。

> 何时该重新评估子域名：当出现①要按店给客户看独立品牌页（`dz-pj.dzcrm.app`）、②企业客户在合同里要求独立域、③需要把某家店的登录页与平台登录页彻底分开。三者任一出现再做，届时是一次配置变更，不是重构。

#### 决定 D · 员工与骑手的租户内唯一性

- **员工**：`@@unique([organisationId, email])`。同一个人在两店 = 两个 `User` 行 + 两条 `AuthLink`，登录时由 slug/cookie/选择器决定进哪一个。**同一个人同一邮箱可以正常在两家店各有一个身份。**
- **骑手**：`Customer.phone` **不加唯一约束**（一家人共用一个号在真实门店很常见），但加 `@@index([organisationId, phone])`，匹配收窄到店内。店内重号不硬报错（今天 `auth-supabase.ts:290-293` 的做法会把客户**锁在两家店门外**），改为提示去柜台合并。
- **riders 的"哪家店"**：由 QR / 预约链带入；`setWorkshopContext` 从死代码改成**真的写库**（写 `AuthLink` 或绑定上下文 cookie），替换今天那个客户端可随意填、又没人读的 `dz_org`。

#### 决定 E · claim 只当提示，不当授权

- `orgId`/`role` 写入 **`app_metadata`**（只有 service role 能写，用户改不了），
  今天写在 `user_metadata`（`auth-supabase.ts:35,48` 用**用户自己的客户端**）——**用户能伪造自己的租户**，而 RLS 的 claim 函数又优先读它。
- `getSessionUser()` **始终以数据库为准**（现状已经是这样，保持）。
- `updateStaff` 改角色/停用后同步刷新 claim；`active` 必须在校验链里（今天身份层零处校验，**被辞退员工仍可登录**）。

### 2.4 共享 vs 隔离的数据边界（必须写进合同的表）

| 类别 | 数据 | 隔离度 |
|---|---|---|
| **租户私有** | 客户、车辆、工单、报价、发票、收款、库存、采购、员工、考勤、薪资、佣金、消息、营销活动、线索、忠诚度、文档、审计日志、集成配置 | **严格按 `organisationId` 隔离** |
| **平台共享（只读）** | `Occasion`（节日/日历）、`TrendTopic`（营销趋势）、`BrandProfile`（品牌资料）——`organisationId` 为 null 即全局行 | 读共享，租户可建自己的覆盖行；**租户不可改全局行** |
| **平台专有** | 租户目录、订阅/计费、平台审计、支持访问记录 | 租户不可见 |
| **跨租户绝不共享** | **Customer / Motorcycle / ServiceJob / Invoice / Message** | 同一个人跨店 = 两条互不可见的记录 |

---

## 3. 改造方案（分层实施）

核心原则：**把隔离从"每个调用点记得写"变成"忘了写就报错"。**
今天 842 处手写作用域里，唯一能规模化的修法是在**数据访问层收口**，而不是逐个补 842 个 `where`。

### Layer 0 — Schema：让租户列成为普遍事实

1. **给 47 个无 `organisationId` 的模型补列**（含关系 + 索引）。
   对只能经父行到达的表（如 `ServiceJobItem` → `ServiceJob`）**照样冗余一列**——直接列是让"守卫"和"RLS"都简单的唯一办法。代价是写入时要同步，由 Layer 1 的扩展自动完成。
   **必补且原地无法修的**：`StaffPayout`、`StaffPayoutPayment`、`Motorcycle`、`MarketingAsset`、`AppointmentSlot`、`Campaign`、`Notification`、`Review`、`ChecklistTemplate/Item`。
   **暂不加列的例外**（要有明确理由并写进白名单）：`OtpAttempt`（登录前、无租户）、平台专有表。
2. **全局唯一键 → 租户内复合唯一键**：

   | 现在 | 改为 |
   |---|---|
   | `User.email @unique` | `@@unique([organisationId, email])` |
   | `User.authId @unique` / `Customer.authId @unique` | 移除，迁到 `AuthLink` |
   | `Motorcycle.plate @unique` | `@@unique([organisationId, plate])` |
   | `Product.sku @unique` | `@@unique([organisationId, sku])` |
   | `PromoProduct.sku @unique` | `@@unique([organisationId, sku])` |
   | `ServiceJob.jobNumber @unique` | `@@unique([organisationId, jobNumber])` |
   | `Invoice.invoiceNumber @unique` | `@@unique([organisationId, invoiceNumber])` |
   | `Lead.leadNumber @unique` | `@@unique([organisationId, leadNumber])` |
   | `LoyaltyAccount.membershipId @unique` | `@@unique([organisationId, membershipId])` |
   | `InvoiceCounter { year Int @id }` | `@@id([organisationId, year])` |
   | `Occasion.key` / `TrendTopic.dedupeKey` | **保持全局**（共享参考数据，已按 `organisationId` 做覆盖） |

3. **修三个全局编号分配器**：`jobs.repository.ts:81-86`、`services/completion.ts:32,56-64`、`modules/leads/service.ts:38-43` → 全部加 `organisationId` 收窄。
   `completion.ts` 里那句"因为全局唯一所以全局编号"的注释随约束一起作废。
4. **补复合索引**：`@@index([organisationId, <高频过滤列>])`。今天只有 8 个索引以 `organisationId` 打头——加列之后**必须同步加索引**，否则 500 店规模下每次查询都会退化成全表扫（与 `docs/CAPACITY_AND_UPGRADE_PLAN.md` 的模型直接冲突）。
5. **`onDelete: Cascade` 到 `Organisation`**：全项目只有 2 处 `onDelete`。租户退租时要能一条语句删干净（见 §5.4）。
6. **`Organisation` 补运营字段**：`status`（ACTIVE/SUSPENDED/TRIAL）、`slug`（唯一，租户解析用）、`plan`、`trialEndsAt`。

> 双 schema 文件（`schema.prisma` SQLite / `schema.pg.prisma` PG）与 `scripts/sync-prod-schema.mjs` 的漂移守卫必须同步更新——这是本项目历史上出过 4 次事故的地方。

### Layer 1 — 强制租户上下文（**最高杠杆**）

**设计**：`src/lib/db.ts` 导出的 `db` 不再是裸客户端，而是**租户绑定客户端**。

```ts
// src/lib/tenant/context.ts
export function scopedDb(tenant: TenantContext) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isTenantScoped(model)) return query(args);          // 白名单外的共享表
          const orgId = tenant.organisationId;
          switch (operation) {
            case "findUnique":   // findUnique 不能加非唯一列 → 等价改写
              return (prisma as any)[model].findFirst({
                where: { AND: [args.where, { organisationId: orgId }] },
              });
            case "findFirst": case "findMany": case "count":
            case "aggregate": case "groupBy": case "updateMany": case "deleteMany":
              args.where = { AND: [args.where ?? {}, { organisationId: orgId }] };
              break;
            case "update": case "delete":   // Prisma 5+ 允许非唯一过滤
              args.where = { AND: [args.where, { organisationId: orgId }] };
              break;
            case "create":
              args.data = { ...args.data, organisationId: orgId };
              break;
            case "createMany":
              args.data = (Array.isArray(args.data) ? args.data : [args.data])
                .map((d) => ({ ...d, organisationId: orgId }));
              break;
            case "upsert":
              args.where = { AND: [args.where, { organisationId: orgId }] };
              args.create = { ...args.create, organisationId: orgId };
              break;
          }
          const result = await query(args);
          if ((operation === "update" || operation === "delete") && result === null) {
            throw new Error("TENANT_SCOPE_VIOLATION: " + model + "." + operation);
          }
          return result;
        },
      },
    },
  });
}
```

**关键性质**：
- `findUnique({ where: { id } })` —— 那 62 处 + 70 处 update-by-id + 11 处 delete-by-id **自动变成租户内查询**，不需要逐个改。这是把 143 个结构性漏洞一次性关掉的地方。
- **失败即报错**（fail-closed）：没有租户上下文时，碰租户表直接抛 `TENANT_SCOPE_VIOLATION`，而不是默默返回全部。
- 需要绕过的系统路径（cron / seed / 平台管理台 / 开通脚本）走**显式**的 `systemDb("reason")`，并记审计。**"显式"是重点**：今天 `findFirst` 之所以危险，就是因为它看起来完全正常。
- **`$queryRaw` 覆盖不到**：全项目 3 处（`customers.repository.ts:66-71`、`services/dashboard.ts`）。做法：① 提供 `tenantRaw(orgId)` 强制传参；② 加静态测试，禁止 `$queryRaw`/`$executeRaw` 出现在 allowlist 之外（照抄 `tests/automation-multi-org.test.ts` 的思路）。

**调用侧怎么拿到 `scopedDb`**：
- `getSessionUser()` 已有 66 个引用，在它旁边加一个 `requireTenant()`：返回 `{ session, db }`（`db` 即绑定好的客户端）。
- codemod：`const session = await getSessionUser()` → `const { session, db } = await requireTenant()`，并删掉顶部的 `db` import。
- **静态 CI 守卫**（可执行、可 grep）：`src/app/**` 与 `src/actions/**` 中**不允许**直接 `import { db } from "@/lib/db"`；只允许从 `requireTenant()` 取。名单外文件需显式加入 allowlist 并注明理由。
- **顺手消灭 `organisation.findFirst()`**：74 处全部替换为 `session.orgId` 或显式传入的 `organisationId`；再加一条静态测试禁止这个表达式重新出现（`automation-multi-org.test.ts:14` 已经用同样手法禁掉了 scan/reminders 里的它）。

### Layer 2 — RLS 作为独立兜底（纵深防御）

RLS 治不了应用（连接角色 bypass），但它必须能治 **PostgREST 直连**——那是公开 anon key 就能到达的面，也就是 §1.3b 实测到的那条路。

1. **立刻 `REVOKE`**：`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;`
   应用从不通过 PostgREST 读业务数据（只用它做认证）。**这是一行、零风险、可立刻上的改动，直接关掉整个 PostgREST 数据面。**
2. **22 张没开 RLS 的表全部 `ENABLE ROW LEVEL SECURITY`。**
3. **重写生成器 `scripts/gen-rls-policies.ts`**：每条策略必须含真实租户谓词。现在的
   `EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON ... WHERE X."branchId" = "Branch"."id")`
   要改成
   `EXISTS (SELECT 1 FROM "Branch" b WHERE b."id" = X."branchId" AND b."organisationId" = app_current_org_id())`。
   今天它"看起来没事"，只是因为子查询里的 `Organisation` 自己被 RLS 过滤了——**这是靠巧合成立的，不是设计**。
4. **改掉默认放行**：`app_is_staff()` 加 `app_current_org_id() <> ''` 前置；`app_current_branch_id() = ''` 的"无过滤"语义删掉。项目在 `src/lib/api-auth.ts:43` 已经确立了"fail-closed"的价值观（cron 缺密钥就 503），RLS 必须同口径。
5. **`FORCE ROW LEVEL SECURITY` + 非 bypass 连接角色**（可选，后置）：让应用连接也受 RLS。代价是每个事务要 `SET LOCAL app.current_org`（pgbouncer 事务池下可行），多一条语句。建议放在 P4 之后作为额外硬化，不作为第一道防线。
6. **补 RLS 测试**（今天零覆盖）：脚本遍历 83 张表，断言 ① anon 可见 0 行；② 用租户 B 的 JWT 看不到租户 A 的任何行。

### Layer 3 — 身份（`AuthLink` + 租户感知登录）

1. 建 `AuthLink`（§2.3），回填 24 条，`session-user.ts` / `rider-customer.ts` 改为**按 (authId, organisationId) 解析**。
2. `phone-identity.ts` 的 `customersByPhone` 改成 `customersByPhone(orgId, phone)`——**收窄到店内**，同时给 `Customer` 加 `@@index([organisationId, phone])`。
   `Customer.phone` 需不需要"店内唯一"？建议**不加唯一约束**（重号在真实门店很常见：一家人共用一个号），但要在店内做**合并提示**，而不是像今天这样硬报错把客户锁在门外。
3. `signUpRider` / `completeRiderPhoneSignup` 的 `findFirst({orderBy:{name:"asc"}})` **删除**，改为由入口（QR/链接）传入 `organisationId`；无租户上下文时**拒绝注册**并提示扫码。
4. `dz_org`/`dz_branch` → 一个**签名**的 `dz_tenant` cookie，由 `resolveTenantSlug()` 统一写读；QR 落地页在确认时**写库**（建立 `AuthLink`）。
5. **claim 只当提示，不当授权**：`orgId` 写入 `app_metadata`（只能 service role 写，用户改不了），并且 `getSessionUser()` 始终以**数据库**为准。RLS 侧改读 `app_metadata`。
   今天 `injectBizClaims` 用用户自己的客户端写 `user_metadata`（`auth-supabase.ts:35,48`）——**用户能伪造自己的租户**，而 RLS 的 claim 函数优先读它。
6. `updateStaff` 改角色/停用后**同步刷新 claim**（或直接取消 claim 在授权中的作用，只留它做路由提示）；`toggleStaffActive` 加 Supabase ban + 会话吊销；`getSessionUser` 校验 `active`。
7. 登录解析：1 家直接进；>1 家弹租户选择器；**永不静默选一个**。

### Layer 4 — 入口与租户解析

- 一个函数收口：`resolveTenant(req)`：签名 cookie → URL slug/qrToken → 用户唯一所属租户 → null。
- 覆盖入口：`/login`、`/rider/login`、`/rider/signup`、`/qr/**`、`/catalogue`、`/contact`、`/test-ride`、`/invoice/[id]`、`/quotation/[id]`、`/api/export`、`/api/upload`、`/api/products/image`、`/api/poster*`、`/api/settings/qr-flags`。
- **middleware matcher 补漏**：今天 `["/workshop/:path*","/rider/:path*","/mechanic-app/:path*","/api/:path*"]` **漏掉 `/invoice/*`、`/quotation/*`、`/qr/*`**。公开文档页要么加鉴权，要么改成"签名链接"（不可枚举 + 过期）。
- 公开页面的 `{ id }` 直查兜底**必须删掉**（`qr/rider/[id]:19`、`qr/motorcycle/[id]:21`、`qr/workshop/[id]:21`）——它把不可枚举 token 的保护整个抵消了。

### Layer 5 — 平台管理台（回答"我要如何管理"）

新增 `/platform/*`，与 `/workshop/*` **物理分开**，由**新的、不隶属任何组织**的 `PLATFORM_ADMIN` 角色把守。

> 为什么新建角色而不复用 `SUPER_ADMIN`：`SUPER_ADMIN` 今天是**组织内**角色（在 `isOrgLevelRole` 里）。复用它等于给每个租户的超级管理员开出平台权限。生产实测当前**没有任何 SUPER_ADMIN 账号**（角色分布：MECHANIC 9 / MANAGER 3 / OWNER 3 / COUNTER_STAFF 2 / SERVICE_MANAGER 1 / MARKETING 1 / INVENTORY 1），所以新建是干净的。

| 能力 | 说明 |
|---|---|
| **租户目录** | 列表 + 状态 + 用量（员工数/工单数/客户数/存储/最后活跃） |
| **开通（Provisioning）** | 一个幂等的 `provisionTenant({name, slug, ownerEmail, ...})`：建 `Organisation` + 唯一 `Branch` + OWNER 用户 + Supabase auth 账号 + `AuthLink` + 默认配置（服务目录/检查模板/消息模板/预约时段/佣金规则）+ 产出**门店二维码与开通链接** |
| **停用/恢复** | `Organisation.status`，停用后全端拒绝（含 rider） |
| **支持访问（impersonation）** | 显式、限时（如 60 分钟）、**双向留痕**：平台审计 + 写进该租户自己的 `AuditLog`（"D&Z 支持人员于 X 时间查看了你的数据"）——这既是合规要求也是信任资产 |
| **数据导出** | 按租户全量导出（JSON/CSV），供退租与 PDPA 查阅请求 |
| **数据删除** | 导出 → 冷静期 → 硬删（含 Supabase auth 用户与对象存储） |
| **模板库** | 行业级默认配置（服务项目/套餐/检查清单/消息模板/佣金规则），开通时套用，租户可覆盖 |
| **迁移与升级** | 一套 migration 服务全部租户（这是选共享库最大的运维红利） |

`provisionTenant()` 的现成素材：`scripts/provision-demo-branch.ts`（已含"建 branch + 时段 + 员工 + Supabase auth + 幂等"）+ `src/lib/seed-core.ts:146-153`（默认数据）。**这两个脚本目前都硬编码 `findFirst()`，正好是要改的地方。**

---

## 4. 分期实施计划

> 估算按 1 人全职、熟悉本项目计。每期都必须以"基线全绿"收尾（`pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` / Playwright）。

### P0 · 安全止血（1–2 天）— **与多租户解耦，建议立刻做**

> ✅ **已完成（2026-09-30）**。全部 10 项已落地并验证：`tsc` 0 错误、`pnpm test` 889/889、
> `pnpm build` 通过、Playwright 55/55 通过；生产匿名数据面实测已关闭（7 张探针表全部 401），
> 生产应用与认证服务均 HTTP 200。
> 详细改动、生产实测数据与回滚步骤见 `docs/changes/2026-09-30-p0-tenant-isolation-bleed-stop.md`。
> 顺带修掉一个挡路的既有缺陷：迁移 `20260923120000` 与 `20260923072852` 重复加列，
> 导致**全新的库建不起来**（`db:reset` / CI / e2e 从零跑全部卡住）。

| 项 | 动作 | 为什么排最前 |
|---|---|---|
| **P0-0** | **给 `resetBusinessData()`（`src/actions/developer.ts:140-152`）加 org 收窄**，或在多租户上线前**直接从 UI 摘掉这个按钮** | 40 张表 `deleteMany({})` 无过滤，一点就清空所有租户。**不可逆** |
| P0-1 | `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;` | 一行、零风险，直接关掉整个 PostgREST 数据面 |
| P0-2 | 22 张表 `ENABLE ROW LEVEL SECURITY`（含考勤照片/GPS、薪资、报价、文档） | 当前匿名可读，已实测 |
| P0-3 | 修 `app_is_staff()` / `app_current_branch_id()` 的默认放行 | 现在是"没登录 = 员工" |
| P0-4 | `/api/export`、`/api/attendance/export` 的 `findFirst` → 会话里的 `orgId` | 当前是活的跨租户导出 |
| P0-5 | 删掉 `/qr/{rider,motorcycle,workshop}/[id]` 的 `{ id }` 直查兜底；`qr/rider`、`qr/motorcycle` 加鉴权 | 匿名读客户姓名/电话/邮箱 |
| P0-6 | `resetRiderPassword` 加 `organisationId` 比对（`workshop.ts:547`） | **跨租户账号接管** |
| P0-7 | `src/actions/slots.ts`、`notifications.ts`、`tasks.ts`、`checklists.ts`、`ai.ts`、`rider.ts` 补会话校验 | 53 个 action 完全无鉴权 |
| P0-8 | `checklists.ts:33,52` 与 `notifications.ts:13` 的无 where `updateMany` 修掉 | 一次影响所有租户 |
| P0-9 | middleware matcher 补 `/invoice/:path*`、`/quotation/:path*`、`/qr/:path*` | 这三段现在完全不经过 middleware |

**验收**：匿名 anon key 对 83 张表全部 0 行；`pnpm test` 全绿 + 新增针对 P0-0/P0-6/P0-7 的回归测试（照抄 `tests/api-auth.test.ts` 的结构化断言写法）。
**注意**：P0 的 RLS 部分走 `docs/rls-policies.sql` 的执行路径，而生成器本身要重写（§3 Layer 2），所以 **P0 先手工补丁止血，生成器的重写放到 P2**。
**为什么它排第一**：这些跟多租户改造毫无关系，且**现在就是活的漏洞**。

### P1 · Schema 补全与回填（5–8 天）

> ✅ **P1a + P1b 均已完成（2026-09-30）**。P1a 是"第二家店上线第一天就会撞"的部分
> （全局唯一键冲突），有界、可验证；P1b 是纯机械的铺列工作，需在 P2 强制层之前完成。
>
> **P1a 已做**：8 个全局唯一键 → 租户内复合唯一键；4 个模型补可空 `organisationId`；
> `Organisation` 加 `slug`/`status`/`plan`/`trialEndsAt`；8 个生产写入点补租户值；
> 工单/线索取号器按租户收窄；新增静态守卫（写入必须带租户值）。
> 生产分三步执行并逐项验证：**行数完全一致**（org1/moto7/job35/inv22/cust4/usr20）、
> 残留 NULL 全 0、8 个唯一键全部换到位、`sync-prod-schema.mjs --check` 报告
> **schema 与库一致**（下次部署不会被拦）。详见 `docs/changes/2026-09-30-p1a-tenant-scoped-uniques.md`。
>
> ⚠️ **两个必须记住的坑**：
> ① **发票取号刻意保持全局** —— `InvoiceCounter` 还没加租户列；若只把"回看最大号"按组织收窄，
> 计数器会被建到别家 max 之下，那家随后取号撞自己已有号 → P2002 → **整个完工事务回滚**。
> 要做按店分系列，必须给 `InvoiceCounter` 加列 + 复合主键，**并同时**收窄计数器与回看扫描。
> ② **复合唯一键不约束 `organisationId` 为 NULL 的行** —— 漏写这一列的写入路径会让该行
> 完全逃出唯一约束，且**没有任何运行时症状**，只能靠静态守卫钉住
> （已加入 `tests/tenant-isolation-guards.test.ts`）。
>
> **P1b 已完成**：① `checklists.ts` 那 7 处真修了；② `InvoiceCounter` 改 `@@id([organisationId, year])`
> 并把计数器与回看扫描**同时**收窄（坑 ① 已消除）；③ 补上 `ServicePackage`/`Attendance`/
> `AttendanceCorrection` **缺失的关系**（它们此前只有裸标量外键，根本无法按租户收窄）；
> ④ 四个模型的 `organisationId` 收紧为 NOT NULL + 外键 RESTRICT；⑤ **新增租户作用域地图**
> `src/lib/tenant/scope-map.ts` + 12 条对账测试（P2 强制层的前提）。详见
> `docs/changes/2026-09-30-p1b-tenant-scope-map.md`。
>
> ⚠️ **P1b 对原方案做了一处偏离，需要知道**：原计划"给 47 个模型都补 organisationId 冗余列"**没有执行**，
> 改为**关系路径 + 作用域地图**。理由：**嵌套写入不会触发 Prisma 扩展的 create 钩子**，
> 那些冗余列大概率长期为 NULL；而**复合唯一键不约束 NULL 行**，于是一列没人写也没人查的列
> 会让代码「看起来有了租户隔离」却什么都没拦。关系路径是精确的，代价只是一次 join。
> 将来若某条链成为性能瓶颈，再按索引需要**定点**冗余 —— 而不是一次性铺 42 列。

### P2 · 强制层与消灭 `findFirst`（8–12 天）

- `scopedDb` / `requireTenant()` / `systemDb(reason)`。
- codemod 替换 175 个文件的 `db` 取用方式；手工修 ~88 个"取 id 无 org 校验"的点（守卫会自动兜住大部分，剩下的手工确认）。
- `$queryRaw` 收口 + allowlist。
- 静态 CI 守卫（禁裸 `db` import、禁 `organisation.findFirst`）。
- 把 `branch-scope` 的隔离职责并入 `organisationId`（§2.2）。

**验收**：新增 `tests/tenant-isolation.test.ts`——建两个租户，断言每个 service/page 只返回本租户数据（含"对照组"证明库里确实有两家，照抄 `automation-multi-org.test.ts:68-80` 的写法）；静态守卫测试通过。

### P3 · 身份与租户解析（8–12 天）

> ✅ **P3a 已完成（2026-09-30）**：`AuthLink` 已建表并回填（本地 18 条 / 生产 20 员工 + 4 客户，
> **与有 `authId` 的账号数完全一致**）；`src/lib/tenant/identity.ts`（三条解析路径）+ 10 条测试；
> `src/lib/tenant/active-tenant.ts`（**签名**的 `dz_tenant` cookie）+ 7 条测试。
> 详见 `docs/changes/2026-09-30-p3a-auth-link.md`。
>
> ✅ **P3b 第 1 步已完成（2026-09-30）**：注册路径的邮箱/手机匹配全部加上租户条件，
> `organisation.findFirst({ orderBy: { name: "asc" } })` 两处删除，新增
> `src/lib/tenant/entry-tenant.ts`（slug → 签名 cookie → 唯一在营门店 → **否则拒绝**）
> + 24 条测试（含变异验证过的跨店回归测试）。详见
> `docs/changes/2026-09-30-p3b-step1-signup-tenant.md`。
> **第 2 步（松唯一键）的前置已满足，但它必须与第 3 步（解析链）同一批做** ——
> 因为 `injectBizClaims` 与 session 解析今天用的是 `findUnique({ where: { authId } })`，
> 唯一键一松它们会直接失败。
> **P3a 刻意没有松开那两个唯一约束** —— 理由就写在那份施工单里，不是没做完，是**不能先松**。

- `AuthLink` 建表 + 回填生产 24 条；`session-user.ts` / `rider-customer.ts` 改为按 **(authId, organisationId)** 解析。
- `User.email` → `@@unique([organisationId, email])`；`Customer.authId` / `User.authId` 去全局唯一。
- `src/lib/tenant/resolve.ts`：四级解析链（签名 cookie → `/t/<slug>` 或 QR → 唯一所属 → 候选列表），**第 0 级（子域）留空占位并注释将来接法**。
- 登录入口 `/t/<slug>/login`；`/login`、`/rider/login` 保留为无租户入口 + **多店选择器**。
- 租户内手机匹配（`customersByPhone(orgId, phone)`）—— ✅ **已完成**（P3b 第 1 步，租户参数**必需**）；
  `@@index([organisationId, phone])` **仍待做**：它是纯性能项，并进第 2 步那次 schema 变更一起上；
  店外/店内重号不再硬报错。
- `setWorkshopContext` 从死代码改为**写库 + 写签名 `dz_tenant` cookie**，删除 `dz_org`/`dz_branch`。
- claim 迁 `app_metadata`；`updateStaff` 后刷新 claim；`active` 进入校验链 + Supabase ban / 会话吊销。

**验收**：同一邮箱在两家店各有一个 `User`，各自登录且互不可见；跨店骑手在两家店各有 `Customer` 档案；`/login` 用多店邮箱登录时**必须出现选择器**（不得静默进入任一店）；被停用员工立即无法登录。

#### P3b 施工单（已勘察，2026-09-30）

**下面两个隐患决定了施工顺序 —— 先松唯一约束会直接引入越权与重复注册。**

**隐患 ①：注册时"哪家店"的答案是"按名字排序第一家"。**
`src/actions/auth-supabase.ts:204` 与 `:442` 都是
`db.organisation.findFirst({ orderBy: { name: "asc" } })`。
今天只有一家店所以是对的；两家店时这是一个**按字母序的抛硬币** ——
新客户可能被注册进别人的店。租户必须来自 `/t/<slug>/signup`（或已签名的 cookie），
不能来自这个查询。

**隐患 ②（更严重）：松开 `Customer.authId` 唯一键，会把"邮箱/手机匹配"变成跨店劫持。**
`auth-supabase.ts:410` 的 `db.customer.findFirst({ where: { email } })` 与
`:419` 的 `customersByPhone(...)` 都**没有租户条件**。
今天它们安全，是因为 `authId` 全局唯一兜住了；**唯一键一松，兜底就没了**：
在 B 店注册的人，可能匹配到 A 店那条同邮箱/同手机的客户记录并**把 authId 绑上去** ——
等于把 A 店的客户档案交给了一个本不该看到它的人。
所以 `email` / `phone` 的匹配必须**同时**加租户条件，且要在松约束**之前**完成。

**施工顺序（每一步都能独立验证）**

1. ✅ **已完成（2026-09-30）—— 先加租户条件，后松约束。**
   `customersByPhone(organisationId, local)`（租户参数**必需**，`tsc` 兜住漏写）/
   `customerByEmailInTenant(organisationId, email)`；注册路径四处（`signUpRider`、
   `requestRiderPhoneOtp`、`verifyRiderPhoneOtp`、`completeRiderPhoneSignup`）**先定租户再匹配**，
   且租户解析放在建 auth 用户**之前**（判不出门店时不留下孤儿账号）。
   注册的 org 来自新增的 `src/lib/tenant/entry-tenant.ts`：
   **显式 slug → 签名 cookie → 平台恰好一家在营门店 → 否则拒绝**（不再按字母序抛硬币）。
   登录入口的手机匹配**暂时**仍是跨租户的（`customersByPhoneAnyTenant`，结构守卫钉住只有一处），
   第 3/4 步随解析链收掉。测试：`tests/tenant-signup-scope.test.ts`、
   `tests/tenant-entry-tenant.test.ts`（+24，变异测试验证过会红）。
   详见 `docs/changes/2026-09-30-p3b-step1-signup-tenant.md`。
   ⏳ 有意留到第 2 步一起做：`@@index([organisationId, phone])`（纯性能项，并进那次双 schema 改动）。
2. ✅ **已完成（2026-09-30）—— 松唯一键**：`User.authId` / `Customer.authId`
   去全局唯一，改为 `@@unique([organisationId, authId])`（双 schema + 迁移
   `20260930234000_p3b_tenant_scoped_authid` + `Customer` 的 `@@index([organisationId, phone])`）。
   真正的"一人一店一条"由 `AuthLink` 的 `@@unique([authId, organisationId])` 守。
   **这一步之后"同一个人两家店"才真的可能出现。**
   - 编译器护栏**如期点出三处**（`resolve.ts` 里唯一所属的两处 `{ authId }` where、
     `phone-identity.ts` 的平台级检查），照报错逐个换掉；第 ③ 级同时换成候选链、
     第 ④ 级选择器同批接上。
   - **生产侧是破坏性 DDL**（`DROP INDEX`），`sync-prod-schema.mjs` 会拒绝自动执行：
     用新增的 `scripts/apply-prod-authid-tenant-scope.mjs`（默认演练、幂等、事务内、执行后复验）
     **先在生产执行，再合并**。详见 `docs/changes/2026-09-30-p3b-tenant-scoped-authid.md`。
   - ⚠️ 新解析链信任 `AuthLink`：**有 authId 却没有映射的账号会被当成"没有业务身份"**。
     部署前必须查一次漂移（实测生产 0/0）。
3. ✅ **已完成（2026-09-30）—— 解析链落地。**
   新增 `src/lib/tenant/resolve.ts`：四级来源固定顺序
   **① 签名 cookie → ② `/t/<slug>`/QR（第 4 步接）→ ③ 唯一所属 → ④ ≥2 条必须让用户选**，
   第 0 级（子域）留空占位。三个消费者（`session-user.ts`、`rider-customer.ts`、
   `injectBizClaims`）统一走 `requestPersonRef()` + `loadStaffForRef`/`loadCustomerForRefWith`，
   规则只写一遍。
   **关键语义**：cookie 指定了门店却没查到本人 → 返回"没有身份"，
   **绝不回退到别家店**（"你选的那家没有你"和"没选、系统替你猜一家"是两件事，后者就是串店）。
   **零查询回归**：今天没有任何代码写 `dz_tenant`，所以生产走的仍是第 ③ 级（与改造前同一条查询）。
   第 ③ 级的 `{ authId }` where 是**编译期护栏**：第 2 步松键后 `findUnique` 立刻不成立，
   编译器会逼着换成 `identitiesForAuthUser` 候选链 + 选择器。
   测试：`tests/tenant-resolve.test.ts`（10 条，含"cookie 指向的店没有他 → 不许翻别家店"、
   "同一 authId 两家店各取各店那条行"、以及"别处不许绕过解析链"的结构守卫 + 正向对照）。
   详见 `docs/changes/2026-09-30-p3b-resolve-chain.md`。
4. ✅ **已完成（2026-09-30）—— 入口与选择器**。
   - **多店选择器**：`/select-workshop`（页面 + action）；三个端（workshop / rider /
     mechanic-app）的布局在 `needsWorkshopChoice` 为真时把人送过去；action **只能**从
     `identitiesForAuthUser(authId)` 的候选里选（不变式变成代码）。
   - **解析链第 ③ 级换成候选链**（0 条 = 没身份、1 条 = 唯一所属、≥2 条 = 送选择器），
     与第 2 步同一批完成 —— 因为松键之后"多条"才真的可能发生。
   - **门店专属链接 `/t/<slug>`**：route handler + 可单测的 `planShopEntry`。
     slug 优先于 cookie；**进店前提是 AuthLink 里确实有这家店**；不是这家店的人 →
     选择器（不签 cookie、不猜一家）。顺带让 `/login`、`/rider/login` 真正消费 `?next=`，
     修好了三个 QR 落地页一直"生成了 next 却没人读"的回跳。
   - **注册流程的门店显式化**：`/t/<slug>/signup` + 四个注册入口都收 `tenantSlug`
     （`resolveEntryTenant({ slug })`）。注册的"进哪家店"从此**由链接决定**，
     不再依赖"唯一在营门店"的兜底判断；`/rider/login` 的"去注册"链接也会跟着门店走。
   - ⏳ **至此第 4 步已全部完成**（选择器 + `/t/<slug>` + `/t/<slug>/signup`）。
5. ✅ **已完成（2026-10-01）—— 清理**。
   - **死代码 `dz_org` 已删**：`actions/rider-context.ts` 的 `setWorkshopContext` 会把表单里的
     organisationId **原样写进一个既不签名、也没人读的 cookie**（写了等于没写，还让那个签名
     cookie 看起来"已经有隔离"）。唯一调用方是 QR 门店码页 —— 现在改走 `chooseWorkshop`
     （与多店选择器**同一个入口**：只能从 `identitiesForAuthUser` 的候选里选）并带 `next` 回跳；
     两个 action 文件合并为 `src/actions/tenant-context.ts`。
   - **`User.email` → `@@unique([organisationId, email])`**：双 schema 都已写全（生产上已有该索引）。
   - 新增守卫 `tests/tenant-cookie-source.test.ts`：cookie 名只有一处定义、
     `dz_org`/`dz_branch` 去注释后零出现、写门店 cookie 的调用点只在白名单里（都在写入口里校验候选）。
6. ✅ **已完成（2026-10-01）—— claim 迁 `app_metadata`**。P0 把 `app_jwt_claim()` 改成只认
   `app_metadata`（`user_metadata` 用户自己就能改），于是 PostgREST 面**一律拒绝** ——
   那是有意留下的 fail-closed。现在：`injectBizClaims` 与注册路径都写 `app_metadata`
   （service role 客户端，过渡期同时写 user_metadata）；`identityFromClaims` 按同样优先级读
   （app_metadata 优先、user_metadata 兜底），字段名从 `user_metadata` 改为 **`claims`**
   （原名本身就是让下一个维护者误以为"user_metadata 是身份来源"的原因）。
   存量账号用 `scripts/backfill-auth-app-metadata.mjs` 回填（默认演练；**claims 从业务库推导，
   不复制 user_metadata** —— 否则会把用户伪造的 `role` 洗白成权威值；写入是合并，
   保住 Supabase 自己的 `provider`/`providers`）。

**验收**：同一邮箱在两家店各有一个 `User`，各自登录且互不可见；跨店骑手在两家店各有 `Customer`
档案；`/login` 用多店邮箱登录时**必须出现选择器**（不得静默进入任一店）；被停用员工立即无法登录；
**在 B 店用 A 店客户的邮箱注册，不得绑上 A 店那条记录**（隐患 ② 的回归测试 ——
✅ 已由 `tests/tenant-signup-scope.test.ts` 覆盖，并用变异测试确认过它会红）。

### P4 · 平台管理台（10–15 天）

- 🟡 **第 1 块已完成（2026-10-01）—— 开店能力 `provisionTenant`**：
  `PlatformService.provisionTenant()`（UI→Service→Repository→Adapter 分层）+ CLI
  `scripts/provision-tenant.ts`（默认 dry-run；**护栏判据是目标主机**，因为本仓 `.env` 里
  就放着生产连接串、本地跑时 `NODE_ENV` 仍是 development）。一次事务建齐
  Organisation(slug) + 唯一 Branch + 店主 User + Supabase auth + **AuthLink** + 默认配置
  （服务/来源/阶段/模板/时段/库位），并产出 `/t/<slug>` 开通链接与门店码。
  同邮箱开第二家店会复用手册 auth 账号并新增 AuthLink（跨店账号 → 登录出现选择器）。
  详见 `docs/changes/2026-10-01-p4-provision-tenant.md`。
  顺带：Supabase Auth 收进 provider 端口（`src/providers/auth-admin.ts`）、
  QR token 的纯函数提到 `src/lib/random-token.ts` —— 两处都是因为 **`server-only` 模块
  让脚本 import 不了**，而"开店必须能由 CLI 跑"。
- ✅ **第 2 块已完成（2026-10-01）—— 平台管理员身份模型 + `/platform` 租户目录与开通表单**：
  新建 `PlatformAdmin` 表（**不隶属任何组织**，也不进 `role-modules.ts` 的角色矩阵 ——
  那张表管的是"在一家店里能做什么模块"，与"能不能跨店管理"是两条正交的轴）；
  守卫 `src/lib/platform/guard.ts` 只认 `PlatformAdmin.authId`，未登录去登录、非管理员 `notFound()`
  （不确认路由存在），**每个 action 自己再判一次**；`/platform` 列租户（以 slug 为键）、
  `/platform/new` 开店表单（`useActionState`，临时密码一次性显示、不进 URL）；
  `scripts/grant-platform-admin.ts` 是"第一个管理员"的唯一来源（按邮箱授予**只找不建**）。
  详见 `docs/changes/2026-10-01-p4-platform-console.md`。
- 🟡 **第 3 块进行中（2026-10-01）**：
  ✅ **停用/恢复 + 平台侧审计**：`PlatformAuditLog`（跨租户、只增不改，退租后仍留痕）；
  `setTenantStatus`（状态没变不写审计）；**停用对已登录的人立刻生效** —— 强制点在
  `identitiesForAuthUser` 过滤非运营租户（只挡入口是不够的）；`/platform/<slug>` 详情页
  （状态/用量/门店链接/审计轨迹 + 停用恢复表单）。详见 `docs/changes/2026-10-01-p4-tenant-status.md`。
  ✅ **限时支持访问（双向留痕）**：`SupportGrant`（限时 5–480 分钟、**必填原因**、**按人授权**、
  可撤销、服务端判过期）；平台侧 `PlatformAuditLog` + **租户自己的 `AuditLog`** 两侧都写
  （租户在 `/workshop/settings/audit-logs` 就能看到平台何时来过）；
  `/platform/<slug>/support` 只展示**白名单式只读快照**（该目录里没有任何 server action）。
  详见 `docs/changes/2026-10-01-p4-support-access.md`。
  ✅ **退租删除**：删除计划由 `scripts/gen-tenant-purge-plan.ts` 从
  **scope map × Prisma DMMF** 推导（81 项、先子后父、Organisation 最后；生成器自检拓扑序），
  `purgeTenant` 三道闸门（先停用 → 原样输入 slug → 删除与复核同事务、残留即回滚），
  删完留 **`TenantTombstone`**（slug 永久占用，旧门店码不会指向新店）。
  详见 `docs/changes/2026-10-01-p4-tenant-purge.md`。
  ✅ **开通模板库**：`TenantTemplate`（从某家店导出的自定义模板）+ 代码里的内置模板
  （`standard` / `dealer-only`），解析顺序**自定义 → 内置**、列表顺序与之一致；
  负载用 zod 校验（模板是不可信输入），**找不到模板则拒绝开通**而不是静默退回默认；
  导出只搬配置不搬业务数据。详见 `docs/changes/2026-10-01-p4-template-library.md`。
  ✅ **按租户导出**：`GET /platform/<slug>/export` 下载该店数据副本（文件名带 slug）；
  行范围**复用退租那份计划**（两处各写一份必然漂移，而导出少了行不会报错）；
  **密钥类字段脱敏**（`REDACTED_FIELDS` + 扫 schema 的结构守卫）；双向留痕。
  详见 `docs/changes/2026-10-01-p4-tenant-export.md`。
- ✅ **P4 四块全部完成**（开通 / 平台台与管理员 / 租户生命周期 / 模板与导出）。
- 租户目录（**以 slug 为键**）、用量、停用/恢复、限时支持访问（双向留痕）、按租户导出、退租删除、模板库。
- 运维产物命名统一：备份/导出/账单/日志一律带 slug。

### P5 · 产品层去 branch（3–5 天）

- 🟡 **进行中（2026-10-01）**：
  ✅ **侧边栏品牌区显示店名**（原来是「分行 · 城市」；prop `branchLabel` → `brandLabel`）。
  ✅ **分行管理 UI 已经不存在**（`workshop/settings/` 只剩 audit-logs / developer / page）——
  施工单里这条已完成；`branch-info.ts` 现在只被 `seed-core.ts` 用（不再影响运行时）。
  ⏳ **剩下的大件**：`branch-scope.ts` 的隔离职责退役（`scopedBranchId`/`applyBranchScope`/
  `isOrgLevelRole` 仍有 **90 处**调用，且参与数据分区 —— 单独一片，先摸清每处语义）；
  `?branch=` 残留 3 处。详见 `docs/changes/2026-10-01-p5-sidebar-brand-and-e2e-fix.md`。

- 移除分行管理 UI、`?branch=` 过滤、分行切换、`MyBranchSettings`；`branchId` 降级为隐藏外键。
- **`branch-scope.ts` 的隔离职责整体退役**——`scopedBranchId()` / `applyBranchScope()` 不再参与数据分区，只保留 `canManageOrgSettings()` 这类**功能开关**语义（那是另一条轴，见 `src/lib/branch-scope.ts:22-40` 的原有说明）。
- `branch-info.ts` 的硬编码主店身份（`MAIN_BRANCH_NAME/ADDRESS/COORDS`）改为从租户数据读取。
- 侧边栏品牌区显示**店名**而非"分行 · 城市"。

### 4.6 "隔离"的验收标准（这是最容易被跳过、也最该先建的部分）

1. **动态测试**：双租户夹具（同手机号 / 同车牌 / 同 SKU / 同邮箱），逐服务断言零穿透。必须带**对照组**。
2. **静态测试**：禁止裸 `db` import、禁止 `organisation.findFirst`、禁止 allowlist 外的 `$queryRaw`。
3. **渗透脚本**：遍历 83 张表，断言 anon = 0 行、租户 B 看不到租户 A 的行（含 RLS 路径与 Prisma 路径两条）。
4. **Playwright 双租户 e2e**：一个库里两家店，各自登录走一遍闭环，断言互不可见。
5. **CI 门槛**：以上任一失败即阻断合并。

---

## 5. 如何管理（运营视角）

### 5.1 日常运营模型

```
平台方（你）
 ├── /platform  租户目录 · 开通 · 停用 · 支持访问 · 计费 · 模板库
 └── 一套数据库 · 一套迁移 · 一套备份
        │
        ├── 租户 A（Organisation）── /workshop 自己的员工、客户、库存、财务
        ├── 租户 B
        └── 租户 C …
```

- **租户主（dealer owner）**：在 `/workshop` 内管自己的店，权限仍由 `role-modules.ts` 矩阵决定（OWNER/MANAGER 是全模块，数据限本租户）。
- **平台方（你）**：只在 `/platform` 操作；**不通过 impersonation 就看不到租户业务数据**，且每次进入都留痕。
- **`HEAD_OFFICE_ADMIN` / `AUDITOR` 这类"org 级"角色的含义变了**：它们从"能看多个 branch"变成"本租户内的管理/审计角色"。`isOrgLevelRole` 里"看得见几家店"的语义要重写为"本租户内的管理级别"。

### 5.2 开通一家新店（目标：30 分钟内，不写代码）

1. 平台台填公司资料 + **slug** + owner 邮箱 → `provisionTenant()`（slug 从店名生成并检测冲突，**创建后不可改**）。
2. 系统建好：租户 + 唯一门店 + owner 账号 + 默认服务目录/检查模板/消息模板/预约时段/佣金规则。
3. 产出：门店二维码、**开通链接 `/t/<slug>`**、员工邀请链接。
4. owner 用现成的 `Bulk setup`（`/workshop/setup` + `src/modules/bulk/**`）导入员工/服务/套餐/产品/供应商/客户/车辆/库存。
5. 冒烟（三端）→ 交付。

`docs/WORKSHOP_SETUP_KIT.md` 与 `docs/ONBOARDING_PLAN.md` 里的"第 3 类：我们配置"那些手工步骤，正是 `provisionTenant()` 要固化下来的内容。

### 5.3 规模化的四个关键决定

| 决定 | 建议 |
|---|---|
| **共享还是独立库** | 共享（§2.1）。50–500 店下 DB-per-tenant 的运维成本会吃掉全部利润 |
| **配置是"每店一份"还是"模板+覆盖"** | 模板+覆盖。行业默认配置集中在平台侧，租户只存差异。否则每开一家店都要重新配一遍 |
| **支持访问的边界** | 默认不可见；需要时显式、限时、双向留痕。写进服务条款 |
| **谁是"平台管理员"** | 独立角色，不隶属任何组织；至少两人（避免单点）。所有平台写操作进平台审计 |

### 5.4 合规与生命周期（马来西亚 PDPA 2010）

| 场景 | 要做的事 |
|---|---|
| **数据主体查阅请求** | 按租户 + 按客户导出（复用 `/api/export`，但要先修好它的 `findFirst`） |
| **退租 / 终止** | 导出 → 冷静期（如 30 天）→ 硬删（业务行 + Supabase auth 用户 + 对象存储对象）。**前提是 Layer 0 的级联删除已就位**（今天只有 2 处 `onDelete`） |
| **备份** | 整库备份（`docs/backups/` 已有先例）+ **按租户逻辑导出**（整库备份无法只恢复一家店） |
| **跨境传输** | Supabase 区域为默认 us-east-1（`.env` 注释）；生产 Vercel 在 `sin1`。数据库不在马来西亚境内，若客户在意需评估或迁移区域 |
| **留存期** | 考勤照片/GPS（`AttendancePunch`）是个人数据，`Organisation` 已有照片策略开关，应同时定义留存期 |
| **审计** | `AuditLog` 已按 `organisationId` 隔离；平台侧操作要另有一份平台审计 |

### 5.5 升级与迁移（选共享库最大的红利，但有前提）

- **加列可以自动上生产**：`vercel.json` 的 build 会跑 `scripts/sync-prod-schema.mjs`，它对生产做**加法 DDL**（`prisma db push`，不带 `--accept-data-loss`，遇 `DROP/TRUNCATE` 直接失败退出等人处理）。
- **回填数据不能自动**：生产**没有迁移历史**（56 个迁移全是 SQLite 方言，无法在 PG 重放）。任何"给存量行补 `organisationId`"都要**另写幂等回填脚本**，并且按三步走：
  1. **加列**（可空）→ 自动上生产，旧代码照常跑；
  2. **回填**（幂等脚本 + 校验断言，任何 NULL 即失败）；
  3. **收紧**（改非空 / 加复合唯一键 / 加外键）——**这一步是破坏性的，同步脚本会拒绝，必须人工执行并提前备份**。
- **两个 schema 文件必须同改**：`schema.prisma`（SQLite，本地）与 `schema.pg.prisma`（PG，生产）。没有生成器，靠人。
- **备份先行**：多租户改造前必须建立"整库备份 + 按租户导出"两级能力。今天只有一个手写 dump，没有脚本、没有定时。
- **发布顺序**：因为加列向后兼容，推荐"**先发 schema，再发代码**"，任何一期都可独立回滚。

### 5.6 监控与告警（防"悄悄串数据"）

- **跨租户泄漏 canary**：定时任务用租户 B 的凭据探租户 A 的数据，非 0 即告警。**串数据是本项目最难发现的 bug 类**（`tests/automation-multi-org.test.ts:1` 原话）。
- **`organisationId IS NULL` 巡检**：新代码漏填会在这个查询里现形。
- **`TENANT_SCOPE_VIOLATION` 计数**：守卫抛错即上报 Sentry。
- **每租户用量**：工单量/消息量/存储/API 调用——既用于计费，也用于容量模型校准。

---

## 6. 风险与取舍

| 风险 | 说明 | 缓解 |
|---|---|---|
| **守卫误伤**（把合法的跨租户系统查询也拦了） | cron/seed/平台台需要跨租户 | `systemDb(reason)` 显式旁路 + 审计；先在这几条路径上逐个人工确认 |
| **`findUnique` → `findFirst` 改写改变语义** | 返回类型一致（可能 null），但 `findUnique` 的唯一性保证消失 | 租户内 `id` 仍唯一，语义等价；单测覆盖 |
| **双引擎漂移**（SQLite 本地 / PG 生产） | 本项目已出过 4 次事故 | 每个 schema 改动都跑 `schema.prisma` + `schema.pg.prisma`，并用 `sync-prod-schema.mjs --check` 验漂移 |
| **加列后查询变慢** | 缺索引会全表扫，与容量模型冲突 | 加列必须同时加 `@@index([organisationId, ...])`，并用 `perf.db` 复测 |
| **身份改造影响现有 4 个真实客户** | 生产客户极少，风险窗口最好 | 放在 P3，回填脚本 + 双写期 + 登录回归测试 |
| **平台管理员成为超级后门** | 一人可看所有租户 | 独立角色 + 双人 + 限时 + 双向审计 |
| **`SUPER_ADMIN` 语义混淆** | 它今天在 `isOrgLevelRole` 里 | 明确：`PLATFORM_ADMIN` 新角色；`SUPER_ADMIN` 保持租户内语义（生产当前无人使用，可择机废弃/改名） |

---

## 7. 工作量与里程碑

| 期 | 内容 | 估算 | 可否独立上线 |
|---|---|---|---|
| P0 | 安全止血 | 1–2 天 | ✅ 可独立，建议立即 |
| P1 | Schema 补全 + 回填 | 5–8 天 | ✅ 向后兼容 |
| P2 | 强制层 + 消灭 findFirst | 8–12 天 | ✅ 核心 |
| P3 | 身份（AuthLink + 租户登录） | 8–12 天 | ⚠️ 需 P1 |
| P4 | 平台管理台 | 10–15 天 | ⚠️ 需 P1+P2 |
| P5 | 产品层去 branch | 3–5 天 | ⚠️ 需 P2 |
| — | **合计** | **≈ 6–9 周** | 第 2 家店上线前，**P0+P1+P2 必须完成**（≈ 3 周） |

**最小可用里程碑**：P0 + P1 + P2 完成 = 可以安全地开第二家店（数据隔离成立）。
P3 完成 = 同一个人可以在两家店各有一个身份（"customer 不共用"在产品上成立）。
P4 完成 = 你能批量管理租户，而不是靠改脚本。

---

## 8. 已拍板的决定（2026-09-30）

| # | 决定 | 状态 |
|---|---|---|
| **1** | **隔离粒度 = 共享数据库 + 共享 schema + `organisationId` 行级隔离 + 数据访问层强制 + RLS 兜底**（§2.1 方案 C） | ✅ **已定** |
| **2** | **`Branch` 保留表、降级为隐藏的 1:1 门店记录，移除全部 branch UI**（§2.2） | ✅ **已定** |
| **3** | **身份与租户解析按"管理最优"定**：`AuthLink` 多对多映射 + `Organisation.slug` 作为运营句柄 + 四级解析链 + **暂不做子域名**（§2.3） | ✅ **已定** |

这三项决定连带改变以下工作面，实施时按此执行：

| 受影响项 | 因决定而变成 | 影响期 |
|---|---|---|
| `Organisation` 新增 `slug`（唯一、**不可变**） | 平台台路由、备份/导出命名、日志、计费、支持链接全部以 slug 为键 | P1（建列）、P4（全量使用） |
| `Branch` 不再是数据分区轴 | **所有查询统一按 `organisationId` 收窄**；`scopedBranchId()`/`applyBranchScope()` 的隔离职责整体退役（`src/lib/branch-scope.ts:43-46` 那类"org 级角色不过滤"的漏洞随之消失） | P2、P5 |
| 登录入口改为 `/t/<slug>/login` | `/login`、`/rider/login` 保留为"无租户入口"，命中多店时转选择器 | P3 |
| `dz_tenant` 签名 cookie 取代 `dz_org`/`dz_branch` | `src/actions/rider-context.ts` 从死代码改为**写库 + 写签名 cookie** | P3 |
| 子域名解析位预留（解析链第 0 级，现留空） | 将来启用只改 DNS + `resolve.ts` 两行，业务代码零改动 | P3 预留 / 后续启用 |

### 8.1 这三项决定**没有**改变的事（避免误读）

- **P0 安全止血照做，优先级不变**——匿名可读的数据裸露与 `resetBusinessData()` 全表删除，与租户模型选型无关。
- **"现在做成本≈0"的窗口不变**——生产仍是 1 个 Organisation / 2 Branch / 20 User / 4 Customer / 35 ServiceJob。
- **工作量估算不变**——三项决定都落在本文已列的范围内，没有新增范围；唯一的减项是"暂不做子域名"省下的 DNS / 回调白名单 / 本地开发代理成本，加项是 slug 运营句柄（P1 一列，P4 若干路由与命名）。

### 8.2 下一步（待你确认后开工）

建议按 **P0 → P1 → P2** 顺序推进（≈3 周），P3 起再做身份与平台台。
P0 的 10 项彼此独立、可逐条验收，适合先做一轮止血并把回归测试立起来。
若同意，我会把 P0 拆成 `docs/changes/` 下的变更记录，**每一条配一个失败测试 → 修复 → 全量基线验证**（`tsc --noEmit` / `pnpm test` / `pnpm build` / Playwright），逐条提交。

---

## 附录 A · 隔离验收测试清单（可直接当 P2/P3 的 DoD）

**A. 动态测试（`tests/tenant-isolation.test.ts`）**
- [ ] 建租户 A、B；A 有客户 phone=`012-345 6789`、车牌 `WXY1234`、SKU `OIL-4T`；B 用**完全相同**的值
- [ ] 客户列表/搜索/详情：A 的会话看不到 B 的任何行（带对照组：全表确有 2 条）
- [ ] `findUnique({ where: { id: B.id } })` 在 A 的上下文返回 null
- [ ] `update`/`delete` B 的行 → 抛 `TENANT_SCOPE_VIOLATION`
- [ ] 工单号/发票号/线索号：A、B 各自从 DZ1000 / 各自年份 1 开始，互不干扰
- [ ] 消息模板、检查模板、预约时段、自动化规则：A 的改动不影响 B

**B. 静态测试**
- [ ] `src/app/**`、`src/actions/**` 无 `import { db } from "@/lib/db"`
- [ ] 全项目无 `organisation.findFirst(`
- [ ] `$queryRaw`/`$executeRaw` 只在 allowlist 内

**C. 渗透脚本（`scripts/check-tenant-isolation.ts`）**
- [ ] 83 张表：anon key 全部 0 行
- [ ] 租户 B 的 JWT：对 A 的每张表 0 行
- [ ] 报告输出到 `~/Documents/dz-automation/reports/`，可挂进现有 test-runner

**D. Playwright 双租户 e2e**
- [ ] 一个库里两家店，各自登录走"客户→工单→报价→完成→发票"，断言互不可见
- [ ] 跨店骑手：两家店各一个档案，切换后看到各自的历史

---

## 附录 B · 证据索引（可直接跳转核对）

| 主题 | 位置 |
|---|---|
| 租户模型 | `prisma/schema.prisma:35`（Organisation）、`:247`（Branch）、`:283`（User）、`:447`（Customer） |
| 无 `organisationId` 的模型 | `ServiceJob:614`、`Invoice:992`、`Booking:550`、`Motorcycle:499`、`StaffPayout:418`、`Campaign:1180`、`Notification:1123`、`MarketingAsset:1200`、`AppointmentSlot:1433` |
| 全局唯一键 | `User.email:291`、`User.authId:295`、`Customer.authId:457`、`Motorcycle.plate:507`、`Product.sku:878`、`PromoProduct.sku:195`、`ServiceJob.jobNumber:616`、`Invoice.invoiceNumber:1000`、`Lead.leadNumber:1347`、`LoyaltyAccount.membershipId:1568`、`InvoiceCounter:1857` |
| 裸 PrismaClient（无守卫） | `src/lib/db.ts:8-16` |
| 租户解析的唯一入口 | `src/lib/session-user.ts:35-51`、`src/lib/rider-customer.ts:11-18` |
| 正确的收窄范本 | `src/modules/documents/service.ts:137-150`、`src/actions/bulk.ts:77,136` |
| 分行作用域的漏洞 | `src/lib/branch-scope.ts:43-46` |
| RLS 策略 | `docs/rls-policies.sql`、`scripts/gen-rls-policies.ts` |
| 全局编号分配器 | `src/repositories/prisma/jobs.repository.ts:81-86`、`src/services/completion.ts:32,56-64`、`src/modules/leads/service.ts:38-43` |
| 手机号全局匹配 | `src/lib/auth/phone-identity.ts:27-35`、`src/actions/auth-supabase.ts:60-63` |
| 注册落到第一家店 | `src/actions/auth-supabase.ts:204,440` |
| claim 由用户自写 | `src/actions/auth-supabase.ts:35,48` |
| 无效的 QR 绑定 | `src/actions/rider-context.ts:10-18` |
| 多租户测试的现成范式 | `tests/automation-multi-org.test.ts` |
| 开通脚本素材 | `scripts/provision-demo-branch.ts`、`src/lib/seed-core.ts:146-153` |
| 上线资料与流程 | `docs/WORKSHOP_SETUP_KIT.md`、`docs/ONBOARDING_PLAN.md` |
| 容量模型（要与本方案对齐） | `docs/CAPACITY_AND_UPGRADE_PLAN.md` |
| 生产 schema 漂移守卫 | `scripts/sync-prod-schema.mjs` |
| **全租户清空按钮（最危险）** | `src/actions/developer.ts:140-152`（`deleteMany({})` × 40 表）、UI 入口 `src/app/workshop/settings/developer/page.tsx:37` |
| 跨租户导出 | `src/app/api/export/route.ts:11`、`src/app/api/attendance/export/route.ts:34` |
| RLS 生成器的三处根因 | `scripts/gen-rls-policies.ts:47`（JOIN 无谓词）、`:54`（WHERE 不比 org）、`:41`（`return "true"`）、`:10`（读 DMMF 不是 schema）、`:19-35`（BFS 选错父表） |
| 生产连接方式与 RLS 旁路 | `docs/DEPLOYMENT_CHECKLIST.md:51,61,94` |
| 项目自己写下的缺失控制清单 | `docs/CAPACITY_AND_UPGRADE_PLAN.md:180-182,307,321` |
| 无同租户外键约束 | 全 schema 仅 2 处 `onDelete`；无任何复合外键校验 |

---

*本文档为方案，未执行任何改动。评审通过后建议拆成 `docs/changes/` 下的分期变更记录，逐期落地。*
