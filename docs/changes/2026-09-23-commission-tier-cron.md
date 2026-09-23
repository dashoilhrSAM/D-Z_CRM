---
date: 2026-09-23
title: 佣金 P3 收尾：自动补发的 cron（把面板上的承诺落地）
branch: feat/commission-tier-cron
---

## 为什么这一期必须做

技师面板上写着：「**每月结束时仍未领取的奖励会自动补发，不用担心忘记点**」。

而在此之前，**没有任何东西会去执行它** —— autoGrantExpiredTiers 只是一个模块函数，没有定时触发。
这类缺陷最难发现：界面看着对、测试全绿、逻辑写好了，**而钱就是没发**。
界面在替系统承诺一件没人做的事，比不写那句话更糟。

## 做了什么

1. **/api/cron/commission-tiers**（Vercel Cron，每月 1 日 01:00 UTC = 09:00 MYT）：
   遍历所有组织调用 autoGrantExpiredTiers，返回 { organisations, granted, totalSen } 便于排查；
2. **鉴权照既有规矩**：requireCronSecret（fail-closed，缺 CRON_SECRET 就是 503，不是放行）；
3. **幂等**：CommissionClaim 的唯一键 (userId, tierId, windowKey) 兜住 —— cron 多跑几次、
   或与技师手动领取撞在一起，都不会重复发；
4. **顺手修了一个我自己留的缺口**：面板的「历史」原本只查**当前窗口**的领取记录，
   于是月初一看，往期领过什么全不见了 —— 而那正是技师最想核对的东西。
   现在当前窗口的领取（判定能不能领）与全部窗口的领取（显示历史）分开取。
5. **把 cron 的守卫从硬编码清单改成目录扫描**：原来 api-auth 测试里写死了两个 cron 文件名，
   新加的 cron 会**悄悄不被覆盖**（本项目一条老教训：清单忘更新）。现在扫 src/app/api/cron，
   新 cron 自动纳入 fail-closed 检查（测试数从 12 变 13，就是它抓到了新路由）。

## 验证

- 全量 **56 文件 / 707 测试**通过，tsc 干净；
- api-auth 的 cron 守卫现在覆盖 3 条路由（reminders / marketing-calendar / commission-tiers）；
- 自动补发本身的幂等与窗口归属由 tests/commission-claim.test.ts 的真库测试覆盖（补发一次、再跑为 0）。

## 尚未做

- **生产上的 cron 要等这次部署合并后才注册**（vercel.json 的 crons 由 Vercel 读取）；
- 面板的视觉复核（用生产技师账号打开 /mechanic-app/earnings 逐项核对）；
- P4：StaffPayout ← 台账、期间锁、跨期调整、佣金成本占比视图。