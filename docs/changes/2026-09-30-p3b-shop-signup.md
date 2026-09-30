---
date: 2026-09-30
title: P3b 第 4 步最后一块 —— 门店注册入口 /t/<slug>/signup（注册的"哪家店"由链接决定）
branch: feat/tenancy-shop-signup
---

## 改动

**隐患 ① 的正面解法**。此前注册路径的"进哪家店"只能靠
`resolveEntryTenant()`（签名 cookie → 平台恰好一家在营门店 → 否则拒绝）——
单店没问题，多店并存时是**拒绝**（安全）但不能由链接指定。现在门店可以写在链接里。

1. **四个注册入口都收 `tenantSlug`**：`signUpRider`、`requestRiderPhoneOtp`、
   `verifyRiderPhoneOtp`、`completeRiderPhoneSignup`，一律
   `resolveEntryTenant({ slug: input.tenantSlug })`。
2. **注册表单组件化**：`src/app/rider/signup/page.tsx` 的表单搬到
   `src/components/rider/signup-form.tsx`（`RiderSignupForm({ tenantSlug })`），
   原页面变成 3 行壳；新增 **`/t/<slug>/signup`** 传 slug（slug 不存在/门店停用 → `notFound()`）。
3. **登录页的注册链接跟着门店走**：新增 `slugFromTenantPath()`（只认 slug 字符集），
   `/rider/login` 看到回跳是 `/t/<slug>` 时，"还没有账号 → 注册"指向 `/t/<slug>/signup`，
   于是"门店链接 → 登录 → 注册"整条链路都落在同一家店。
4. **测试 +10**：`tests/tenant-shop-signup.test.ts`（7）、`tests/auth-next-path.test.ts`（+3）。

## 影响

- **注册的租户由链接决定**，不再依赖"唯一在营门店"的兜底判断：多店并存时，
  拿着某家店链接来注册的新客户会准确落在那家店，而不是被拒绝或"按字母序"落进别家。
- 不带 slug 的旧入口（`/rider/signup`）行为完全不变。
- 门店链接现在有两个入口：`/t/<slug>`（老用户进店）与 `/t/<slug>/signup`（新客户注册）。

## 交接说明

**实测证据**：

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `pnpm test` | **1018 通过 / 90 文件**（1008 + 10） |
| `pnpm lint` | 退出码 0（830 warning / 0 error） |
| `pnpm build` | 通过（新增路由 `/t/[slug]` 与 `/t/[slug]/signup`） |
| Playwright | **55 通过** |
| `/t/d-z-smart-workshop/signup` | **200** |
| `/t/nope/signup` | **404** |
| `/rider/signup` | 200（旧入口不变） |
| `/t/d-z-smart-workshop` | 307（进店链路不受影响） |

**这个测试为什么能跑**：Supabase 打了三个桩（`@supabase/supabase-js`、`@/lib/supabase/server`、
`next/headers` 的 cookies），剩下的就是真实数据库 —— 而**给了 slug 的租户解析是确定的**，
不再受"唯一在营门店"这类并发敏感判断影响。它真的走完了 `signUpRider`：建 auth 用户（桩）→
按链接的店匹配/建档案 → 写 AuthLink → 注入 claims（桩）。

**变异测试（都实测会红）**：

- 让 `signUpRider` 忽略 slug 退回 `resolveEntryTenant()` → 4 条红（"B 店应该出现新档案"直接失败）。
- 让表单漏传一个 `tenantSlug` → 2 条红，并**点名 `signUpRider`**。

**顺带修好的一个测试卫生问题**：变异 A 那轮把映射写进了真店（D&Z），夹具的清理只按 org 删，
于是残留让"AuthLink 只该有 B 店一条"的断言一直红。夹具现在**按它独占的 authId 清理**，
自愈且不会互相污染 —— 这类"跑偏一次就长期假红"的夹具问题是本项目反复踩的坑。

### 下一步

- CI 的 4 个仓库 Secrets（配齐后这些"要真登录才走得到"的路径才有自动化 e2e；今天靠数据层单测 + 人工生产冒烟）。
- 第 5 步清理：删死代码 `dz_org`；核对 `User.email` 的复合唯一是否已写全。
- 第 6 步：claim 迁 `app_metadata`。
