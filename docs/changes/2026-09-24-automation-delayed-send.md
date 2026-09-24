---
date: 2026-09-24
title: 延迟发送 + 执行日志不再借用 error 字段
branch: feat/automation-delayed-send
---

## 一、延迟发送（自动化动作「N 天后发这条消息」）

以前 SEND_MESSAGE 只能**立刻发**。而「服务完成后 3 天问一句满意吗」这类是最常用的形态之一。

现在动作可以带 delayDays：

- delayDays = 0 → 立刻发（行为不变）
- delayDays > 0 → **先排队**（新表 ScheduledMessage）→ 由每日 cron（08:30 那条）发出

三个刻意的决定：

1. **与规则里的 SEND_MESSAGE 走同一个发送入口**（messagingModule.sendFromTemplate）——
   所以 opt-out 检查、真实 status/externalId、失败记录全部自动一致，不另开一条发送路径。
2. **发出失败就记 FAILED**（带 attempts 与 lastError），不静默重试 ——
   与项目里「不允许看起来发了其实没发」的一贯口径一致。
3. 排队时记下 **sourceRuleId**，排查时知道是哪条规则排的。

## 二、执行日志不再借用 error 字段

AutomationExecution 原先把**去重键塞在 error 字段里**（连 SUCCESS 行也是）——
于是「按错误排查」会被去重键干扰。现在独立成 dedupeKey 列（带索引），
迁移里把历史数据搬过去（SUCCESS 行的 error → dedupeKey，并清空 error）。

## 三、我自己犯的一个错（记下来）

第一次把迁移写成了 **PostgreSQL 方言**（TIMESTAMP(3) / JSONB），而 **prisma/migrations 是 sqlite 方言**：
sqlite 照单全收，但 Prisma 读不懂那个列类型，插入时报
「Conversion failed: Value TIMESTAMP(3) not supported」。已改成 sqlite 类型（DATETIME / JSON）。

**教训**：这里的迁移是 sqlite 方言；生产 PG 由构建期 sync-prod-schema.mjs 同步，不需要在迁移里写 PG 类型。

## 测试（3 条）

- sendAtFor：N 天后；0 就是现在；**负数不能跑到过去**
- isScheduledDue：到点才算（正好到点也算）
- **核心**：带 delayDays 的动作**只排队、不立刻发**；没到点时 sendDueScheduledMessages 发不出去

全量 70 文件 / 830 测试通过；tsc / eslint 干净（0 error）。
