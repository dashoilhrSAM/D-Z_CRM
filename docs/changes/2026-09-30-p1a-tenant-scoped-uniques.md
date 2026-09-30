---
date: 2026-09-30
title: P1a 租户内唯一键 + 租户列（多租户隔离第 1 期）
branch: docs/perf-load-results
---

## 改动

解决"第二家 dealer 上线第一天就会撞"的四类全局唯一冲突。**只做加法 + 换唯一键，不改非空** ——
收紧留到 P1b（生产 schema 走 `prisma db push`，改非空需要人工介入）。

### 1. schema（`prisma/schema.prisma` + `prisma/schema.pg.prisma` 双改）

- **8 个全局唯一键 → 租户内复合唯一键**：
  `Motorcycle[organisationId, plate]`、`ServiceJob[organisationId, jobNumber]`、
  `Invoice[organisationId, invoiceNumber]`、`Product[organisationId, sku]`、
  `PromoProduct[organisationId, sku]`、`Lead[organisationId, leadNumber]`、
  `LoyaltyAccount[organisationId, membershipId]`、`User[organisationId, email]`。
- **4 个模型补可空 `organisationId`**（+ 关系 + 索引）：`Motorcycle`、`ServiceJob`、`Invoice`、`ChecklistTemplate`。
- **`Organisation` 加运营字段**：`slug`（唯一，运营句柄）、`status`、`plan`、`trialEndsAt`。

**为什么旧键必须删掉、不能与新键并存**：全局唯一**严格强于**租户内唯一，留着它第二家店
依然录不进同一个车牌 —— 那正是本轮要解决的问题。反过来，删它不可能与数据冲突
（任何满足全局唯一的行集必然满足租户内唯一），所以这次 DDL 是**数据安全**的。

### 2. 迁移

- `prisma/migrations/20260930120000_p1a_tenant_scoped_uniques/`（新）
- `prisma/migrations/20260930140000_checklist_template_org_index/`（新，见下）
- **修好了一个"新库建不起来"的既有缺陷**：`20260923120000_service_job_item_catalogue_link`
  与 `20260923072852_invoice_counter` 重复加列（后者已用 RedefineTables 建过那三列与三个索引）。
  两种库里执行顺序相反，所以在已迁移的库上看不出来，但 **`pnpm db:reset` / CI / e2e 从零跑全部卡死**。
  SQLite 没有 `ADD COLUMN IF NOT EXISTS`，故把前者的重复语句去掉、留成有说明的空操作。

### 3. 写入方必须带 `organisationId`（**这是本轮最容易静默失效的地方**）

复合唯一键在 SQLite 与 PostgreSQL 上**都不约束 `organisationId` 为 NULL 的行**（NULL 互不相等）。
所以任何一条漏写这一列的写入路径，那一行就完全逃出唯一性约束 —— 约束"加上了"却不生效，
**没有任何运行时症状**（同店两张同号发票照样能存进去）。

- 8 个生产 create 点全部补上租户值：`rider.ts`（车主）、`bulk/apply.ts`（入参组织）、
  `bookings/service.ts`（booking.customer）、`service-jobs/service.ts`（**分行**，分行不存在即抛错）、
  `completion.ts`（job.customer —— 刻意不用 `job.organisationId`，历史工单那一列是 NULL）、
  `checklists.ts`（会话组织）、`seed-core.ts`（seed 自己建的 org）。
- `finance.repository.createInvoice` 的入参改成 `InvoiceUncheckedCreateInput & { organisationId: string }`
  —— **类型上必需**，而不是靠注释提醒（这两个方法是死代码，将来谁接上，类型先拦住他）。
- **新增静态守卫**（`tests/tenant-isolation-guards.test.ts`）：扫描 `src/` 下每个
  `motorcycle|serviceJob|invoice|checklistTemplate|organisation.create`，附近没有
  对应租户值就失败。并在带说明的 12 行窗口内检查，避免跨行写法漏判。
  （这条守卫在开发过程中真实抓到了 9 处遗漏，包括 seed 建组织没写 slug。）

### 4. 取号器

- `nextJobNumber(organisationId)`、`nextLeadNumber(organisationId)` 按租户收窄 ——
  它们直接扫自身最大值（没有独立计数器表），每家店"自己的 max+1"在店内唯一、跨店重复正是要允许的。
- **顺带发现第 4 个取号器**：`bookings/service.ts` 的 checkIn 里内联复制了一份工单号分配（同样全表扫描），
  已用同一组织收窄；建议后续让它改调 `repo.nextJobNumber`，把号段格式收到一处。

### 5. ⚠️ 发票取号：**刻意保持全局**（这是一个"看着该改、其实不该改"的地方）

`InvoiceCounter` 本轮**没有**加租户列，仍是 `year Int @id`。因此
`nextInvoiceNumber` / `maxIssuedInvoiceNumber` 与计数器**全部保持全局**，签名与行为原样。

如果只把"回看最大号"按组织收窄（看起来更隔离），会引入一个新故障：
某年计数器行不存在时（新表、被清过、发票是导入进来的），种子会取自 A 店的最大号，
而 B 店当年已有更大的号 → 全局序列被建到 B 的 max 之下 → B 随后取到的号撞**自己已有**的号
→ 复合唯一 P2002 → **整个完工事务回滚**。这正是 2026-09-23 修过的那个 bug 的形态。
全库回看则恒为安全（全局最大号 ≥ 任何一家店的最大号）。

**要做"按店分系列"必须两件事一起做（P1b）**：给 `InvoiceCounter` 加 `organisationId` 并把主键改成
`@@id([organisationId, year])`，然后计数器与回看扫描**同时**按组织收窄。只做一半就是上面那个回滚 bug。

### 6. 生产执行（分三步，每步单独验证）

`scripts/apply-p1a-production.mjs`（新，幂等，默认只报告）。**必须手工执行**：
`vercel.json` 构建里的 `sync-prod-schema.mjs` 遇到 DROP 会 `exit 1`（2026-09-15 事故后刻意收紧的保护），
而换唯一键必然包含 DROP INDEX —— **不先执行它，下一次 push main 会构建失败**。

```
--phase=columns   # ① 加列（纯加法）
--phase=backfill  # ② 回填（原生 SQL；本机 Prisma client 是 SQLite 的，连不了 PG）
--phase=uniques   # ③ 换唯一键（**先建后删**，中途两键并存只是更严格）
```

## 影响 / 生产实测

| 项 | 结果 |
| --- | --- |
| 生产行数（改动前后） | org 1 / moto 7 / job 35 / inv 22 / cust 4 / usr 20 —— **完全一致，无数据丢失** |
| 回填残留 NULL | `{moto:0, job:0, inv:0, tpl:0, slug:0}` |
| 唯一键 | 8 个全部「复合键=1 旧全局键=0」 |
| `Organisation` | `slug = d-z-smart-workshop`、`status = ACTIVE`、`plan = STANDARD` |
| **schema 漂移检查** | `sync-prod-schema.mjs --check` → **schema and database agree**（下次部署不会被拦） |
| 生产应用 | `/`、`/login`、`/catalogue` 均 HTTP 200 |

基线：`tsc --noEmit` 0 错误 / `pnpm test` 898 通过（79 文件）/ `pnpm build` 通过 / Playwright 见下。

## 交接说明

- **P1b 必做**：① 把 4 个模型的 `organisationId` 收紧为 NOT NULL（生产需人工，`db push` 不接受非空无默认）；
  ② 其余 ~40 个模型的 `organisationId`（`StaffPayout`、`MarketingAsset`、`AppointmentSlot`、`Campaign`、
  `Notification`、`Review` 这些在 P2 强制层里必须有列，否则只能在原地绕关系）；
  ③ `InvoiceCounter` 加 `organisationId` + 复合主键，**同时**收窄计数器与回看扫描（见上）；
  ④ `checklists.ts` 里 7 处仍按裸 id 改 `ChecklistTemplate`（现在有列了，可以真修了）。
- **回填脚本**：`scripts/backfill-tenant-columns.ts`（幂等，本地用）。生产的对应逻辑在
  `apply-p1a-production.mjs --phase=backfill`（原生 SQL）。检查清单模板没有关系路径可推导，
  多租户时必须显式 `--checklist-org=<id>`。
- **回滚**：唯一键是"先建后删"，回滚只需删复合键、把全局键建回来；新加的列与数据保留（加法，不影响旧代码）。
- **dev.db 备份**：`/tmp/dev.db.bak-p1a`（应用迁移前拍的）。
