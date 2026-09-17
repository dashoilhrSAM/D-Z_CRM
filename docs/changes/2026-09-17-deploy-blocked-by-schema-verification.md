---
date: 2026-09-17
title: 生产部署全挂——根因是 Supabase 直连主机只有 IPv6，Vercel 构建够不着
branch: docs/deploy-blocked-by-schema-verification
---

## 改动

**没有改应用代码。** 这是一份事故诊断。

2026-09-17，owner 合并 PR #29（schema 护栏）与 PR #30（考勤 P2）后，**生产部署连续失败**
（23s / 24s，正常 1–4 分钟），命令停在
`prisma generate --schema prisma/schema.pg.prisma && node scripts/sync-prod-schema.mjs && next build`。

## 根因（一句话）

`db.dukbfgqbrprivnzcsrlh.supabase.co` **没有 A 记录，只有 AAAA**（`2406:da18:1248:be01::e7c4`，AWS ap-southeast-1）。
本机有 IPv6 所以一切正常，**Vercel 的构建环境出站只有 IPv4**，于是连不上库 → 护栏 fail-closed → exit 1。

这条同时解释了另外两件一直没被看清的事：

- **为什么"本地全绿"**：我在这台机器上跑的每一次 `migrate diff` / `--check` 都走 IPv6，全部成功——
  所以本地永远复现不出来，这也是我第一轮把它误判成「DIRECT_URL 没设」的原因。
- **为什么构建期自动同步其实从来没成功过**：2026-09-15 那次事故是靠**在本地手工执行**
  `VERCEL_ENV=production DIRECT_URL=$DST_DATABASE_URL node scripts/sync-prod-schema.mjs` 修好的（HANDOFF 有记录），
  不是构建自己修的。也就是说这个功能自引入起一直是「连不上 → 打印一句 skipping → 继续构建」（fail-open），
  每一次 schema 变更都是人手工补的。**护栏只是把这份长期存在的静默变成了响亮的失败。**

## 实测证据（每一条都可复现）

1. **线上没事**：失败部署不覆盖线上，`https://d-z-crm.vercel.app/` 仍 **200**，跑的还是 **e86d7f4**。
   main 上有提交 ≠ 线上跑的是它。
2. **PR #29 的 schema 与生产库本来就 agree**（只读 diff = **0 条语句**）。所以失败不在「有待应用的变更」，
   而在**检查本身**——这一点排除了「刚合的分支把 schema 弄脏了」。
3. **本地复现护栏的失败路径**（假 URL，<1s，输出与线上一致）：
   `VERCEL_ENV=production DATABASE_URL="postgresql://postgres:x@127.0.0.1:59999/postgres" node scripts/sync-prod-schema.mjs` → exit 1。
4. **DNS 定性**：`dig A db.<ref>.supabase.co` → **空**；`dig AAAA` → `2406:da18:...`；
   Python `getaddrinfo(AF_INET)` 直接抛 `nodename nor servname provided`。
5. **替代路径实测可用**：`aws-0-ap-southeast-1.pooler.supabase.com:5432`（Supavisor **会话模式**）
   有 IPv4，用 `postgres.<ref>` 账号 + 同密码 `prisma migrate diff` → **exit=0**；
   再做了一次 DDL 探针（`CREATE TABLE "_dz_probe"` → `DROP TABLE`，都是 exit=0），
   复验 diff 仍是 13 条纯加性、**探针无残留**。
   （另一处 `aws-1-ap-southeast-1` 报 `tenant/user postgres.<ref> not found`，所以区域要对。）

## 修复

Vercel → `d-z-crm` → Settings → Environment Variables → **Production**：

```
DIRECT_URL = postgresql://postgres.dukbfgqbrprivnzcsrlh:<密码>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

三个都要对上：**用户名是 `postgres.<project-ref>`（不是 `postgres`）**、主机 `aws-0-ap-southeast-1.pooler.supabase.com`、端口 **5432**。
Supabase Dashboard → Settings → Database → Connection string → **Session pooler** 就是这一段。

⚠️ **另一个坑（与本次无关但会浪费一整轮）**：Supabase 文档模板里写的是
`postgresql://postgres:[YOUR-PASSWORD]@...`，**`[YOUR-PASSWORD]` 是占位符不是密码**。
原样存进去会得到 `P1000 Authentication failed`，同样表现为 `could not inspect the database`，
与 IPv6 连不上在构建日志里**长得一模一样**。两个都修对才行。

## 影响

- 生产数据与线上服务均未受影响（旧部署继续服务）。
- **解锁前 main 上任何部署都会失败**（护栏已上线）；解锁后 P2 的 `AttendanceReview` 表由构建期自动建。
- 顺带暴露：`scripts/sync-prod-schema.mjs` 的 `looksPooled()` 把**会话池**（5432，实测可用）
  与**事务池**（6543，migrate 会挂）一视同仁，会打印一条「请改用直连地址」的警告——
  而对这个项目来说直连地址恰恰是连不上的。已另起分支修正（`fix/schema-sync-pooler-warning`）。

## 交接说明

- **别再试图在线读 Vercel 构建日志**：`vercel inspect --logs` 与 REST `/v3/deployments/<id>/events` 都 404，
  `vercel env ls` 报项目已删除/已转移（`.vercel/project.json` 的 `orgId` 属于另一个团队）。
  可行路径只有「本地复现 + 让 owner 贴日志」。
- **判断一条分支能不能部署（只读，不用真部署）**：`git show <branch>:prisma/schema.pg.prisma > /tmp/b.prisma`
  再 `npx prisma migrate diff --from-url "$DST_DATABASE_URL" --to-schema-datamodel /tmp/b.prisma --script`，
  数一下 `DROP|TRUNCATE`。**这条立刻抓出第二个雷**：
- **⚠️ `fix/job-number-sequence` 修好 DIRECT_URL 后照样会失败，原因完全不同**：它是 HRM 之前分出去的 stale 分支，
  拿它的 schema 比生产库 = **16 条语句、16 条全是 DROP/TRUNCATE**（`DROP COLUMN "workedMinutes"`、
  `DROP TABLE "AttendancePunch"` …）。护栏会拒绝并 exit 1。**这不是 bug，是护栏在阻止生产库被清空**；
  正确做法是**先 rebase 到 main**。
- **看部署耗时能定位失败段**：`prisma generate` 本地 1.1s、护栏失败路径 <1s，成功部署要 1–4 分钟。
  20 秒左右失败 = 还没走到 `next build`。
- **判断顺序**：先看 DIRECT_URL 这条 → 再看部署 Ready 与否 → 最后才怀疑代码。这次两次失败**一行应用代码都不该改**。
