---
date: 2026-10-01
title: P4 第一块 —— 开店能力 provisionTenant（服务 + CLI），管理台留到第二块
branch: feat/platform-provision-tenant
---

## 改动

P4 的第一块：**把"能隔离"变成"能开店"**。P4 原计划是一整套平台管理台
（`/platform/*` + `PLATFORM_ADMIN` + 租户目录 + 停用/恢复 + 支持访问 + 导出 + 退租 + 模板库），
这里**只做地基里最硬的那件事**：一家店能被正确地开出来。

1. **`PlatformService.provisionTenant()`**（`src/modules/platform/service.ts`）——
   分层按 AGENTS.md：`UI → Service → Repository → Adapter`。
   一次开通要把四件事同时做成，缺一件都是半成品：
   - `Organisation`（`slug` 是它的运营句柄：`/t/<slug>`、备份/导出命名、日志）
   - 唯一 `Branch`（P5 之前产品仍需要一条主店记录）
   - 店主 `User` + **Supabase auth 账号**
   - **`AuthLink`** ← P3b 之后"这个人属于哪几家店"的唯一事实来源。
     少了它，店主登录后会落到"没有业务身份"，而且**报错与真实原因无关**。
   外加默认配置：服务目录 4 条、线索来源 5 条、线索阶段 5 条、消息模板 3 条、
   预约时段 28 个（7 天 × 4 时段）、主库位 1 个 —— 否则新店进去是空壳。
2. **顺序是刻意的：先 auth、后业务行**。反过来（先建组织再建 auth）一旦 auth 失败，
   库里就留下一家"存在但没人登录得进去"的店 —— 这种半成品运维只能靠肉眼发现。
   反过来失败只留下一个没人用的 auth 账号（无害且可复用）。
   业务行全部在**一个事务**里（`PrismaPlatformRepository.provision`），任何一条失败整块回滚。
3. **CLI `scripts/provision-tenant.ts`**（运维实际会用的入口）：
   - **默认 dry-run**，`--yes` 才写；建完打印一段可直接转发的文本
     （开通链接 `/t/<slug>`、门店码 `/qr/workshop/<token>`、店主邮箱、一次性临时密码）
   - **护栏判据是目标主机而不是 `NODE_ENV`**：本仓 `.env` 里就放着生产 Supabase 连接串，
     在本地终端跑时 `NODE_ENV` 仍是 development，但 `--yes` 会直接写生产。
     现在只要目标不是本地库就要求显式 `PROVISION_ALLOWED=1`（开发时 dry-run 打印
     `db.<ref>.supabase.co` 就是活生生的例子 —— 这个坑是**跑的时候发现的**）。
4. **拿掉了两个"脚本 import 不了"的障碍**（都是真实撞上的，不是预防性重构）：
   - `src/lib/auth/phone-identity.ts` 带 `import "server-only"`（**那是对的**：service role
     的代码不能进客户端），但它同时意味着任何纯 Node 脚本都 import 不了它。
     于是按分层约定把 Supabase Auth 收进 **provider 端口** `src/providers/auth-admin.ts`
     （`AuthAdminPort`），service 只依赖接口 —— 顺带让测试能注入假实现。
   - `src/lib/qr-token.ts` 同样带 `server-only`。把里面的**纯函数**提到
     `src/lib/random-token.ts`（无副作用、无守卫），`qr-token.ts` 保留守卫并复用它。
     **不是放松守卫**：QR token 的安全性来自"服务端签发 + 库里比对"，
     客户端自己生成一个随机串拿不到任何权限。
5. **测试 +12**（`tests/platform-provision-tenant.test.ts`）—— 见下。

## 影响

- **今天就能开第二家店**：`pnpm exec tsx scripts/provision-tenant.ts --name … --slug … --owner-email …`。
  无需改脚本、无需手工插库、无需记得补 AuthLink。
- **同一个人可以同时属于多家店**：用同一个邮箱开第二家店会**复用** auth 账号、
  新增一条 `AuthLink`、**不改他的密码**，并提示"他登录时会看到门店选择器"（P3b 的正常行为）。
- **P3b 的入口链立刻对新店生效**：开通完 `/t/<slug>` 就认得这家店，店主点进去直接进得去
  （这条有断言，见下）。
- 平台管理台（`/platform/*`）与平台管理员身份模型**仍未做** —— 下一步。

## 交接说明

**实测证据**：

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `pnpm test` | **1038 通过 / 92 文件**（1026 + 12） |
| `pnpm lint` | 退出码 0（830 warning / 0 error） |
| `pnpm build` + kickstart | 通过 / 三服务 200 |
| Playwright | **55 通过** |
| CLI：非法 slug / 保留字 | ❌ 明确报错（并列出保留字） |
| CLI：slug 被占 | ❌ `slug "d-z-smart-workshop" 已被「D&Z Smart Workshop」占用` |
| CLI：远端目标 | ❌ `目标库不是本地库（db.<ref>.supabase.co:5432）—— 请显式设置 PROVISION_ALLOWED=1` |
| CLI：本地目标 dry-run | ✅ 校验通过 + `**没有写任何东西**` |

**这个测试证明的四件事**（Supabase 打桩、其余真实数据库）：

1. **开出来的店是完整的**：Organisation + 唯一主店（`isMain`）+ 店主（带 authId）+
   **AuthLink** + 默认配置（服务/来源/阶段/模板/时段/库位逐项断言条数）。
2. **开完就能走 P3b 的入口链**：`resolveEntryTenant({slug})` 认得新店、
   `planShopEntry(店主authId, slug)` 直接返回 `enter` → `/workshop/dashboard`。
   ← 这是 P3b × P4 的接缝，也是最容易"看起来做完了其实没通"的地方。
3. **失败不留半成品**：slug 被占 → 拒绝且组织总数不变；非法 slug/保留字/邮箱格式错在纯校验阶段挡掉。
4. **跨店**：同邮箱开第二家店 → 复用 auth 账号、不发新密码、两条 AuthLink、给出选择器提示。

**变异测试（实测会红）**：把 `AuthLink` 写入从仓储里删掉 → 3 条红，其中包括
「**店主点自己的开通链接 → 直接进店**」。也就是说这条断言真的在守"开通是否算完成"。

**被既有守卫抓到一次（好事）**：`tests/tenant-isolation-guards.test.ts` 要求
`organisation.create` 那一行**显式**出现 `slug`（平台台/备份命名/日志都以它为键），
而我最初把整个 organisation 输入塞在 `rows.organisation` 里，文本上看不见。
修法不是绕开守卫，而是把 `slug` 提到 `ProvisionTenantRows` 顶层、
并把 organisation 输入类型 Omit 掉 slug —— **类型层面杜绝两处 slug 不一致**。

### CI 抓到的第一个问题（值得单独记）

第一版测试是 mock `@supabase/supabase-js` 的 —— **本地全绿、CI 红 7 条**，
原因是 `AuthAdminPort` 的真实实现先检查 `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`，
而本机有 `.env`、CI 没有。**这正是把 Supabase Auth 抽成端口的意义**：
测试改为注入假端口（零 env 依赖），provider 自己的建号/复用逻辑单独一组测试、显式 stub env。

顺带在修的过程中又踩到一个方向相反的坑：那组 provider 测试里模拟"缺 env"用的是
`vi.unstubAllEnvs()` —— 在**有 `.env` 的机器上它会把真值恢复回来**，于是这条例外
"本地绿、CI 才真"。改成显式 `stubEnv(..., "")` 之后两边一致（现在
`NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= pnpm test` 全绿 = 与 CI 同条件）。

**教训**："本地绿"必须用**把本地便利条件拿掉**的方式复验一次（清 env、清 `.env`、清缓存），
否则测的是"我的机器"而不是"这套代码"。

### 顺手修掉的两颗"测试隔离"地雷（同一条教训的正反面）

1. **别人的**：`tests/invoice-number.test.ts` 的 `YEAR = 2099`，`afterAll` 按
   `startsWith("DZ-2099-")` **全局**删发票 —— 而 `tests/tenant-uniqueness.test.ts` 的夹具
   发票号正是 `DZ-2099-00001`（两边都挑 2099 避开真实年份）。本地 `fileParallelism` 打开时
   谁先跑完 cleanup 就删掉对方的行 → 对方红在 `expected 1 to be 2`，
   **而且只在本地红、CI 绿**（CI 的 fileParallelism 是关的）。已按本文件的租户收窄。
   （诚实说明：症状签名完全吻合 —— 只有发票行消失、同夹具的车/工单/客户都完好，
   而全项目只有这段代码按该前缀全局删；但单跑与全量各试一次都没能**确定性复现**，属时序竞争。）
2. **我自己的**：`tests/platform-provision-tenant.test.ts` 用 `db.organisation.count()`（全表）
   比较前后值 —— 同一个并行环境里别的文件同时在增删组织，于是它自己变成偶发红
   （紧接着的全量跑就红了 2 条）。已改成按夹具自身范围断言（按 slug/name 查，而不是数总数）。

**两条合起来就一句话**：**测试只能删、也只能断言自己造的行**。

### 下一步（P4 第二块）

1. **平台管理员身份模型**（需要你定）：`PLATFORM_ADMIN` 不隶属任何组织，
   而 `User.organisationId` 是必填 —— 所以要么
   ① 新建 `PlatformAdmin { authId @unique, email, note, createdBy }` 表（显式、可审计、与租户角色矩阵解耦），
   ② 用环境变量白名单 `PLATFORM_ADMIN_EMAILS`（零 schema 变更，但改名单要重新部署）。
   我倾向 ①。
2. `/platform/*` 租户目录（`platformService.listTenants()` 已经写好）+ 开通表单（复用本轮的 service）。
3. 停用/恢复、限时支持访问（双向留痕）、按租户导出、退租删除、模板库。
