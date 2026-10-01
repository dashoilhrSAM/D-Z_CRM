---
date: 2026-10-01
title: P3b 第 5 步 —— 删掉死代码 dz_org，QR 门店码改走"只能从候选里选"的同一入口
branch: feat/tenancy-dz-org-cleanup
---

## 改动

施工单第 5 步的清理项。

1. **删掉 `src/actions/rider-context.ts`**。它的 `setWorkshopContext` 把表单里的
   `organisationId` / `branchId` **原样写进 `dz_org` / `dz_branch` 两个 cookie** ——
   既不签名、也**全项目没有任何地方读**。危害不是"多写了两个 cookie"，而是：
   它让签名 cookie（`active-tenant.ts`）看起来"这个项目已经有门店隔离了"，
   实际那行写等于没写，而且**接受客户端传什么就存什么**。
2. **QR 门店码页改走 `chooseWorkshop`**（原来唯一调用 `setWorkshopContext` 的地方）：
   与多店选择器**同一个入口** —— 取值来源只有 `identitiesForAuthUser(authId)` 的候选，
   表单里的 organisationId 只表示"他点了哪家店"，不代表"他有哪家店的权限"。
   同时带上 `next=/qr/workshop/<id>`，未登录时登录完能回到本页。
3. **两个 action 文件合并为 `src/actions/tenant-context.ts`**（`select-workshop/actions.ts`
   与 `rider-context.ts` 都删掉），`chooseWorkshop` 因此成了"写门店 cookie"的唯一入口。
4. **`User.email` → `@@unique([organisationId, email])`**：核对结论是**双 schema 都已写全**
   （`prisma/schema.prisma` 与 `schema.pg.prisma` 各一处），生产上也有该索引 —— 无需改动。
5. **新增守卫 `tests/tenant-cookie-source.test.ts`（4 条）**：
   ① `"dz_tenant"` 只在 `active-tenant.ts` 出现（正向对照：那里确实有）；
   ② `dz_org` / `dz_branch` 去注释后**零出现**；
   ③ `setActiveTenant(` 的调用点只在白名单里（`active-tenant.ts` 定义 + `app/t/[slug]/route.ts`
   + `actions/tenant-context.ts`）；
   ④ 两个入口都必须有"校验他确实有这家店"的代码指纹（`identitiesForAuthUser` / `planShopEntry`）。

## 影响

- **少了一个假的隔离入口**：门店 cookie 现在只有一处定义、一个写入口，且写之前必须过候选校验。
- QR 门店码的"确认进入"从**无效操作**变成真的有效（以前只写没人读的 cookie 然后跳首页）。
- 未登录扫码不再"假装成功"：会去登录并带 `next` 回到本页。
- 行为变化（有意）：`dz_org` / `dz_branch` 两个 cookie 不再被写。它们从来没被读过，
  所以没有任何功能依赖它们。

## 交接说明

**实测证据**：

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `pnpm test` | **1022 通过 / 91 文件**（1018 + 4） |
| `pnpm lint` | 退出码 0（830 warning / 0 error） |
| `pnpm build` + kickstart | 通过 / 三服务 200 |
| Playwright | **55 通过** |
| `/qr/workshop/<真实 qrToken>` | **200**，渲染出店名，且表单只有 `organisationId` + `next`（`branchId` 已去掉） |
| `/qr/workshop/nonexistent` | 404 |

**变异测试**：重新写一个 `store.set("dz_org", …)` 的入口 → 守卫立刻红并点名。

**踩坑（Python 版的老坑）**：用 `python3 - <<'PY'` 批量改文件时，字符串里出现 ASCII 双引号
写中文注释 → Python 直接 `SyntaxError`（脚本一行都没执行）。本项目在 TypeScript 侧记过这条，
这次轮到 Python —— **批量脚本里写中文一律用「」**。

### 下一步

- 第 6 步：claim 迁 `app_metadata`（P0 有意留下的 fail-closed 状态）。
- CI 的 4 个仓库 Secrets（配齐后"要真登录才走得到"的路径才有自动化 e2e）。
