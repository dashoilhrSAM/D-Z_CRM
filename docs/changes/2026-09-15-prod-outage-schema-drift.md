---
date: 2026-09-15
title: 生产事故：新代码上线了、schema 没同步，整站 500（以及构建为什么没拦住）
branch: fix/schema-drift-fails-the-build
---

## 事故

owner 报告生产页面白屏（Next 的报错页：`This page couldn't load / A server error occurred`，`ERROR 2655499219`）。
实测：**`https://d-z-crm.vercel.app/` 返回 500**（`/login` 200、`/workshop/dashboard` 307），也就是首页挂了。

时间线：owner 合并了 PR #28（`feat/hrm-attendance`）→ Vercel 自动部署 → **库还是旧的**，
而 Prisma 默认 SELECT 全部标量列 → 缺列 = 该模型所有查询报 P2022 → 挂在 Organisation 查询上的首页直接 500。
生产缺的不只是几列，而是**整批 schema**：`Organisation` 4 列、`Branch` 2 列、`Attendance` 6 列、
两张新表（AttendancePunch / AttendanceCorrection）+ 5 个索引 + 1 个外键。

## 处置（已恢复）

用项目自己的同步脚本、走**直连**（5432，非池化）把加性变更应用到生产：

```
VERCEL_ENV=production DIRECT_URL="$DST_DATABASE_URL" node scripts/sync-prod-schema.mjs
# [schema-sync] applied in 2.0s
# [schema-sync] production schema is now in sync (total 6.4s)
```

应用前先跑 `--check` 并确认 diff **纯加性**（DROP/TRUNCATE 计数 = 0：2 张表 + 12 列 + 5 索引 + 1 外键）。
恢复后 `/` → **200**，`--check` → 「schema and database agree — nothing to do」。
顺带把两个生产分行的考勤坐标补齐（走 `/workshop/settings` 界面，留下 2 条 `ATTENDANCE_GEOFENCE_SET` 审计）。

## 根因：构建期同步**设计成了 fail-open**

`scripts/sync-prod-schema.mjs` 原来这样：只要**读不到**数据库（超时/连不上/pooler 拒绝），
就打印一句「skipping the check」然后 `return` —— **让构建继续**，注释理由是「网络抖动不该拦住发版」。

于是出现最坏的组合：**构建成功 + schema 未验证 → 部署上线 → 整站 500**。
而失败的构建会保留上一个可用版本——两害相权，当时的选择恰好选反了。

真正触发条件：生产**没配 `DIRECT_URL`**（owner 待办 92b29072 里的一条），
`migrate diff` / `db push` 走池化连接失败，于是每次都走到「读不到 → 跳过」这条路。

## 改动：生产环境下「无法验证」= 构建失败

- **生产**（`VERCEL_ENV=production` 且非 `--check`）读不到数据库 → **exit 1**，并打印该查什么
  （把 `DIRECT_URL` 设为 Supabase 直连 5432，不是 pooler）；
- **本地/预览**保持原来的 fail-open；
- 应用超时（fail-closed）与破坏性 DDL 拒绝（原本就有）不变。

三种路径都实测过：生产 + 可达 → exit 0；生产 + 连不上 → **exit 1**（以前静默放行）；本地 + 连不上 → exit 0 照旧。

## 交接说明

- **owner 需要做的一件事**：在 Vercel 加 `DIRECT_URL`（Supabase 直连，端口 5432，非池化）。
  否则将来任何带 schema 变更的部署，构建期同步都跑不起来——现在至少会**拦住构建**而不是把站点打挂。
- 生产坐标已就位（两个分行都是 `3.1111141, 101.6316582`），生产上的考勤可以正常判定围栏了。
- 教训一句话：**「不阻塞发版」这条规则只对「读不到」成立，对「读到了但没同步」不成立**——
  前者是未知，后者是已知的坏状态；脚本里这两条路以前被同一段 catch 合在一起处理了。