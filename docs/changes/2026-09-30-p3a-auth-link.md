---
date: 2026-09-30
title: P3a 身份映射（AuthLink）—— 让「customer 不共用」在数据模型上成立
branch: docs/perf-load-results
---

## 这一轮解决的是哪件事

owner 的要求里有一条是 **"customer 也不会公用"**。今天它在数据模型上**根本表达不出来**：
`User.authId` / `Customer.authId` 都是**全局唯一**，意味着

> 一个自然人 = 全世界只能有一个客户档案。

同一个人在两间 workshop 都是客户 —— 这是真实世界里必然发生的事 —— 现在无处安放。
P3a 把这件事拆成两层，让它成立：

```
一个自然人 = 一个 Supabase auth 账号（邮箱/手机在项目内唯一，这是 Supabase 的现实）
他在 N 家店 = N 条 AuthLink + N 个业务主体（N 个 User 或 N 个 Customer）
```

**跨店共享的是登录凭证，不是客户数据。** 两家店的客户档案互不可见，
同一个人要在两家店各留一次资料 —— 这才是"不共用"的正确形状。

## 改动

### 1. `AuthLink` 表（新，纯加法）

- `prisma/migrations/20260930220000_p3a_auth_link/` —— 只建一张新表，**不改任何既有列**，
  所以生产上随构建的 schema-sync 自动应用，不需要人工 DDL（已手工应用以保持无待应用项）。
- 四条约束各有用途，不是"多写几条更安全"：
  · `@@unique([authId, organisationId])` —— 一人一店一条，是解析"他在本店是谁"的唯一依据；
  · `@@unique([organisationId, kind, userId])` / `...customerId` —— 一条业务身份只能被一个
    auth 账号认领（否则两个人共享同一个客户档案，比"不共用"更糟）；
  · `@@index([authId])` —— 反查"这个人属于哪几家店"，登录时的多店选择器要用。

### 2. `src/lib/tenant/identity.ts`（新）

三条解析路径，对应三个不同场景：

| 函数 | 场景 | 说明 |
| --- | --- | --- |
| `identityInTenant(authId, orgId)` | **已知门店**（登录页带门店、骑手扫码进来） | 查不到返回 `null`，**不回退到"跨店找唯一一条"** —— 那正是串店的入口 |
| `identitiesForAuthUser(authId)` | **不知道门店** | 列出全部；0 条 → 提示注册，1 条 → 直接进，≥2 条 → 必须让用户选 |
| `linkIdentity(...)` | 开通员工 / 骑手注册 / 扫码绑定 | upsert 幂等；STAFF 必须给 `userId`、CUSTOMER 必须给 `customerId` |

`needsTenantChoice()` 把"≥2 条"这个判断单独拿出来，是为了让调用方一眼看到
**这是必须处理的正常情况**，而不是可以忽略的边界。

### 3. 回填

- 本地：`scripts/backfill-tenant-columns.ts` 扩展了一段（幂等 upsert），并加了对照断言
  ——"有 authId 的员工/客户数"必须等于"对应 kind 的 AuthLink 数"，不等就报错退出。
  实测 dev.db：18 条（16 员工 + 2 客户）。
- 生产：`scripts/apply-p1a-production.mjs --phase=authlink`（原生 SQL —— 本机 Prisma client
  是 SQLite 的，连不上 PG）。实测生产 **20 员工 + 4 客户 = 与有 authId 的账号数完全一致**。

### 4. 测试（`tests/tenant-identity.test.ts`，10 条）

最关键的一条是**"同一个 authId 在两家店各有一个客户档案，两条映射可以共存"** ——
这正是旧列做不到、而 P3b 会去松开那两个唯一键的理由。
以及"已知门店解析到本店那一个（不是随便哪一个）"、"不知道门店时明确要求选择"、
"别家门店查不到（不泄漏存在性）"、"重复绑定不产生第二条"。

## 影响

- **对现有行为零影响**：新表还没有任何消费方，`identity.ts` 也还没有被调用。
  这一轮是铺地基，不是改行为。
- 生产 schema 与 `schema.pg.prisma` 一致（`--check` 通过）。

## 交接说明

**P3b 要做的（这一轮刻意没做）**：
1. **松开 `User.authId` / `Customer.authId` 的唯一约束** —— 这是"同一个人两家店"真正落地的开关。
   注意届时 `findUnique({ where: { authId } })`（`session-user.ts:40/45`、`rider-customer.ts:14`、
   `auth-supabase.ts:26/39`）全部要改成 `identityInTenant(...)`，共 5 处。
2. **登录入口带租户**：`/t/<slug>/login`，配一个**签名 cookie**（`dz_tenant`），
   替换今天那个客户端可随意填、又没人读的 `dz_org`。
3. **多店选择器**：`needsTenantChoice()` 为 true 时必须让用户选。
4. **claim 迁到 `app_metadata`**：P0 把 `app_jwt_claim()` 改成只认 `app_metadata`（因为
   `user_metadata` 用户自己就能改），于是 PostgREST 面现在一律拒绝 —— 要等
   `injectBizClaims` 改写到 `app_metadata` 才会重新对合法用户开放。

**这一轮自己的失误**：又在 TypeScript 字符串里嵌了 ASCII 双引号（测试标题），
导致文件语法错误。这是本次会话第四次同类错误 —— 中文标题里一律用「」。
