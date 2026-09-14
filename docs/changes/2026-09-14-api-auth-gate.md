---
date: 2026-09-14
title: API 层补门禁（/api/* 此前完全绕过 middleware）
branch: fix/api-auth-gate
---

## 改动

**审计实测的洞**：`src/middleware.ts` 的 matcher 只有 `/workshop/:path*`、`/rider/:path*`、
`/mechanic-app/:path*` —— **不含 `/api`**。于是所有 API 路由没有任何身份门禁：

```
$ curl -s "http://127.0.0.1:3202/api/export?type=customers" | head -2      # 不带任何 Cookie
name,phone,email,address,tags,source,joined
Test4,+6011222333,test4@gmail.com,,,,2026-08-28
```

`?type=products` 连**成本价**一起给，`/api/search?q=` 能搜出客户电话与车牌，
`/api/upload` 与 `/api/import/*` 可无鉴权**写入**。20 个路由里 **16 个**属于这一类。

四处改动：

1. **`src/middleware.ts`** —— matcher 加 `/api/:path*`；API 层改成**默认拒绝**：
   无会话 → 401 JSON；骑手（CUSTOMER）→ 403（他们走页面与 Server Action，不直接调 API）。
   公开名单显式且短：`/api/webhooks`（靠签名）、`/api/storage`（资源托管，公开页的图引用它）、
   `/api/cron`（靠 CRON_SECRET）—— 每一项都在代码里写了它靠什么鉴权。
2. **`src/lib/api-auth.ts`（新增）** —— `requireStaff()` 作为 API 层的统一入口。
   动机是审计发现的那条模式问题：授权逐 action 手写，同一个文件里常一半有一半无
   （`invoices.ts` 的 `setInvoiceDiscount` 有校验，同文件的 `settleInvoices`/`addInvoicePayment` 没有）。
   现在「每个非公开 API 路由都调用 requireStaff()」是一条**可 grep、可断言**的不变量。
3. **14 个路由 + 2 个原本就校验的路由**全部接入 `requireStaff()`（`jobs/[id]/photos` 顺手统一入口；
   `marketing/content` 原本只校验 `session.authenticated`——**骑手注册是开放的**，等于把花钱的
   内容生成端点向任何注册用户敞开，已收紧到 staff）。
4. **两处 fail-open 改成 fail-closed**：
   - `/api/cron/*`：旧写法 `if (secret) { …校验… }` —— 密钥缺失时整段鉴权被跳过，而这个端点
     会给真实客户群发 WhatsApp。现在没配密钥 → **503**（显式失败、监控可见），密钥不对 → 401。
   - `/api/webhooks/whatsapp`：旧写法 `if (APP_SECRET && signature)` —— 攻击者只要**不发**
     `x-hub-signature-256` 头，整段验签就被跳过，任何人可 POST 伪造 statuses 把任意
     `externalId` 的消息改成 DELIVERED/FAILED，污染送达率与 MSG-020 失败记录。
     现在：未配置 → 503；缺签名头 → 401；比较改**恒定时间**。
     附带修掉一个真实性 bug：**回执不再降级**（Meta 会重试且不保证顺序，一条迟到的 `sent`
     会把已 `READ` 的消息打回去）——用 `where` 条件表达「只许前进」，单条 SQL 原子完成，不需要先读。

## 影响

- 匿名访客不再能读取/写入任何业务数据；公开面收敛到 3 类（webhook / 静态资源 / cron）。
- 员工与机修端功能**行为不变**：实测带员工 Cookie 时 `/api/export` 仍 200（212,027 字节）、
  `/api/search` 仍 200、`/api/recommendations` 仍 200。
- 每个 API 请求多一次 `auth.getUser()`（middleware 里已有一次，路由内 `requireStaff()` 再确认一次）——
  这是刻意的纵深防御代价：**第一道用 JWT claims（快、但角色改动要重登才生效），第二道查 DB（权威）**。
- **向后兼容风险**：骑手端不调用任何 API（已 grep 确认），e2e 也不直接打 API（只在字符串里提到
  `/api/storage/...`，而它仍是公开的），所以没有已知的破坏面。

## 交接说明

- **验证**：tsc 0；vitest **449 通过**（新增 `tests/api-auth.test.ts` 10 条）；build 通过；
  全量 e2e 见下。实测（`:3202`）：6 个端点无 Cookie 全部 401；带员工 Cookie 全部照常；
  cron 无/错密钥 401、正确密钥 200；`/api/storage` 仍公开（404 对不存在的 key）；
  webhook 未配置 → 503。
- **守卫是反向验证过的**：把同一组断言跑在 `origin/main` 的代码上，**11/11 全部失败**，
  并量出「旧代码中缺门禁的非公开路由数 = 16 / 共 20」。
- **踩到的自家坑（值得记）**：第一版守卫测试断言 `not.toMatch(/if \(secret\)/)`，
  结果匹配到了**我自己写在旁边的注释**（「旧的 `if (secret)` 写法…」）→ 测试红了。
  修法是断言前先剥注释：注释里会描述旧写法，守卫必须只看代码。
- **没做、留给下一批**：业务内的**归属与分行**校验（rider actions 的 IDOR、发票/薪资写入、
  员工管理的角色白名单）。这一批只解决「你是谁、是不是员工」，也就是把门关上；
  「能不能动这一行数据」仍要逐处补（见审计记录的批次 2–4）。
- **可选跟进**：`/api/storage` 目前是公开资源托管（key 不可猜但可枚举风险未知）。要更严可改签名 URL。
