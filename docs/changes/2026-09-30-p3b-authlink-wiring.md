---
date: 2026-09-30
title: P3b 第 3 步前置 —— 把 AuthLink 接到账号创建/绑定路径上（此前只有回填脚本在写）
branch: feat/tenancy-authlink-wiring
---

## 改动

**问题**：`AuthLink` 是「这个 auth 账号属于哪几家店」的唯一事实来源（P3b 第 3 步的解析链
`identitiesForAuthUser` / `identityInTenant` 读它），但全仓**只有**
`scripts/backfill-tenant-columns.ts` 在写它 —— `src/lib/tenant/identity.ts` 的 `linkIdentity()`
**零调用方**。今天漂移是 0（P3a 回填过），所以看不出任何问题；可从现在起每新建一个员工或骑手
都会漏一条，等第 3 步上线，**新账号会直接登不进去**（老账号因回填过反而正常 —— 这种
"新数据坏、老数据好"的形状最容易被误判成偶发故障）。

1. **`src/lib/tenant/identity.ts`** 新增两个意图明确的接线函数（都是 `linkIdentity` 的薄封装，
   幂等）：`linkStaffIdentity({authId, organisationId, userId})` /
   `linkCustomerIdentity({authId, organisationId, customerId})`。
   包一层是因为 `kind` 与 `userId`/`customerId` 的搭配写错**不会报错**，只会产出一条指向空用户的
   假身份 —— 包完之后调用点只需要回答"哪个人、哪家店"。
2. **接线 4 处**：`auth-supabase.ts` 的 `signUpRider`（新建档案 / 老客认领两条路）、
   `verifyRiderPhoneOtp`（老客认领）、`completeRiderPhoneSignup`（认领或新建），
   以及 `workshop.ts` 的 `createStaff`（建带 authId 的员工）。判据用 `customer.authId === authId`
   而不是判断走了哪个分支 —— 这样以后新增分支也不会漏。
3. **`e2e/link-auth.ts`** 也补映射：它每次 wipe+seed 后给 e2e.db 绑真实 Supabase 的 authId，
   不补的话第 3 步一上线 e2e 会整片登录失败（看起来像"应用坏了"）。
4. **漂移巡检改成只读可用**：`scripts/backfill-tenant-columns.ts` 原本把「有 authId 却缺 AuthLink」
   的对照放在 `--apply` 之后，于是巡检必须先写库。已挪到「只报告模式 return」之前 ——
   现在 `pnpm exec tsx scripts/backfill-tenant-columns.ts`（不带 `--apply`）就是一次漂移体检。
5. **测试 +9**：`tests/tenant-auth-link-wiring.test.ts`。

## 影响

- **不改登录行为**：今天生产没有任何代码路径读 `AuthLink`，接线只是把这张表从"回填快照"
  变成"持续维护的事实"。第 3 步（解析链）才是开始读它的那一步。
- **第 3 步的前置补齐**：解析链上线时，新账号也会有映射。
- 巡检命令可用：`pnpm exec tsx scripts/backfill-tenant-columns.ts` → 期望
  `有 authId 但缺 AuthLink：员工 0 客户 0`。

## 交接说明

**实测证据**：

| 检查 | 结果 |
|---|---|
| `pnpm exec tsc --noEmit` | 0 错误 |
| `pnpm test` | **980 通过 / 86 文件**（971 + 新增 9） |
| `pnpm lint` | 退出码 0（830 warning / 0 error，与基线一致） |
| `pnpm build` + kickstart + Playwright | 通过 / 三服务 200 / 55 通过 |
| 漂移体检 dev.db（只读） | `AuthLink 待映射 18 条（员工 16 + 客户 2）`、`缺映射：员工 0 客户 0` |
| 漂移体检生产（只读 pg） | `links=24（staff 20 + riders 4）`、`staff_missing=0 rider_missing=0` |
| e2e.db | e2e 链路会跑 `link-auth.ts`（现在也写映射），global-setup 已覆盖 |

**测试的两种守卫 + 变异验证**（都实测过会红）：

1. **行为**（5 条）：两个接线函数写出的记录正好能被第 3 步的解析链读出来（`identityInTenant` /
   `identitiesForAuthUser`），含「一个 authId 两家店 → `needsTenantChoice` 为真」这个第 3 步验收点，
   以及负面对照（没接线就查不到）。
2. **结构（生成式）**：扫描 `src/**/*.ts`，凡是在 `db.user.*` / `db.customer.*` 里写了 `authId`
   的调用点，**其所在函数**里必须有对应接线。
   - 变异 A：删掉 `completeRiderPhoneSignup` 里的接线 → 红，并**点名两个站点**（建档案 / 更新档案）。
   - 变异 B：新增一个绑 authId 的函数而不接线 → 红，点名 `_bindProbe()`。
   - 变异 C：去掉 `e2e/link-auth.ts` 的 `authLink.upsert` → 红。
   - 带**正向对照**（扫不到 ≥3 个站点也红），否则正则失效会伪装成全绿 —— 本项目踩过的假绿。

**这条静态守卫管不到什么**（诚实记录）：它是"函数级"的 —— 在一个**已经接过线**的函数里再加
一条绑 authId 的新路径，它不会红（同函数内已有接线调用）。要根治得把"写 authId"和"写映射"
合并成同一个 API（`bindCustomerToAuth()` 之类），那要动 `signUpRider` 的建/认领分支，
留到第 3 步一起做更合适。

**下一步**（施工单第 3 步，前置已补齐）：解析链 —— `session-user.ts:40/45`、
`rider-customer.ts:14`、`injectBizClaims`（`auth-supabase.ts:26/39`）共 5 处
`findUnique({ where: { authId } })` 改走 `readActiveTenant()` → `identityInTenant(authId, tenant)`，
无 cookie 时回退「唯一所属」、≥2 条必须进选择器。**之后**才能松
`User.authId` / `Customer.authId` 全局唯一键（且要连 `@@index([organisationId, phone])` 一起上）。
