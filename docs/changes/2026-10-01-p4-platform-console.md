---
date: 2026-10-01
title: P4 第二块 —— 平台管理员身份模型 + /platform 租户目录与开通表单
branch: feat/platform-console
---

## 改动

P4 第二块。上一块给了"开店"这个能力（CLI），这一块给它一个**有身份边界**的入口。

1. **平台管理员身份模型：新建 `PlatformAdmin` 表**（用户选定的方案 ①）。
   - `authId @unique` + `email`（只给运维看，**不参与鉴权**）+ `note`（为什么给）+ `createdBy` + `createdAt` + `lastSeenAt`。
   - **刻意不隶属任何组织**：`User.organisationId` 是必填，而平台管理员本来就不属于任何一家店 ——
     所以这不是 `User` 的一个角色，而是另一条轴上的东西。
   - **也刻意不进 `role-modules.ts`**：那张矩阵管的是"在**一家店**里能做什么模块"。
     混在一起的后果很具体 —— 下一个人会以为 OWNER 就等于平台管理员。
2. **守卫 `src/lib/platform/guard.ts`**（`server-only`）：只认 `PlatformAdmin.authId`。
   - 未登录 → 交回调用方去登录（带 `next`）；已登录但不是管理员 → **`notFound()`**，
     不确认这个路由存在（重定向到 /login 或 403 页面等于告诉全世界"这里有个平台台"）。
   - **每个 server action 自己再判一次**：layout 挡得住渲染，挡不住有人直接 POST 到 action。
3. **`/platform` 租户目录**（以 slug 为键）+ **`/platform/new` 开通表单**：
   - 目录列出店名/slug/状态/员工数/客户数/开通日期 + 门店链接与注册链接。
   - 表单走 `useActionState`，成功后**一次性**显示临时密码（不写进 URL、不进日志）。
   - 服务层 `listTenants()`（上一块已写）与 `provisionTenant()` 直接复用，页面里没有业务逻辑。
4. **`scripts/grant-platform-admin.ts`** —— "第一个管理员"只能从终端来（先有鸡还是先有蛋），
   页面里没有、也不该有授予入口。`--list / --email / --auth-id / --revoke`；
   **按邮箱授予是"只找不建"**（手滑打错一个字母会被拒绝，而不是悄悄造出一个账号）；
   远端库需要显式 `PLATFORM_ALLOWED=1`（判据是目标主机，与开通脚本同一套）。
5. **迁移** `20261001000000_p4_platform_admin`：手写（本仓 `prisma migrate dev` 不可用），
   照例**剥掉** `migrate diff` 顺带生成的 `ScheduledMessage` 重建块（历史假象 + 里面有 DROP TABLE）。
6. **测试 +12**（`tests/platform-admin.test.ts`）。

## 影响

- 平台台可用：管理员登录后 `/platform` 看租户、`/platform/new` 开店（含一次性临时密码）。
- **"在一家店里最大" ≠ "能跨店管理"**：租户 OWNER（乃至 SUPER_ADMIN 角色）都不是平台管理员，
  除非 `PlatformAdmin` 表里明确有他。
- 生产侧：`sync-prod-schema --check` 显示这是**纯新增**（`additive changes pending`），
  合并后由生产构建自动建表 —— 与 P3b 那次破坏性 DDL 不同，**不需要提前动生产**。

## 交接说明

**实测证据**：

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `pnpm test` | **1050 通过 / 93 文件**（1038 + 12） |
| `pnpm lint` | 退出码 0（830 warning / 0 error） |
| `pnpm build` | 通过（新增 `/platform`、`/platform/new`） |
| Playwright | **55 通过** |
| 匿名访问 `/platform` | **307 → `/login?next=%2Fplatform`** |
| 管理员（`test.owner@dz.my`，dev.db 里已授权） | `/platform` **200**：看到「租户（N）」表头与「D&Z Smart Workshop」；`/platform/new` 200 且有 slug 输入框；零控制台错误 |
| 非管理员（技师账号） | 落到 **not-found 边界**，页面里**没有任何租户数据** |
| CLI `--list` / 打错邮箱 / 远端护栏 | 三条路径逐一验过（打错邮箱被拒绝且不建号） |

**变异测试（三个关键守卫，都实测会红）**：
- `adminFor` 放宽成"登录即管理员" → 红 3 条（含**租户 OWNER 不是平台管理员**）。
- action 里删掉 `requirePlatformAdmin()` → 红 1 条（结构守卫点名"有入口没判身份"）。
- `grantAdminByEmail` 改成"找不到就顺手建号" → 红 1 条。
- （变异实验在 dev.db 留下一行假管理员，已清理；夹具清理也改成按 `test-plat-` 命名空间**自愈**。）

**被既有守卫抓到一次（第二次了）**：`tests/tenant-scope-map.test.ts` 要求 schema 里每个模型
都在租户作用域地图里登记 —— 新模型 `PlatformAdmin` 登记为
`{ kind: "none", reason: "平台管理员有意不属任何租户…" }`。

### 一个诚实的细节：非管理员的 HTTP 状态码

非管理员看到的是 not-found 页面，但**状态码可能是 200**（守卫在 layout 里做异步判定，
Next 的响应头那时已经发出去了）。安全上无碍（**没有任何租户数据**，也没有 403 宣告路由存在），
但如果你要"连状态码都不承认"，得上 middleware —— 而 middleware 跑在 edge，
Prisma 进不去，得改成在中间件里查一次 Supabase 或加一张边缘可读的名单。**本轮刻意没做。**

### 下一步（P4 第三块）

停用/恢复租户、限时支持访问（双向留痕）、按租户导出、退租删除、模板库。
另外**生产上线后需要先授一个平台管理员**（页面里没有入口）：
`PLATFORM_ALLOWED=1 pnpm exec tsx scripts/grant-platform-admin.ts --email <你的邮箱> --note "创始人"`。
