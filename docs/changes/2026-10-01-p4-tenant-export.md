---
date: 2026-10-01
title: P4 收尾 —— 按租户导出：把数据交给它自己（且不连同钥匙一起给）
branch: feat/tenant-export
---

## 改动

P4 的最后一件。定位先写清楚：**这是"把你的数据给你"，不是"可以拿回去恢复整套系统"的备份** ——
所以登录凭据（在 Supabase）与平台侧的表（租户目录/审计/模板/墓碑）都不在里面。

### 1. 行范围**复用退租那份计划**

`exportTenantRows` 逐模型 `findMany`，用的 `where` 就是退租删除用的 `PURGE_WHERE`
（scope map × DMMF 推出来的"这家店的行在哪"）。

**为什么必须复用**：导出少了行**不会报错**，只会让店主以为"我的数据就这些" ——
两处各写一份判定必然漂移，而漂移在这里是静默的。

### 2. 密钥类字段脱敏（这一块最要紧）

`User` 表里还留着历史遗留的 `passwordHash` / `mfaSecret` / `verifyToken` / `resetToken` /
`resetTokenExpiresAt`，`IntegrationConfig` 里是各家 provider 的凭据。
一份带着这些的导出，等于**把一家店的全部钥匙抄送出去**。

- `REDACTED_FIELDS`：`模型.字段` → 原因，命中就替换成 `[redacted]`（**保留字段本身**，
  只抹内容 —— 整列消失会让人以为这里本来就没有这个字段）。
- `PUBLIC_TOKEN_FIELDS`：列名像密钥、但**有意不脱敏**的（`qrToken` 印在门店/骑手二维码上，
  属于运营数据）。
- **守卫测试扫 schema**：任何列名含 `secret|password|token|credential|apiKey` 的列，
  必须在上面两张表之一里，否则红。第一次跑就抓到我自己漏掉的 `User.resetTokenExpiresAt`。

### 3. 双向留痕（与支持访问同一口径）

导出会在**平台侧**（`TENANT_EXPORTED`，带行数与脱敏字段数）与**租户自己的审计页**
（`TENANT_DATA_EXPORTED`）各写一条 —— 把一家店的数据交出去，两边都该知道。

### 4. 交付形态：route handler 直接下载

`GET /platform/<slug>/export` → `Content-Disposition: attachment; filename="tenant-<slug>-<时间>.json"`
+ `cache-control: no-store`（导出的是个人数据，别让中间层缓存）。

**为什么不是按钮 + server action**：导出是一份**文件**，需要 `Content-Disposition`
才能落进下载目录；server action 只能返回一个值，还得再想办法把它变成文件。
（另一个考虑：文件路径方案在生产没用 —— Vercel 的文件系统是临时的。）

守卫照旧**自己再判一次**：未登录 → 去登录（带 `next`）；登录了但不是管理员 → 404。

## 影响

- 店主要自己的数据时，平台侧有一条**正当、有限、留痕**的路径。
- 退租之前可以先导出（这也是"退租删除"该有的前置动作）。
- **不是备份**：不含登录凭据、不含平台侧数据；`meta.notes` 里把这两句写清楚了，
  免得有人拿它当灾难恢复用。

## 交接说明

**实测证据**：

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `pnpm test` | **1102 通过 / 98 文件**（1094 + 8） |
| `pnpm lint` | 退出码 0（830 warning / 0 error） |
| `pnpm build` + kickstart | 通过（新增 `/platform/[slug]/export`）/ 三服务 200 |
| Playwright | **55 通过** |
| 浏览器真下载一次（D&Z 真店） | 文件名 `tenant-d-z-smart-workshop-2026-10-01T06-30-51.json` ✅ ｜ **624 行 / 53 张表** ✅ ｜ `Organisation`/`Branch`/`Customer`/`ServiceJob` 都在 ✅ ｜ `meta.redactedFields` 含 `User.passwordHash` ✅ ｜ 正文里**没有未脱敏的 passwordHash 值** ✅ ｜ 零控制台错误 |
| 双向审计（真库） | 平台侧 `TENANT_EXPORTED · D&Z Smart Workshop（d-z-smart-workshop）· 624 行 · 脱敏 6 个字段` ✅ ｜ 租户侧 `TENANT_DATA_EXPORTED · test.owner@dz.my 导出了本店数据（624 行）` ✅ |

**变异测试（三条，都实测会红）**：
- 不脱敏（导原始行）→ 红 1 条，报错直接打出泄漏的哈希值。
- 登记表里删掉 `User.passwordHash` → 红 2 条（含结构守卫点名）。
- 把 `qrToken` 也当密钥（清空允许清单）→ 红 1 条（结构守卫列出三个 qrToken 列）。

**第二次撞上同一个 e2e 漂移（这次查清了机制）**：首次跑 e2e 又红了那两条考勤用例
（`待处置` 期望 1 实际 2）。`e2e.db` 的 punch 轨迹是
`IN OK (06:32:48)` → `OUT SUSPECT_REUSE (06:32:52)` → `IN NO_LOCATION (06:32:56)`：
**另一个 spec（attendance-punch）结束时把人留在"在岗"**，于是本 spec 的 `cleanState()`
先补一次下班 —— 而那张**合成照片与上一次相同**，被判成"照片复用"，
**这一条本身就是一个新的待处置异常**，队列于是变成 2。
`prisma migrate reset --force`（含 seed）+ 重启 e2e 服务后 55 全绿。
**这不是本次改动引起的**（导出只动了 `/platform` 路由），但它是**反复出现**的：
建议下一步把 review spec 的队列断言改成**相对量**（"比之前多 1"而不是"等于 1"），
或给 punch spec 加收尾 —— 队列本来就是工作队列，可能带着别的用例留下的条目。

**我自己踩的一个坑（值得记）**：做变异时用 `git checkout <file>` 撤销，而那个文件里还有
**未提交的新方法** —— 一撤销把 `exportTenantRows` 一起回滚了，于是整组测试报
`this.repo.exportTenantRows is not a function`（看起来像实现坏了，其实是实验手法坏了）。
**变异测试要用 `cp` 备份还原，不要用 `git checkout`**。

### P4 完成

开通（provisionTenant + CLI）｜ 管理员身份与平台台 ｜ 租户目录 ｜ 停用/恢复 + 平台侧审计 ｜
限时支持访问（双向留痕）｜ 退租删除（推导计划 + 墓碑）｜ 开通模板库 ｜ **按租户导出**。

**P4 四块全部完成**。接下来是 **P5（产品层去 branch）**。
