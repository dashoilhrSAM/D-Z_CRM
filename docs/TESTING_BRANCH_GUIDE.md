# D&Z Testing Branch — 详情与指南（Guide）

> 目的：为「给真实 workshop 使用」开通的 demo/testing 分行，一份完整的开通、账号、隔离、验证与注意事项指南。
> 数据来源：生产库（Supabase PG，2026-09-07）。

---

## 一、分行概览

当前组织 **D&Z Smart Workshop** 下有 **4 个分行**：

| 分行 | 城市 | 类型 | 状态 |
|---|---|---|---|
| D&Z Smart Workshop | Kuala Lumpur | `isMain` 主店 | 有 10 员工 + 1 顾客 |
| D&Z Smart Workshop | Shah Alam | 分店 | 无账号 |
| D&Z Smart Workshop | Johor Bahru | 分店 | 1 顾客 |
| **D&Z Testing Branch** | Kuala Lumpur | Testing（隔离） | 5 员工（本指南重点） |

> 完整账号清单见 `docs/ACCOUNTS_BY_BRANCH.md`。

---

## 二、Testing Branch 账号

> 分支级账号，登录后**只见本分行数据**（严格隔离）。密码 = **各自角色 + 123**。

| 账号 | 角色 | 密码 | 登录 |
|---|---|---|---|
| test.manager@dz.my | MANAGER | `manager+123` | ✅ |
| test.counter@dz.my | COUNTER_STAFF | `counter+123` | ✅ |
| test.servicemgr@dz.my | SERVICE_MANAGER | `servicemgr+123` | ✅ |
| test.mech1@dz.my | MECHANIC | `mechanic+123` | ✅ |
| test.mech2@dz.my | MECHANIC | `mechanic+123` | ✅ |

**登录地址**：`https://d-z-crm.vercel.app/login`（生产）或 `http://localhost:3002/login`（本地）。

---

## 三、隔离模型

App UI 走 **Prisma**（RLS 仅兜底 Supabase PostgREST），UI 层隔离靠 `src/lib/branch-scope.ts`。

| 角色类型 | 角色 | 权限 |
|---|---|---|
| **org 级** | SUPER_ADMIN · OWNER · HEAD_OFFICE_ADMIN | 看全部分行 |
| **branch 级** | MANAGER · SALES · SERVICE · COUNTER · MECHANIC · INVENTORY … | **强制锁 `session.branchId`**，URL `?branch=` 越权被忽略 |

**接 branch 隔离的运营面**（全部）：
`dashboard`(含聚合) · `bookings` · `jobs` · `mechanic` · `staff` · `slots` · `invoices` · `pipeline` · `leads` · `tasks` · `inventory`(stock/dead-stock/alerts/reorder) · `notifications` · `kpi` · `settlements` · `profit` · `purchase-orders`。

**org 级共享（顾客可见全部 + 配置）**：
`customers`（**当前分行可见 org 全部顾客**）· `motorcycles` · `packages` · `serviceTypes` · `checklists` · `templates` · `campaigns` · `reminders`（顾客级无 branchId）。

**分行隔离（仅运营数据按当前 branch）**：
`bookings` · `service jobs` · `invoices` · `inventory` · `kpi` · `settlements` · `profit` · `purchase-orders` …（测试分行 = 0/空）。

---

## 四、开通流程（provision 脚本）

脚本：`scripts/provision-demo-branch.ts`（幂等：branch 按名称查重、staff 按 email 查重、auth 账号复用）。

**本地（dev.db）**：
```bash
node --env-file=.env --import tsx scripts/provision-demo-branch.ts
```

**生产（Supabase PG）**：
```bash
# 1) 切到 PG client（生产 schema），注意会临时覆盖本地 client
pnpm exec prisma generate --schema prisma/schema.pg.prisma
# 2) 构造指向生产库的 env（DST_DATABASE_URL）并运行
grep -vE '^DATABASE_URL=' .env > /tmp/.env.prov
echo "DATABASE_URL=$(grep -oE '^DST_DATABASE_URL=.*' .env | cut -d= -f2-)" >> /tmp/.env.prov
PROVISION_ALLOWED=1 node --env-file=/tmp/.env.prov --import tsx scripts/provision-demo-branch.ts
# 3) 切回 sqlite client，恢复本地
pnpm exec prisma generate --schema prisma/schema.prisma
```

> ⚠️ **必须**按 1→3 顺序：`schema.pg.prisma`→跑→`schema.prisma`。否则本地 `:3002` 下次重启会连错库。

**只建一间**测试分行：按 `DEMO_BRANCH_NAME`（默认 `D&Z Testing Branch`）名称唯一守卫生成；生产默认拒绝，除非 `PROVISION_ALLOWED=1`。

可用环境变量：`DEMO_BRANCH_NAME` · `DEMO_BRANCH_CITY` · `SLOT_DAYS` · `MAX_BOOKINGS`。

---

## 五、Rider 预约

- `/rider/book` 按登录 rider 的 `organisationId` 列出**该组织全部分行**（含 Testing Branch）。
- Testing Branch 已生成未来 7 天时段（28 slots，`maxBookings=2`），rider 可预约。
- 顾客与测试分行**同 org** → org 级共享，符合「分行共用 rider」。

---

## 六、验证清单

1. 用 `test.manager@dz.my / manager+123` 登录生产 → 进入 D&Z Testing Branch。
2. 看 dashboard / bookings / jobs / staff / kpi / settlements / profit / purchase-orders 均**只见本分行**（空数据）。
3. 加 `?branch=<其它分行>` 访问 → 仍只见本分行（URL 越权被拦）。
4. rider book 页能选到 Testing Branch 并预约。
5. 跑基线：`tsc 0 / lint 0 / test 48 / build 0`。

---

## 七、注意事项

- **@dz.my 员工**（主店 Daniel/Mei Ling/Aizat/Hafiz/Ravi/Wei Kit/Priya/crm_do_owner）已启用登录，但密码未记录 —— 演示请用 ManagerDemo / MechanicDemo / test.* 账号，或到 Supabase 重置。
- **ManagerDemo / MechanicDemo**（主店）密码 `Dashoil@!789`。
- **重复记录**：`MechanicDemo@gmail.com` 有 2 条 User（其一 login=no，疑为历史残留），可后续清理。
- 改生产 auth 密码流程：`prisma generate --schema schema.pg.prisma` → 读 `authId` → `supabase.auth.admin.updateUserById(authId,{password})` → 切回 sqlite。

---

## 附：相关文件

- `scripts/provision-demo-branch.ts` — 开通脚本
- `src/lib/branch-scope.ts` — 隔离作用域（org/branch 级判定 + URL 越权拦截）
- `docs/ACCOUNTS_BY_BRANCH.md` — 全组织账号清单
- `docs/SETUP_AND_PREPARATION.md §9` — 变更台账