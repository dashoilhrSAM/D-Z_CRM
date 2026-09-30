---
date: 2026-09-30
title: P3b 第 4 步收尾 —— 门店专属链接 /t/<slug>，并让登录页真正消费 ?next=
branch: feat/tenancy-shop-entry
---

## 改动

**`/t/<slug>` 入口页**（施工单第 4 步剩下的那一半）。`resolveEntryTenant({ slug })` 从第 1 步起
就能收 slug，但一直没有路由把它接上 —— 今天"进哪家店"的显式来源只有签名 `dz_tenant` cookie。

1. **新增 `src/app/t/[slug]/route.ts`**：读身份 → 按决策签 cookie 或跳转。
   - 之所以是 **route handler 而不是 page**：进店的动作是"签 cookie 然后跳走"，
     而 Server Component **不能写 cookie**（只有 action / route handler / middleware 能）。
   - 签名只发生在 `enter` 分支，organisationId 来自**候选列表的匹配结果** ——
     绝不拿 URL 里的 slug 直接签（`active-tenant.ts` 的不变式）。
   - slug 不存在 / 门店停用 → 明确 404（不是含糊地跳去哪里）。
2. **决策抽成 `planShopEntry(authId, slug)`**（`src/lib/tenant/entry-tenant.ts`）：可单测。
   三条硬规则：**① URL 里的 slug 优先于 cookie；② 进店前提是 `identitiesForAuthUser` 里
   确实有这家店；③ 不是这家店的人 → `not-a-member`，不签 cookie、不猜一家**。
3. **`?next=` 回跳真正生效**：新增 `src/lib/auth/next-path.ts` 的 `safeNextPath()`，
   `/login` 与 `/rider/login` 消费 `?next=`。这**顺带修好一个既有缺陷** ——
   `/qr/rider/[id]`、`/qr/motorcycle/[id]`、`/qr/workshop/[id]` 三个入口一直在生成
   `?next=`，但**没有任何登录页读它**，所以扫完码登录后用户被丢回默认首页。
   `safeNextPath` 做开放重定向防护：只认站内绝对路径（拒 `https://…`、`//host`、`/\host`、
   相对路径、夹带空白/控制字符），拿不准就回退默认落点。
4. **测试 +16**：`tests/tenant-shop-entry.test.ts`（9）、`tests/auth-next-path.test.ts`（7）。

## 影响

- 门店专属链接可用：`/t/d-z-smart-workshop` → 未登录先去登录（带 `next` 回跳）→
  登录后回来签 cookie 进对的端（员工 → `/workshop/dashboard`，骑手 → `/rider/home`）。
- **不是这家店的人进不去**：会落到 `/select-workshop`（选择器会说明"那家店不在你的账号里"），
  不会被"顺手"送进任何一家店。
- 三个 QR 落地页的回跳从"形同虚设"变成真的生效。
- 单店行为不变：`?next=` 缺失时两个登录页的落点与改造前完全一致。

## 交接说明

**实测证据**：

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `pnpm test` | **1008 通过 / 89 文件**（992 + 16） |
| `pnpm lint` | 退出码 0（830 warning / 0 error） |
| `pnpm build` + kickstart | 通过 / 三服务 200 |
| Playwright | **55 通过** |
| `/t/d-z-smart-workshop`（未登录） | **307 → `/login?next=%2Ft%2Fd-z-smart-workshop`** |
| `/t/no-such-shop-xyz` | **404** + "This workshop link is not valid" |
| `/login?next=…` | 200（带参数照常渲染） |

**变异测试**：把 `planShopEntry` 里"不是这家店"的分支改成"顺手用第一条候选"（典型串店写法）
→ `tests/tenant-shop-entry.test.ts` 立刻红 2 条（`expected 'enter' to be 'not-a-member'`）。

### 有意没做的（下一步）

- **注册流程的门店显式化**：`/t/<slug>/signup` + 把 slug 传进 `signUpRider` /
  `completeRiderPhoneSignup`。今天注册仍走 `resolveEntryTenant()`（签名 cookie → 唯一在营门店 →
  否则拒绝），**隐患 ① 的"注册进哪家店"在多店并存时会拒绝而不是猜**，但还不能由链接显式指定。
  `resolveEntryTenant({ slug })` 已能收 slug，缺的是把 slug 从注册页一路带下去。
- `/rider/login` 的"没有账号 → 去注册"链接暂不带 `next`（注册完落在 bike-first，
  那是顾客自己的引导流程）。等上面那条做了再一起接。
