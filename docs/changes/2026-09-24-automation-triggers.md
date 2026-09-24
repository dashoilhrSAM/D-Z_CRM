---
date: 2026-09-24
title: 自动化的 6 个「死触发器」——接上 8 个，禁掉 2 个
branch: feat/automation-triggers
---

## 背景

老板问「消息自动化还差什么」，查出来的第一件事是：
界面能选 10 个触发器，但代码里**只有 4 个有事件点** —— 另外 6 个建了规则
会显示 Active、日志永远空白（典型的静默失效）。

## 这次做了什么（A + B + C）

### A. 时间类触发器：加每日扫描

SERVICE_DUE / BOOKING_APPROACHING / CUSTOMER_INACTIVE 不是「某件事发生」型，
而是「每天都该看一眼」型 —— 所以新增 /api/cron/automation-scan（每天 08:30，已在 vercel.json 注册）。

| 触发器 | 判定 | 去重键（决定发几次） |
| --- | --- | --- |
| SERVICE_DUE | **复用 serviceReminder 的判定**（与内置提醒同一套，不另写一份） | reminder id → 一条提醒只发一次 |
| BOOKING_APPROACHING | 预约日期 = 明天（按天比较） | booking id → 一个预约一次 |
| CUSTOMER_INACTIVE | 超过 90 天没来（从没来过也算） | 客户 + 月份 → 一个月最多一次 |

**为什么要写去重键**：没有它，一条逾期提醒会**每天早上**都给客户发消息 ✗。

**规则优先**：内置的服务提醒（09:00 那条 cron）现在会先看有没有启用中的 SERVICE_DUE 规则，
有就让位 —— 否则客户会收到两条（规则一条 + 内置一条）。

### B. LEAD_STAGE_CHANGED：接上事件点

在线索阶段变更处触发（与既有的 LEAD_CREATED 一样包在 try 里 —— 自动化绝不能把线索更新搞崩）。
去重键带目标阶段：同一条线索**每个阶段只触发一次**，来回拖不会重复发消息。

（B 的另一半「延迟发送」**没做**：需要一个能存放「待发消息」的表，属于 schema 变更，单独做。）

### C. 剩下的 2 个：在界面上禁掉

LOYALTY_EVENT / LOW_STOCK 还没有事件点 → 在下拉框里**禁用并标注「尚未接通」**，
不让人建一条永远不跑的规则。

## 结果：10 个触发器现在有 8 个真会跑

    事件点：LEAD_CREATED · LEAD_STAGE_CHANGED · BOOKING_CREATED · SERVICE_COMPLETED · JOB_READY
    每日扫描：SERVICE_DUE · BOOKING_APPROACHING · CUSTOMER_INACTIVE
    已禁用：LOYALTY_EVENT · LOW_STOCK

## 测试

日期判定抽成纯函数单独测（写错日期是最难发现的那类 bug）：
明天/后天/今天、跨月边界、90 天的两侧各差一天、从没来过算流失。

全量 69 文件 / 827 测试通过；tsc / eslint 干净。
