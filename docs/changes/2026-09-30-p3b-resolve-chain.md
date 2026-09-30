---
date: 2026-09-30
title: P3b 第 3 步 —— 请求级身份解析链（resolve.ts），三个消费者统一走它
branch: feat/tenancy-resolve-chain
---

## 改动

**施工单第 3 步**。核心问题：`User.authId` / `Customer.authId` 今天都是全局唯一，
所以"这个请求该按哪条业务身份办事"到处都是一句 `findUnique({ where: { authId } })` ——
三处各写一遍（`session-user.ts` 两处、`rider-customer.ts` 一处、`injectBizClaims` 两处）。
唯一键一松，这五处**全部失效**，而且因为没有"哪家店"的概念，多店时会拿到随机那条。

1. **新增 `src/lib/tenant/resolve.ts`** —— 解析链的唯一定义，四级来源固定顺序：
   **① 签名 cookie `dz_tenant` → ② `/t/<slug>` 或 QR（第 4 步接线）→ ③ 唯一所属 →
   ④ ≥2 条必须让用户选**；第 0 级（子域）留空占位并写明将来接法。
   - `requestPersonRefFor(authId, tenant)` 是可测主体（cookie 值由调用方传入，
     因为 `readActiveTenant()` 依赖请求上下文、测试里调不了）；`requestPersonRef()` 是生产入口。
   - **关键语义**：指定了门店却在店里查不到本人 → 返回 `identity: null`，
     **绝不回退到第 ③ 级去找别家店**（"你选的那家没有你"与"没选、系统替你猜一家"是两件事，
     后者正是串店的入口）。
   - `staffWhereFor` / `customerWhereFor` 把"该取哪一条"变成 where（含 `loadCustomerForRefWith`
     给 rider 端带 include），规则只写一遍。
2. **三个消费者全部改走解析链**：`session-user.ts`（`getSessionUser`）、
   `rider-customer.ts`（`getRiderCustomer`）、`injectBizClaims`（登录签 claims 时按他选的店签）。
3. **注册路径那一处按 authId 的查询也带上租户**：`completeRiderPhoneSignup` 里
   `findUnique({ where: { authId } })` → `findFirst({ where: { authId, organisationId } })`
   （门店在流程开头已由 `resolveEntryTenant` 定好）。用 `findFirst` 而非 `findUnique`：
   第 2 步松键后 `findUnique` 会编译失败，而这里本来就只要本店那一条。
4. **测试 +10**：`tests/tenant-resolve.test.ts`；并**收紧**了第 1 步留下的那条结构守卫
   （它原本断言"auth-supabase 里不许出现 `db.customer.findFirst`"，而第 3 步引入的是一处
   **带租户**的 findFirst —— 断言改进成"每一条客户查询的 where 里都必须有 organisationId"，
   意图不变但不再误伤）。

## 影响

- **零查询回归**：今天没有任何代码写 `dz_tenant`（`setActiveTenant` 还没有调用方），
  所以生产走的仍是第 ③ 级 —— 与改造前**完全同一条查询**。多付的那一次 AuthLink 查询
  只在真的选了门店时才发生（第 4 步之后）。
- **多店语义就位**：同一个 authId 在两家店各一条身份时，cookie 指哪家就取哪家那条行；
  指到没有他的店就是"没有身份"，不会翻别家。
- **第 2 步的编译期护栏**：`resolve.ts` 里唯一所属的两处 `{ authId }` where 在松键后会
  编译失败（Prisma 只允许对唯一字段用 where-unique）—— 编译器会逼着换成候选链 + 选择器，
  不靠人记得回来改。

## 交接说明

**实测证据**：

| 检查 | 结果 |
|---|---|
| `pnpm exec tsc --noEmit` | 0 错误 |
| `pnpm test` | **990 通过 / 87 文件**（980 + 新增 10） |
| `pnpm lint` | 退出码 0（830 warning / 0 error） |
| `pnpm build` + kickstart + Playwright | 通过 / 三服务 200 / 55 通过 |

**变异测试（都实测会红）**：

- 把注册路径那处改回无租户的 `findFirst({ where: { authId } })` →
  `tests/tenant-signup-scope.test.ts` 红（提示"这些查询没有租户条件"）。
- 在 `session-user.ts` 里新加一条裸 `db.customer.findFirst({ where: { authId } })`
  （模拟有人绕过解析链）→ `tests/tenant-resolve.test.ts` 红并点名该文件。
- 结构守卫带**正向对照**：两处护栏 where 若消失，或正则一处都匹配不到，同样会红
  （写这条时正向对照真的红了一次 —— 重构后护栏从 `findUnique({authId})` 变成了
  `{ authId }` where 构造器，正则没跟上；这正是正向对照存在的理由）。

**已知边界**：结构守卫是**文件级白名单 + 数量上限**（`phone-identity.ts` /
`auth-supabase.ts` / `workshop.ts` 各 1 处，都写了理由）。在允许的文件里把 `findFirst` 改写成
`findUnique` 不会红（数量没变）。要更严只能上真正的 AST 检查，目前不值当。

**下一步**（施工单第 2 步 + 第 4 步，必须同一批）：松 `User.authId` / `Customer.authId`
全局唯一 → `@@unique([organisationId, authId])`（双 schema + 迁移 + dev/e2e 各自 migrate deploy
+ `@@index([organisationId, phone])`），编译器会点出要改的三处；同时把第 ③ 级换成
`identitiesForAuthUser` 候选链、接上 `/t/<slug>/login` 与多店选择器。
生产侧：唯一键变更属于**破坏性 DDL**，`sync-prod-schema.mjs` 会拒绝，需人工带备份执行。
