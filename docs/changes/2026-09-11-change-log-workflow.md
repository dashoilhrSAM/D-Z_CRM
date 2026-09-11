---
date: 2026-09-11
title: 改动记录改为一次一个文件（消除文档冲突）
branch: fix/rider-off-news-leak
---

## 改动

新增 `docs/changes/` 约定：每次改动新建一个文件，不再往 `docs/SETUP_AND_PREPARATION.md` §9 台账和
`docs/HANDOFF.md` 顶部插入条目。这两处**冻结**为历史。

新增 `scripts/new-change.mjs`（`pnpm new:change <名字>`）生成条目骨架；新增 `tests/docs-changes.test.ts`
守住这条规矩。

## 影响

两条分支同时打开时，合并不再因为文档冲突卡住。

## 交接说明

**根因**：不是谁不小心，是结构问题——一份共享文件里的同一处位置，天然只能容纳一条分支的改动。两条分支都往
台账顶部插一行、往 HANDOFF 顶部插一段，合并时两边改的是同一批行，必然冲突。这个冲突已经发生两次
（`feat/invoice-manual-discount`、`fix/rider-off-news-leak`），每次都要「取 main 版本 + 按锚点把自己的条目插回去」，
重复劳动且有抄错风险。

**解法**：一次改动一个文件。两条分支新建的是**不同文件**，git 因此永远不会冲突。

**冻结的判定**：`tests/docs-changes.test.ts` 里有一个 `FROZEN_AT` 常量。§9 台账里最新的日期不得超过它；
超过就说明有人又往冻结区写东西了，测试会失败并提示改用 `pnpm new:change`。

**踩过的坑（供以后处理类似冲突时参考）**：
- `docs/SETUP_AND_PREPARATION.md` 里有 **7 张表共用同一个 `| --- | --- | --- |` 分隔行**（第 12/32/58/139/155/232/255 行）。
  按分隔行定位台账会把新行插进「1.1 前置要求」表（Node.js/pnpm 那张）——**必须锚定台账自己的表头 `| 日期 | 改动 | 影响 |`**。
- 解决冲突时不要手抄条目：用 `git show <自己的commit>:<path>` 把原文抽出来再插回，避免抄错。
- 合并 `origin/main` 后如果 main 带了 schema 变更，**必须 `pnpm exec prisma generate`**：类型里会出现
  `Property X does not exist` 这类报错，那是生成的 client 过期，不是代码错。
