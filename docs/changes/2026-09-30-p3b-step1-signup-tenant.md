---
date: 2026-09-30
title: P3b 第 1 步 —— 注册路径的邮箱/手机匹配加租户条件，org 不再「按名字排序第一家」
branch: docs/perf-load-results
---

## 改动

**施工单第 1 步**（`docs/MULTI_TENANT_PLAN.md` §P3「P3b 施工单」）。它必须先于第 2 步
（松 `User.authId` / `Customer.authId` 全局唯一键），因为今天那两处匹配安全**完全**靠唯一键兜着。

1. **新增 `src/lib/tenant/entry-tenant.ts`** —— 入口级租户解析，顺序固定：
   ① 显式 slug（`/t/<slug>`，第 4 步接线）→ ② **签名** `dz_tenant` cookie → ③ 平台里
   **恰好一家在营门店**时用它 → 都不成立就**拒绝**（`AMBIGUOUS` / `NO_TENANT`）。
   判定是纯函数 `pickSoleTenant`（可单测），IO 在 `resolveEntryTenantFor`；
   生产入口 `resolveEntryTenant()` 只负责读 cookie 后委托。
2. **`src/lib/auth/phone-identity.ts`**：
   - `customersByPhone(organisationId, local)` —— 租户参数**必需**（顺手把过滤下推到 SQL，
     不再把全表客户拉进内存）。漏写租户的调用点会被 `tsc` 拦住，不靠人记得写。
   - `customerByEmailInTenant(organisationId, email)` —— 注册路径唯一的邮箱匹配入口。
   - `customersByPhoneAnyTenant(local)` —— 显眼命名的**跨租户**版本，只给登录入口用
     （第 3/4 步把登录收到解析链上后删掉）。
3. **`src/actions/auth-supabase.ts`**：注册路径（`signUpRider`、`requestRiderPhoneOtp`、
   `verifyRiderPhoneOtp`、`completeRiderPhoneSignup`）**先定租户、再匹配**；两处
   `organisation.findFirst({ orderBy: { name: "asc" } })` 删除；三处无租户条件的
   `db.customer.findFirst({ where: { email } })` 改走带租户的 helper。
   租户解析放在**建 Supabase auth 用户之前**，判不出门店时不留下孤儿 auth 账号。
4. **`src/actions/rider-settings.ts`**：改手机号时的号码占用检查收到本店
   （别家店有同号码是正常的 —— 同一个人可以在两家店各留一次资料）。
5. **测试 +24**：`tests/tenant-signup-scope.test.ts`（8）与 `tests/tenant-entry-tenant.test.ts`（16）。

## 影响

- **单店行为不变**：生产 / e2e.db / dev.db 实测解析结果都是 `d-z-smart-workshop`（见下）。
- **多店并存时不再猜**：没有显式门店的注册直接拒绝并提示走门店链接，而不是按字母序进一家店。
- **本地顺带修掉一个真 bug**：dev.db 有 10 家组织（9 家是测试残留的空壳：0 门店 / 0 客户 /
  0 工单），旧代码 `orderBy: { name: "asc" }` 选中的是 `BULK-blkmueyf5dv` ——
  本地注册一直进的是空壳店。新解析选中的是 `D&Z Smart Workshop`。
- 登录入口的手机匹配**暂时**仍是跨租户的（`customersByPhoneAnyTenant`，有结构守卫钉住只有一处）；
  它不绑定任何档案，第 3/4 步会随解析链一起收掉。
- ⚠️ **短信验证码那两条既是注册也是登录入口**（`requestRiderPhoneOtp` / `verifyRiderPhoneOtp`），
  所以多店并存时**短信登录**也会在定不出门店时 fail-closed（拒绝而不是猜一家店）。
  今天所有环境都是单店，无影响；真正的解法是第 4 步的多店选择器。
  密码登录**没有**受影响（它仍走跨租户匹配，见上一条）。

## 交接说明

**实测证据**（本次会话）：

| 检查 | 结果 |
|---|---|
| `pnpm exec tsc --noEmit` | 0 错误 |
| `pnpm test` | **971 通过 / 85 文件**（基线 947 + 新增 24） |
| `pnpm lint` | 退出码 0（830 warning / **0 error**，与基线一致） |
| `pnpm build` | 通过 |
| `pnpm exec playwright test --project=desktop-chromium` | 55 通过 |
| 入口解析（dev.db，10 家组织） | `{source: "sole", slug: "d-z-smart-workshop"}` |
| 入口解析（e2e.db，1 家组织） | `{source: "sole", slug: "d-z-smart-workshop"}` |

**变异测试**（证明回归测试真的会红，不是自嗨）：

- 去掉 `customersByPhone` / `customerByEmailInTenant` 的租户条件 → 3 条行为断言变红
  （「同号码在两家店」「只有 A 店有这条邮箱时 B 店查不到」「同邮箱各查各的」）。
- 把 `customersByPhoneAnyTenant` 用到第二个调用点 → 结构守卫变红并**点名文件与次数**
  （`src/actions/rider-settings.ts ×1`、`src/lib/auth/phone-identity.ts ×2`）。

**两个刻意的决定**（免得下一会话以为是漏做）：

1. **`@@index([organisationId, phone])` 故意没加**。它是纯性能项，而 Customer 今天没有
   任何索引；第 2 步本来就要改双 schema（唯一键），把索引并进那一次 schema 变更与生产同步，
   比为它单独走一遍迁移更省事。plan 文档里仍留着这条。
2. **`completeRiderPhoneSignup` 里按 `authId` 的 `findUnique` 没收窄租户**，只加了注释。
   它不产生跨店绑定（绑的是这个人自己的账号），但多店时会读到他**另一家店**的档案 ——
   那是第 3 步解析链（`identityInTenant`）的活。同理 `injectBizClaims` 与
   `session-user.ts` / `rider-customer.ts` 的三处 `findUnique({ where: { authId } })`。

**下一步（施工单第 2 步，前置已满足）**：松 `User.authId` / `Customer.authId` 全局唯一
→ `@@unique([organisationId, authId])`，双 schema + 迁移 + `dev.db`/`e2e.db` 各自 migrate deploy。
注意 `injectBizClaims` 与 session 解析用的是 `findUnique({ where: { authId } })`，
**唯一键一松它们会直接编译/运行失败** —— 所以第 2 步必须与第 3 步（解析链）同一批做，
不能只改 schema。
