---
date: 2026-09-30
title: P3b 第 2+4 步 —— authId 降为租户内唯一 + 多店选择器（+ 生产人工 DDL 脚本）
branch: feat/tenancy-tenant-scoped-authid
---

## 改动

**施工单第 2 步（松唯一键）与第 4 步（入口与选择器）**。第 3 步的解析链已经为它们留好位置，
编译器护栏在第 3 步刻意保留了那两处 `{ authId }` where —— 这次一改 schema，**它们立刻编译失败**
（PR 描述里有原始报错），照着报错换掉即可，没有"忘了改哪"的可能。

1. **双 schema**：`User.authId` / `Customer.authId` 去掉全局 `@unique`，改为
   `@@unique([organisationId, authId])`；`Customer` 加 `@@index([organisationId, phone])`。
   两个 schema 一起改（本项目最常踩的坑，测试里有守卫钉住）。
2. **迁移**：`prisma/migrations/20260930234000_p3b_tenant_scoped_authid/migration.sql`
   （SQLite 上就是 2 个 DROP INDEX + 3 个 CREATE INDEX，**不是**整表重建）。
   ⚠️ `prisma migrate dev` 因为两个历史迁移文件被改过而要求 reset dev.db —— **没有照做**，
   改用 `prisma migrate diff` 生成等价 SQL 后 `migrate deploy` 应用（数据零损失）。
   dev.db 与 e2e.db 都已应用，client 已在有 `.env` 时重新生成。
3. **解析链第 ③/④ 级**：不再用 `findUnique({ where: { authId } })`（键已松，用不了也不会用），
   改为按 AuthLink 的候选数决定 —— **0 条 = 没有身份、1 条 = 唯一所属、≥2 条 = 送选择器**。
   `RequestPersonRef` 新增 `choice` / `none` 两个分支，`loadStaffForRef` / `loadCustomerForRef`
   在 `choice` 时**必须给 null**（静默挑一条就是串店）。
4. **`preparePhoneIdentity` 加租户参数（必需）**：它问的是"这个号码的持有账号在本店是否已挂在
   另一条客户档案上" —— 不带租户时，同一个人在两家店各有一条档案会被误判成冲突（或反过来漏判）。
5. **多店选择器**：新增 `/select-workshop`（页面 + server action）。三个端
   （workshop / rider / mechanic-app）的布局在 `needsWorkshopChoice` 为真时把人送过去。
   action 里的取值来源**只有** `identitiesForAuthUser(authId)` 的候选 ——
   把 `active-tenant.ts` 那条不变式（"绝不接受请求里的任意 orgId"）变成代码。
6. **生产侧 DDL 脚本** `scripts/apply-prod-authid-tenant-scope.mjs`：
   `DROP INDEX` 会被 `sync-prod-schema.mjs` 拒绝自动执行，但"拒绝自动"不该等于"手敲 SQL"。
   脚本**默认只演练**，先做重复键前置检查、幂等、事务内执行、执行后复验；
   `--apply` 还需显式 `--backup-taken`。
7. **测试 +2**（`tests/tenant-resolve.test.ts` 重写）：现在**真的**能造出"同一个 authId 两家店"
   （这是第 2 步才解锁的能力），断言候选数为 2 → `choice`、choice 时取行给 null、
   cookie 指哪家取哪家那条行；外加"双 schema 都改了"与"有对应迁移文件"两条守卫。

## 影响

- **能力**：同一个自然人可以在两家店各有一个业务身份（员工/骑手），各自登录、互不可见。
  这是 P3b 的目标形状。
- **热路径多一次查询**：解析从"1 次 findUnique(authId)"变成"1 次 AuthLink 候选查询 + 1 次按 id 取行"。
  authId 上有索引，换来的是"多条时进哪家店"不再依赖查询的巧合。这是多租户的必要代价。
- **登不进去的风险点（已在部署清单里）**：新解析链信任 AuthLink。**有 authId 却没有 AuthLink 的账号
  会被当成"没有业务身份"**。实测生产漂移为 0（20 员工 + 4 骑手全部有映射），
  且第 3 步前置已把接线补进业务代码 —— 但部署前仍要再查一次。
- **部署顺序（关键）**：必须先在生产执行 DDL，**再**合并。否则 Vercel 构建期的 schema 同步
  看到 `DROP INDEX` 会 exit 1，部署被卡住（生产仍跑旧版本，不是事故，但白跑一轮）。

## 交接说明

### 生产发布清单（按顺序）

```bash
# 0) 备份（必做；没有备份脚本，用 Supabase 控制台或 pg_dump）
# 1) 演练：看清楚要动什么、重复键检查是否为 0
set -a; . ./.env; set +a
node scripts/apply-prod-authid-tenant-scope.mjs
# 2) 执行（幂等：重复跑第二次会说"已经是目标状态"）
node scripts/apply-prod-authid-tenant-scope.mjs --apply --backup-taken
# 3) 部署前必查：AuthLink 漂移必须为 0（新解析链靠它，漏一条那个人就登不进去）
node -e '...'   # 见下方"部署前必查"命令
# 4) 合并 PR → Vercel 构建期 schema 同步此时应看到零差异
```

部署前必查（只读）：

```bash
set -a; . ./.env; set +a
node -e 'const {Client}=require("pg");const c=new Client({connectionString:process.env.DST_DATABASE_URL||process.env.DIRECT_URL,ssl:{rejectUnauthorized:false}});
c.connect().then(async()=>{const q=async(s)=>(await c.query(s)).rows;
console.log(await q(`select \x27staff_missing\x27 k, count(*)::int v from "User" u where u."authId" is not null and not exists(select 1 from "AuthLink" a where a."authId"=u."authId") union all select \x27rider_missing\x27, count(*)::int from "Customer" cu where cu."authId" is not null and not exists(select 1 from "AuthLink" a where a."authId"=cu."authId")`));
await c.end()})'
```

### 实测证据

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误（改 schema 后编译器**正好**点出 3 处，见 PR 描述） |
| `pnpm test` | **992 通过 / 87 文件** |
| `pnpm lint` | 退出码 0（830 warning / 0 error） |
| `pnpm build` + kickstart | 通过 / 三服务 200 |
| Playwright | **55 通过** |
| `/select-workshop` 未登录 | 307 → `/login`（守卫正确） |
| 两个 schema `prisma validate` | 均通过 |
| 生产 `migrate diff` 预览 | 恰好 5 条语句，无其他漂移 |
| 生产重复键检查（脚本演练） | User 0 / Customer 0 → 唯一索引建得上 |
| 生产 AuthLink 漂移 | 员工 0 / 骑手 0 |

### 还没做的（下一步）

- **`/t/<slug>` 入口页**：`resolveEntryTenant({ slug })` 已经能收 slug（第 1 步就留好了），
  但还没有路由把它接上；今天进店的显式来源只有签名 cookie。这是第 4 步剩下的那一半。
- **第 5 步清理**：删死代码 `dz_org`（`actions/rider-context.ts` 写了但没人读）；
  `Organisation`/`Branch` 的去 branch 化（P5）。
- **第 6 步**：claim 迁 `app_metadata`（P0 有意留下的 fail-closed 状态）。
