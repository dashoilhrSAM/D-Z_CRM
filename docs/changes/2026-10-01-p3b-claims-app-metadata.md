---
date: 2026-10-01
title: P3b 第 6 步 —— 业务 claims 迁到 app_metadata（user_metadata 是用户能自己改的）
branch: feat/tenancy-claims-app-metadata
---

## 改动

**施工单第 6 步**。P0 已经把数据库侧的 `app_jwt_claim()` 改成只认 `app_metadata`
（理由：`user_metadata` 用户自己就能改），于是 PostgREST/RLS 面对合法用户也**一律拒绝** ——
那是有意留下的 fail-closed 状态。这一步把 claims 的**写入**也迁过去，把那扇门重新打开。

1. **`injectBizClaims` 改写 app_metadata**（登录路径）：从"用户作用域客户端 + user_metadata"
   改成"**service role admin 客户端 + app_metadata**"（只有它能写 app_metadata）。
   过渡期**两处都写**：老会话/老客户端的中间件仍会兜底读 user_metadata。
2. **注册路径（`signUpRider`）同样写 app_metadata**（原来只写 user_metadata）。
3. **`identityFromClaims` 改为按同样的优先级读**：`app_metadata` 优先、`user_metadata` 兜底，
   逐键合并（同键以 app_metadata 为准）。字段名从 `user_metadata` 改成 **`claims`** ——
   原来的名字在"可能来自 app_metadata"之后就是个谎言，而这个名字正是让下一个维护者
   以为"user_metadata 是我们的身份来源"的原因。中间件（`src/middleware.ts`）相应改用 `user.claims.role`。
4. **回填脚本 `scripts/backfill-auth-app-metadata.mjs`**（默认演练、`--apply` 才写）：
   存量账号不必等各自下次登录。两条设计决定：
   - **claims 从业务库推导，不复制 `user_metadata`** —— 后者是用户可写的，把它搬进"权威"的
     app_metadata 等于**把伪造值洗白**（`role: "OWNER"` 也能搬进去）。真相在 `User` / `Customer` / `AuthLink`。
   - **合并写入**：`app_metadata` 里还有 Supabase 自己的键（`provider` / `providers`），
     显式读出当前值再合并，不依赖服务端的合并语义；复验里专门查 `provider` 有没有被写没。
5. **测试**：`tests/auth-identity.test.ts` 增加 app_metadata 优先、过渡兜底、脏值退化三条
   （原来那三条改成读 `claims`）；`tests/tenant-shop-signup.test.ts` 增加"注册与登录都写了
   app_metadata，且 orgId 来自门店链接"（打桩的 admin 客户端会记录每次写入）。

## 影响

- **PostgREST/RLS 面对合法用户重新开放**：app_metadata 进了 JWT，`app_jwt_claim()` 能读到
  `orgId` 等业务键。存量账号在回填（或各自重新登录）之后生效。
- **中间件的路由隔离不再能被"改自己的 user_metadata"绕过**：优先读 app_metadata
  （用户改不了）；user_metadata 只对"还没迁移的老账号"兜底。
  （那层本来也不是权威层 —— 真正的判定在 layout / `requireStaff()` 用 DB 数据做。）
- 写入侧从"用户作用域客户端"改成"service role 客户端"：`injectBizClaims` 需要
  `SUPABASE_SERVICE_ROLE_KEY`（服务端本来就有）。

## 交接说明

**实测证据**：

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `pnpm test` | **1026 通过 / 91 文件**（1022 + 4） |
| `pnpm lint` | 退出码 0（830 warning / 0 error） |
| `pnpm build` + kickstart | 通过 / 三服务 200 |
| Playwright | **55 通过** |
| 回填脚本演练（生产） | 业务库 24 个带 authId 的账号（20 员工 + 4 骑手）＝ Supabase auth 24 个用户；**app_metadata 已正确 0 ｜待写 24**；**没有孤儿账号**（每个 auth 用户都有业务身份） |

**变异测试**（claims 那侧）：`identityFromClaims` 的优先级用例在"改成 user_metadata 优先"时
会红 —— 即 `app_metadata` 优先这条断言是真的在守东西。

### 生产执行（待定）

```bash
# 演练（只读，已跑过）
node scripts/backfill-auth-app-metadata.mjs
# 写入 24 个账号的 app_metadata（幂等：再跑会说"无需改动"）
node scripts/backfill-auth-app-metadata.mjs --apply
```

不跑也不会坏：每个账号下次登录时 `injectBizClaims` 会写。跑了则**立刻**对全部人开放。

### 下一步

- CI 的 4 个仓库 Secrets（配齐后"要真登录才走得到"的路径才有自动化 e2e）。
- P3b 施工单至此**六步全部完成**；再往后是 P4（平台管理台）/ P5（产品层去 branch）。
