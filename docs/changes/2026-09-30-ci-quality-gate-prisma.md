---
date: 2026-09-30
title: CI quality 门从来没真正跑过 —— 补 prisma generate + migrate + seed
branch: docs/perf-load-results
---

## 改动

`.github/workflows/ci.yml` 的 `quality` job（Lint · Typecheck · Unit）在 `pnpm install` 之后
补三步：`prisma generate` → `prisma migrate deploy` → `pnpm db:seed`，并给后三步与 `pnpm test`
带上 `DATABASE_URL: "file:./dev.db"`。

## 影响

**这个门此前从未验证过任何东西**（它一直是红的，但红的原因与被测代码无关）：

1. **`tsc --noEmit` 以 100+ 条 `TS7006 Parameter implicitly has an 'any' type` 失败。**
   根因是 CI 里从没跑过 `prisma generate`：没有生成的 client 类型，全仓 `db.*` 调用退化成
   `any`，回调参数全是隐式 any。**而 `Production Build` job 是绿的** —— 因为
   `build` 脚本是 `prisma generate && next build`，它自己 generate 过了。
   两个 job 的差别正好就是这一条，这也解释了为什么这个门红着却一直看不出原因。
2. 即使补上 generate，`pnpm test` 也跑不了：CI 是干净 checkout，没有 `dev.db`、没有
   `DATABASE_URL`。实测：空库 1 条红（`service-catalogue` 期望的 6 条历史老服务为 0）；
   只 migrate 不 seed 同样红。migrate + seed 之后 **971/971 全绿**。

修完后 `quality` job 才第一次真正把 lint / tsc / 971 条单测跑起来 —— 这才是"合并前的门槛"。

## 交接说明

**实测（本地完整复刻 CI，无 `.env`、全新库）**：

```
prisma generate      → ok
prisma migrate deploy → All migrations have been successfully applied
pnpm db:seed          → Seed complete {orgs:1, customers:103, jobs:164, ...}
tsc --noEmit          → exit 0
pnpm test             → 85 files / 971 passed
```

复刻方式（注意把 `.env` 移开再跑，否则本地 `.env` 会把环境补全，看不出 CI 的真实情况）：

```bash
mv .env /tmp/env.away && trap 'mv /tmp/env.away .env' EXIT
export DATABASE_URL="file:/tmp/ci-dev.db"
pnpm exec prisma generate && pnpm exec prisma migrate deploy && pnpm db:seed
pnpm exec tsc --noEmit && pnpm test
```

**未修的部分（有意留着）**：`e2e` job 仍会红 —— 它需要仓库 Secrets
（`AUTH_SECRET` + Supabase 三个 key），这个只有 owner 能在 GitHub Settings 里配。
它的 `e2e/global-setup.ts` 自己会 wipe + migrate + seed，所以 DB 侧不缺东西。

**踩坑提醒**：把 `DATABASE_URL` 指到临时库跑测试时，**同一个库不能连跑两次** ——
测试会写库，第二次跑会因为上一轮残留而假红（实测第二次 2 条红，而干净库是同一条都不红）。
