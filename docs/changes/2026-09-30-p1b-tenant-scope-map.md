---
date: 2026-09-30
title: P1b 租户作用域地图 + 发票计数器按租户 + 收口 checklists
branch: docs/perf-load-results
---

## 改动

P1a 解决的是"第二家店第一天就会撞"的唯一键冲突。P1b 解决的是**"每一行怎么到达它的租户"
这件事没有唯一定义** —— 这是 P2 强制层（`scopedDb`）能不能写出来的前提。

### 1. ⚠️ 对原方案的一处偏离（需要 owner 知道）

原方案写的是"给 47 个模型都补 `organisationId`（冗余一列），让守卫和 RLS 都简单"。
**本轮没有那样做**，改为**关系路径 + 作用域地图**。理由是三条实测事实：

1. **嵌套写入不会触发钩子**。`job.create({ data: { items: { create: [...] } } })` 里的子行
   不会各自触发 Prisma 扩展的 create 钩子 —— 那些冗余列大概率长期是 NULL。
2. **NULL 行逃出唯一约束**：复合唯一键在 SQLite/PostgreSQL 上都不约束 `organisationId` 为 NULL 的行。
   于是一列"没人写、也没人查"的列，会让代码**看起来已经有了租户隔离**，实际什么都没拦。
3. **关系路径是精确的**，而且不需要任何人记得去写；代价只是一次 join。

所以规则改成：**有路径就用路径；没有路径才补关系或补列**。P1b 给三张表补的正是**缺失的关系**
（不是在加字段）。若将来 P2 的压测显示某条链成为瓶颈，再按索引需要**定点**冗余，
而不是一次性铺 42 列。

### 2. 租户作用域地图（本轮核心交付物）

- `src/lib/tenant/scope-map.ts`（新）：83 个模型 → **怎么到达租户**的唯一定义。
  四种条目：`column`（自带 organisationId）/ `relation`（逐跳路径，**手工核对**）/
  `shared`（平台共享参考数据）/ `none`（有意不属任何租户，必须写理由）。
- `tenantWhere(model, orgId)`：生成 Prisma `where` 片段；未登记的模型**抛错**（fail-closed）。
- `tests/tenant-scope-map.test.ts`（新，12 条）：① **完整性** —— schema 里每个模型都必须登记，
  新增模型忘登记就红；② **路径对账** —— 逐跳字段必须真实存在、终点必须真的有 organisationId；
  ③ `column` 条目属实；④ `tenantWhere` 形状；⑤ 防止地图被清空后测试空跑。
- 路径**刻意手写而非 BFS 自动推导**：自动推导会选错父表 —— `ServiceJobPart` 既能经 `job`
  也能经 `product` 到达租户，选 product 就把"这行属于哪家店"变成"这个零件属于哪家店"。
  自动化只用来**验证**，不用来生成。

### 3. 补上三处缺失的关系（原本根本无法按租户收窄）

`ServicePackage`、`Attendance`、`AttendanceCorrection` 此前只有**裸标量外键**
（`branchId` / `punchId`）而没有声明关系 —— 不是"少个字段"，是"没有可达路径"。
迁移 `20260930180000_p1b_tenant_relations` 补上关系，并删掉 `InvoiceCounter_organisationId_idx`
（主键已是 `[organisationId, year]`，org 前缀查询已被主键索引覆盖，此索引纯冗余）。

### 4. 发票计数器改为「按租户 + 年份」（消除 P1a 留下的回滚风险）

P1a 刻意让发票取号保持全局，因为**只收窄一半会引入故障**：计数器行不存在时种子取自 A 店的最大号，
而 B 店当年已有更大的号 → 序列被建到 B 的 max 之下 → B 取号撞自己已有号 → P2002 → 完工事务回滚。

本轮把两件事**一起**做了：
- `InvoiceCounter` 主键 `year` → `@@id([organisationId, year])`（迁移 `20260930160000`，先清空该表 ——
  它是纯派生数据，唯一读法是"有行就用、没有就从该租户当年最大号重新起步"，删行不丢业务事实）；
- `nextInvoiceNumber(tx, year, organisationId)` 的**计数器查找与"回看最大号"扫描同时**按租户收窄。

`tests/invoice-number.test.ts` 从 4 条扩到 **7 条**，新增的正是这次改动的验收点：
B 店从**自己**的最大号起步（带对照组：A 店当年已发很多号、B 店一张都没有）、两家各自独立递增、
计数器按 (租户, 年份) 落行。

### 5. `checklists.ts` 真修（P0 时故意留着的 7 处）

P0 时这些地方**无法真修**（`ChecklistTemplate` 既无 organisationId、`branchId` 又是从没人写过的裸标量），
当时选择"留说明、不做一个看起来修好了的恒假过滤"。现在有列了，7 处全部收窄：

- `updateMany({ data: { isDefault:false } })` **无 where** → 只清**本组织**的默认模板；
- `update/delete({ where: { id } })` → 先判归属，跨租户一律 `not_found`；
- "最后一个模板不许删"的 count 从**全库**改成**本组织**（否则别家模板多会变成你删不掉自己最后一份的理由）；
- `ChecklistItem` 经 `template` 关系收窄（它自己没有租户列，链只有一跳，精确且不需要冗余列）。

### 6. 四个模型的 `organisationId` 收紧为 NOT NULL

迁移 `20260930200000`。回填完成后才能做这一步；做完之后，"漏写租户列的行"**连插都插不进去** ——
静态守卫之外多一道数据库防线。生产上同时把外键从 `SET NULL` 重建为 `ON DELETE RESTRICT`
（必需关系不能置空）。

## 影响 / 生产实测

| 项 | 结果 |
| --- | --- |
| 生产行数（前后） | org 1 / moto 7 / job 35 / inv 22 / cust 4 / usr 20 —— **完全一致** |
| `InvoiceCounter` 主键 | `[organisationId, year]`（复合） |
| 新外键 | `ServicePackage.branchId`、`Attendance.branchId`、`AttendanceCorrection.punchId`、`InvoiceCounter.organisationId` 全部到位 |
| 四列 NOT NULL + RESTRICT | 全部到位 |
| **schema 漂移检查** | `schema and database agree`（下次部署不会被拦） |
| 生产应用 | `/`、`/login`、`/catalogue` 均 HTTP 200 |

基线：`tsc --noEmit` 0 错误 / `pnpm test` **913 通过（80 文件）** / `pnpm build` 通过 / Playwright 55 通过。

## 交接说明

- **一个值得记住的连带效应**：给 `InvoiceCounter` 加了 `ON DELETE RESTRICT` 外键后，
  两个跑完工流程的测试在 `afterAll` 删组织时被数据库**正确地拦住了**（它们没清计数器行）。
  这不是"约束太严"，而是 RESTRICT 在按设计工作 —— 修的是清理代码，不是放开约束。
  **生产同理**：删租户前必须先清数据，那正是 P4 退租流程要按顺序做的事。
- **P2 现在具备前提**：`scopedDb` 可以直接消费 `TENANT_SCOPE` / `tenantWhere()`
  —— 每张表怎么收窄已有唯一定义，且有 12 条对账测试守着它不漂移。
- **仍未做（P2/P3/P4/P5）**：强制层本身、`organisation.findFirst()` 的存量清理（棘轮当前 78 处）、
  RLS 生成器重写（36 条同义反复 / 22 张表缺策略）、身份 `AuthLink`、平台管理台。
- 回滚：本轮全是加法（加关系、加主键维度、收紧约束）；若要回退唯一键见 P1a 的说明。
