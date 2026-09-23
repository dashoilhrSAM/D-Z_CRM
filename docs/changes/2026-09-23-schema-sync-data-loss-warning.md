---
date: 2026-09-23
title: 生产构建连续失败：加唯一约束触发 db push 的 data-loss 拒止
branch: feat/commission-p0-item-catalogue
---

## 症状

PR #42 与 #43 合并后，Vercel 部署全部失败，报的是 build command 第一步：

    Command "prisma generate --schema prisma/schema.pg.prisma && node scripts/sync-prod-schema.mjs && next build" exited with 1

**本地构建完全通过**（next build exit 0），生产库也没被改动过（新列/新表都不存在）——
两个信号都指向"失败的其实是中间那一步"，而不是代码。

## 根因

在生产上跑同一步拿到原文：

    [schema-sync] db push failed: Error: Use the --accept-data-loss flag to ignore the data loss warnings
    ⚠️  A unique constraint covering the columns [organisationId,code] on the table ServiceType will be added.
        If there are existing duplicate values, this will fail.

P0b 给 ServiceType 加了 @@unique([organisationId, code])（为了让按 code 的幂等 upsert 安全）。
prisma 的 db push **无法证明已有数据里没有重复**，就把"加唯一约束"归类成潜在数据丢失并拒绝执行；
而本脚本**刻意不传 --accept-data-loss**（第二道防线，见文件头 SAFETY）——两者叠加，构建每次都红。

为什么 #42 之前没事：那时还没有这条约束。为什么本地看不出来：本地 DATABASE_URL 是 sqlite，
脚本直接跳过，走不到 push。

## 处置（已完成）

1. 先验证数据：生产 ServiceType 8 行，code **全是 NULL**（PG 唯一索引把 NULL 视为互不相同），
   非 NULL 且重复的组合 = 0 → 建索引安全；
2. **单独、显式**地建这一条索引（CREATE UNIQUE INDEX IF NOT EXISTS），而不是给 push 加
   --accept-data-loss 蒙过去——把"判断"留给人，把"执行"留给脚本；
3. 再跑 scripts/sync-prod-schema.mjs（VERCEL_ENV=production）：其余变更正常应用，
   4.5 秒完成并复验 "production schema is now in sync"；
4. 独立复核：CommissionRule 与 ServiceJobItem 的三个新列在 PostgREST 上都返回 200，
   复检输出 "schema and database agree — nothing to do"。

## 教训（可复用）

- **给已有表加唯一约束 = 每次构建都会被 push 拒止**，直到那条约束真的存在于库里。
  顺序应该是：先在生产建索引（幂等 DDL）→ 再改 schema 合并。
- 本脚本的 destructive 检查只看 migrate diff 的 DROP/TRUNCATE，**看不到 push 的 data-loss 判断**；
  两者的差集就是这次的坑。已在 push 失败的处理里补了可操作的提示（含验证 SQL 与处置步骤）。
- "本地构建通过 + 生产构建失败"在这条链路上是**预期现象**，因为本地是 sqlite：
  判断生产 schema 一致性只能用 DRIFT_CHECK_URL/DATABASE_URL 打真库。
- 直连主机 db.<ref>.supabase.co 只有 AAAA（IPv6），而 Vercel 构建出站只有 IPv4 ——
  给构建用的必须是 Supavisor **会话池**（<region>.pooler.supabase.com:5432，用户 postgres.<ref>）。
  另：密码里的特殊字符**不要二次编码**（.env 里那条原样复制即可，自己编码会得到 P1000「密码错」的假象）。
