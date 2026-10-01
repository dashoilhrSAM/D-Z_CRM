---
date: 2026-10-01
title: P4 第三块（一）—— 租户停用/恢复 + 平台侧审计，且停用对已登录的人立刻生效
branch: feat/tenant-status
---

## 改动

P4 第三块的第一半：**租户生命周期里最急的那个动作** —— 停用/恢复。

1. **`PlatformAuditLog` 表**（跨租户、只增不改）：`actorAuthId` / `actorEmail` / `action` /
   `targetOrganisationId` / `detail` / `createdAt`。
   - **刻意不挂在租户表上**：退租删掉整家店之后，"谁在什么时候关了这家店"这条记录必须还在
     （有测试专门验这一点）。将来的"限时支持访问、双向留痕"也写这里。
2. **状态机 `setTenantStatus`**：只接受 `ACTIVE / TRIAL / SUSPENDED`；
   **状态没变就不写审计**（手抖点两次不该留下两条）；变了才写一条带原因与操作者的审计。
3. **停用必须"立刻生效"，而只挡入口是不够的** —— 这是本轮最要紧的一处：
   已经在店里的人手里握着会话，下一次请求照样能过。所以真正的强制点在
   **`identitiesForAuthUser`：非运营租户的身份被过滤掉**，
   于是被停用的人下一次请求就变成"没有业务身份"（回到登录/选择器），
   而登录侧的 `injectBizClaims` 也找不到身份，拿不到新 claims。
   - 配套：登录侧对"有 AuthLink 但那些店都被停用"给一句人话
     （"Your workshop is currently suspended…"），而不是含糊的"No D&Z account linked"——
     后者会让店主以为自己的账号丢了。
   - 多店的人只失去被停用那一家 ✅。
4. **`/platform/<slug>` 租户详情页**：状态、用量、门店链接/门店码、**平台侧审计轨迹**，
   以及停用/恢复表单（带原因）。停用/恢复的 server action **自己再判一次**管理员身份。
5. **测试 +10**（`tests/platform-tenant-status.test.ts`）。

## 影响

- 平台侧能立刻关掉一家店：入口不认它、**已登录的人立刻失去业务身份**、审计留痕；
  恢复之后一切照旧（`enter`/选择器/claims 都回来）。
- 退租之后审计仍在（为将来的"退租删除"留下了可追溯性）。

## 交接说明

**实测证据**：

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `pnpm test` | **1060 通过 / 94 文件**（1050 + 10） |
| `pnpm lint` | 退出码 0（830 warning / 0 error） |
| `pnpm build` + kickstart | 通过（新增 `/platform/[slug]`）/ 三服务 200 |
| Playwright | **55 通过** |
| UI 往返（一次性租户）：停用 | 页面刷新为 **SUSPENDED**、按钮变"恢复这家店"、审计出现 `TENANT_SUSPENDED` + 原因 |
| UI 往返：恢复 | 页面刷新为 **ACTIVE**、审计两条（`TENANT_SUSPENDED` + `TENANT_RESUMED`）都在、零控制台错误 |

**变异测试（都实测会红）**：
- `identitiesForAuthUser` 不过滤非运营租户（"只挡入口"的写法）→ 红 4 条，
  包括「**已经登录的成员下一次请求就失去业务身份**」。
- 去掉"状态没变不写审计"的短路 → 红 1 条（幂等性）。

**linter 抓到一个 error**：客户端表单里用了 `<a href="/platform">` →
`@next/next/no-html-link-for-pages` 是 **error 级**（不是 warning），已换成 `<Link>`。
这个门槛值钱：`pnpm lint` 的退出码是 CI 质量门的一部分。

**两次自己的测试坑（都记下来）**：
1. 夹具用了"每轮一个新 tag"，而假认证端口每轮生成**同一个** authId —— 变异跑挂在中途时
   走不到收尾，`healthy-*` 店一轮轮攒下来，下一轮 `identitiesForAuthUser` 看到 3、4 条身份，
   以"看起来像实现坏了"的方式红掉。改成**固定夹具命名空间 + 按命名空间清理**（自愈），
   连跑 3 次绿、零残留。
2. UI 冒烟第一次报"点了没反应"：其实是探针**等网络静默**太早，而 action 与页面刷新都正常
   （DB 里状态与审计都对）。改成**等状态文字变化**之后往返全绿 ——
   与"点击早于 hydrate"是同一类教训：**等状态变化，别等网络静默**。

### 下一步（P4 第三块剩下的）

限时支持访问（双向留痕）、按租户导出、退租删除、模板库。
