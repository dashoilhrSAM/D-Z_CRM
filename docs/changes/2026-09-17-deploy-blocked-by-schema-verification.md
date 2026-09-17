---
date: 2026-09-17
title: 两次生产部署都失败——护栏在起作用，真正卡住的是 DIRECT_URL
branch: docs/deploy-blocked-by-schema-verification
---

## 改动

**没有改任何代码。** 这是一份事故诊断，记下来是因为它容易被误读成「刚合的分支把部署弄挂了」。

2026-09-17 11:02–11:03，owner 合并 PR #29（schema 护栏）与 PR #30（考勤 P2）后，**两次生产部署都 Error**，
耗时 23s / 24s（正常部署是 1–4 分钟），命令停在
`prisma generate --schema prisma/schema.pg.prisma && node scripts/sync-prod-schema.mjs && next build`。

## 诊断（每条都是本地实测，不是推断）

**1. 先确认线上没事。** 失败的部署不会覆盖线上：`https://d-z-crm.vercel.app/` 仍是 **200**，
跑的是**上一个可用版本 e86d7f4**（HRM 考勤 P1）。也就是说 **P2 与护栏都还没上线**，main 上有提交 ≠ 线上跑的是它。

**2. PR #29（护栏）的 schema 与生产库本来就是 agree。** 把该 commit 的 `schema.pg.prisma` 抽出来跑只读 diff：

```
npx prisma migrate diff --from-url "$DST_DATABASE_URL" --to-schema-datamodel <(git show ba995bf:prisma/schema.pg.prisma) --script
→ statements: 0
```

**0 条语句。** 这条很关键：如果构建能读到库，脚本会打印"schema and database agree"然后正常结束——
它**不可能**因为"有待应用的变更"而失败。所以失败发生在**检查本身**。

**3. 复现失败。** 用生产环境变量跑同一条脚本、给一个连不上的库：

```
VERCEL_ENV=production DATABASE_URL="postgresql://postgres:x@127.0.0.1:59999/postgres" node scripts/sync-prod-schema.mjs
[schema-sync] database from DATABASE_URL | timeout 120s per command
[schema-sync] could not inspect the database (…)
[schema-sync] In production this fails the build on purpose: we could not verify that
[schema-sync] the database matches the schema …
--- exit code: 1 ; elapsed: 0s ---
```

**<1 秒就 exit 1**，且第一行是 `database from DATABASE_URL` —— 这正是 Vercel 构建里发生的事：
`DIRECT_URL` 在 **Production** 环境没生效，于是回落到池化的 `DATABASE_URL`（Supabase :6543 / pgbouncer），
而 Prisma 的 migrate 命令需要直连，连接失败 → 护栏按设计拦住构建。

**4. PR #30 是同因，不是它的 schema 有问题。** 它的 diff 是 **13 条纯加性语句**（新建 `AttendanceReview` + 3 索引 + 1 外键，
**0 条 DROP**），本来会被自动应用。它连到"应用"那一步都没走到——检查先挂了。

## 影响

- **护栏是对的，它在做自己该做的事。** 以前同样的"连不上"是 **fail-open**（打印一句 skipping 就继续构建），
  于是构建成功、schema 没验证、上线、整站 500 —— 就是 2026-09-15 那次事故的病因。现在它把这条路堵死了。
  代价是：**环境配置不对时，生产会完全无法部署**。这个代价是 owner 明确选过的。
- **生产数据与线上服务都没有受影响**（旧部署继续服务，`/` 200）。
- **卡点只有一个**：Vercel → `d-z-crm` → Settings → Environment Variables → **Production** 加
  `DIRECT_URL` = 本地 `.env` 里 `DST_DATABASE_URL` 的值（**5432 直连**，不是 6543 池化），然后 redeploy。
  加好后 Build Logs 里搜 `[schema-sync]`，第一行应为 `database from DIRECT_URL`。

## 交接说明

- **不要再花时间试图在线读 Vercel 构建日志**：`vercel inspect --logs` 与 REST `/v3/deployments/<id>/events` 都是 404，
  `vercel env ls` 报项目已删除/已转移（`.vercel/project.json` 里的 `orgId` 属于另一个团队）。
  可行路径只有两条：**本地复现**（脚本本身可以在本地用假 URL 跑出同一条失败路径）+ **让 owner 贴日志**。
- **一条只读的"这条分支能不能部署"预检**：
  `git show <branch>:prisma/schema.pg.prisma > /tmp/b.prisma` 然后
  `npx prisma migrate diff --from-url "$DST_DATABASE_URL" --to-schema-datamodel /tmp/b.prisma --script`，
  最后数一下破坏性语句。**这条立刻抓出第二个雷**：
- **⚠️ `fix/job-number-sequence` 在修好 DIRECT_URL 之后照样会失败，而且原因完全不同**：
  它是在 HRM 之前分出去的（stale），拿它的 schema 去比生产库会得到 **16 条语句、16 条全是 DROP/TRUNCATE**
  （`ALTER TABLE "AttendancePunch" DROP CONSTRAINT …`、`DROP COLUMN "workedMinutes"`、`DROP TABLE "AttendancePunch"` …）。
  护栏会拒绝应用并 exit 1。**这不是 bug，是护栏在阻止生产库被清空**；正确做法是**先把它 rebase 到 main**。
- **看部署耗时能定位失败段**：`prisma generate` 本地只要 1.1s，护栏的失败路径 <1s，而成功的部署要 1–4 分钟。
  20 秒左右失败 = 还没走到 `next build`。
- **判断顺序建议**：先看「下一步」第 1 条那条阻塞在不在 → 再看部署是否 Ready → 最后才怀疑代码。
  这次两次失败**一行应用代码都不该改**。
