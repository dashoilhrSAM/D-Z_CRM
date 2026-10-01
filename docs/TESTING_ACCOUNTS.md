# D&Z Testing Branch — 测试账号（Testing Accounts）

> 数据来源：生产库（Supabase PG，2026-09-07）。
> **登录地址**：生产 https://d-z-crm.vercel.app/login · 本地 http://localhost:3002/login
>
> ⚠️ **2026-10-01（P5）：分行隔离已退役** —— `Branch` 降级为隐藏的 1:1 门店记录，
> **不再参与数据可见性**。一个 `Organisation` 就是一家店，**org 内所有人看到同一份数据**
> （见 `src/lib/branch-scope.ts` 文件头）。后果：`test.*` 账号现在**能看到主店的数据**
> （实测：`test.manager@dz.my` 与 `test.owner@dz.my` 在工单列表上看到同样的 7 条）。
> **要用它们演示"隔离"已经不行了** —— 需要演示隔离请单开一个租户（`/platform` 或
> `scripts/provision-tenant.ts`）。下面第三、四节描述的是**退役前**的行为，保留作历史参考。

---

## 一、分行概览

| 项 | 值 |
|---|---|
| 分行 | **D&Z Testing Branch** |
| 城市 | Kuala Lumpur |
| 类型 | Testing（隔离） |
| 员工 | 6（本页账号） |
| 时段 | 已生成未来 7 天（28 slots，maxBookings=2） |

---

## 二、测试账号

> 密码 = **各自角色 + 123**（P5 起这些账号**不再**只看本分行，见文首说明）。
> **OWNER**：org 级，看到全部模块。

| 账号 | 姓名 | 角色 | 密码 |
|---|---|---|---|
| **test.owner@dz.my** | Testing Owner | **OWNER** | **`owner+123`** |
| test.manager@dz.my | Testing Manager | MANAGER | `manager+123` |
| test.counter@dz.my | Testing Counter | COUNTER_STAFF | `counter+123` |
| test.servicemgr@dz.my | Testing Service Mgr | SERVICE_MANAGER | `servicemgr+123` |
| test.mech1@dz.my | Testing Mechanic 1 | MECHANIC | `mechanic+123` |
| test.mech2@dz.my | Testing Mechanic 2 | MECHANIC | `mechanic+123` |

---

## 三、隔离模型（⚠️ 2026-10-01 P5 起**已退役**，此节为历史记录）

- ~~**分支级角色**：强制锁 `session.branchId`，URL `?branch=` 覆盖被忽略。~~
- ~~**org 级角色**：看全部分行。~~

**现在的规则**：查询只按 `organisationId` 收窄，**org 内所有人看到同一份数据**。
`Branch` 只用来记"这一行属于哪家门店"，不参与权限。
隔离的单位从"分行"变成了"**租户（Organisation）**"。

---

## 四、快速验证

1. 用 `test.owner@dz.my / owner+123` 登录 → 进入 **D&Z Testing Branch**，能看到全部模块。
2. 用 `test.manager@dz.my / manager+123` 登录 → **与 owner 看到同一份数据**（实测工单列表同为 7 条）。
3. ~~dashboard / bookings / jobs 分支级均只见本分行~~ → 已退役；要验证隔离请开两个租户。
4. ~~URL 加 `?branch=<其它分行>` 越权被拦~~ → 已退役（`?branch=` 不再参与过滤）。
5. Rider book 页能选到 **Testing Branch** 并预约。
6. 基线：tsc 0 / lint 0 / test 48 / build 0。

---

## 五、注意事项

- **test.* 密码**：角色 + 123（owner+123 / manager+123 / counter+123 / servicemgr+123 / mechanic+123）。
- 忘记密码：查该员工 `authId` → Supabase `admin.updateUserById(authId,{password})` 重置。
- **只建一间** Testing Branch：按 `DEMO_BRANCH_NAME` 唯一守卫生成；生产默认拒绝，除非 `PROVISION_ALLOWED=1`。
- 本地开通脚本：`node --env-file=.env --import tsx scripts/provision-demo-branch.ts`。

---
*完整生产账号清单见 docs/ACCOUNTS_BY_BRANCH.md。*
