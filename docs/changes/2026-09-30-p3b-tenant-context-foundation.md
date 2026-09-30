---
date: 2026-09-30
title: P3b 地基：签名租户 cookie + 施工单（并说明为什么还不能松唯一键）
branch: docs/perf-load-results
---

## 这一轮做了什么，以及**刻意没做什么**

勘察 P3b 时发现两个隐患，它们决定了施工顺序 —— **"松开 `authId` 唯一键"不能先做**。
所以这一轮交付的是：可以安全落地的地基（签名 cookie）、以及一份写清隐患与顺序的施工单。

## 1. `src/lib/tenant/active-tenant.ts`（新）

**签名的** `dz_tenant` cookie：`<organisationId>.<slug>.<HMAC-SHA256>`，httpOnly / sameSite=lax /
生产 secure / 30 天。

它解决 P3b 的核心问题：**登录时不知道该进哪家店**。
`AuthLink` 回答"这个 auth 账号属于哪几家店"（事实，存数据库）；
cookie 记住"他这次选了哪家"（会话状态）。两者分开是对的。

判据以 **organisationId 为准**，slug 只作展示 —— 门店改名不该让所有人掉线。

**关于 `dz_org`**：项目里已经有一个 `dz_org` cookie，由 `rider-context.ts:14` 写，
而**全项目没有任何地方读它**。这不是"忘了读"，而是读它本身不安全 ——
cookie 客户端可随意写，谁都能把自己的门店改成隔壁那家，于是"隔离"变成一句注释。
新 cookie 因此必须签名。旧的 `dz_org` 在 P3b 第 5 步删除。

**不变式（写在模块注释里）**：`setActiveTenant` 会老老实实签任何给它的 organisationId ——
签名保证的是"值出自服务端"，**不保证"这个人有权进这家店"**。
调用方必须先 `identitiesForAuthUser(authId)` 取候选、**从候选里选**，
绝不要把请求参数直接递进来。

## 2. 两个必须一起解决的隐患（施工单已写入 `docs/MULTI_TENANT_PLAN.md`）

**隐患 ①：注册时"哪家店"的答案是"按名字排序第一家"。**
`auth-supabase.ts:204` 与 `:442` 都是 `db.organisation.findFirst({ orderBy: { name: "asc" } })`。
单店时正确；两家店时这是**按字母序的抛硬币**。

**隐患 ②（更严重）：松开 `Customer.authId` 唯一键，会把"邮箱/手机匹配"变成跨店劫持。**
`auth-supabase.ts:410` 的 `customer.findFirst({ where: { email } })` 与 `:419` 的
`customersByPhone(...)` 都**没有租户条件**。今天它们安全，是因为 `authId` 全局唯一兜住了；
**唯一键一松，兜底就没了** —— 在 B 店注册的人可能匹配到 A 店那条同邮箱/同手机的记录并
把 authId 绑上去，等于把 A 店的客户档案交给了他。
所以匹配必须先加租户条件，**且要在松约束之前完成**。

施工顺序（6 步，每步可独立验证）写在方案文档 §P3 的「P3b 施工单」里。

## 3. 测试（`tests/tenant-active-tenant.test.ts`，7 条）

重点全在"伪造不了"：保留签名改内容 → 拒绝；换密钥签发的值 → 拒绝；形状不对 → 拒绝而非抛错；
**没有 `AUTH_SECRET` 时不放行**（而不是"暂时不校验" —— 那是隔离静默消失的经典写法）；
空 organisationId 拒绝签发。

**一条被测试纠正的错误断言**：我最初写"`signTenant({organisationId:"org_other"})` 应验不过"，
它红了，**红得对，错的是那条断言** —— 服务端本来就有权为任意门店签发，那是它的职责。
安全性质是"**客户端造不出合法签名**"，不是"服务端签不出别的门店"。
真正要守的不变式是上面那条"只从候选里选"，已写进模块注释。

## 影响

**对现有行为零影响**：`active-tenant.ts` 目前**没有任何调用方**（已 grep 确认），
它是给 `/t/<slug>/login` 与多店选择器用的地基。唯一键**没有**改动。

## 验证

lint 退出码 0 · tsc 0 错误 · `pnpm test` 947 通过（83 文件）· `pnpm build` 通过 · Playwright 55 通过。

## 交接

下一轮直接从方案文档 §P3 的「P3b 施工单」第 1 步开始（先给注册匹配加租户条件），
**不要**跳过去先松唯一键 —— 那会在第 1 步完成前就打开隐患 ②。
