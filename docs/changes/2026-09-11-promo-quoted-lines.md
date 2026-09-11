---
date: 2026-09-11
title: 促销折扣改成「报价即承诺」——没选套餐的单子在 check-in 拿到折扣，且只按报价行打折
branch: feat/promo-quoted-lines
---

## 改动

**一句规则**：折扣百分比在**客户第一次被报价**时定下（预约时选了套餐 → 预约那一刻；没选 → 柜台 check-in
生成报价单那一刻），金额＝该百分比 × 报价行，**此后不再重新解析、也不再按完工总账单重算**。

- `src/modules/marketing/promo-resolve.ts` 新增三个函数（都在同一处，保持「规则只写一遍」）：
  - `promisePromoOnQuote({ jobId, branchId, lines })`：按 `Booking.jobId` 找 booking；没有快照就用现有的
    `resolvePromoForBooking()` 解析并落库；已有快照但**报价行变了**（柜台换套餐）就用 `rescalePromoSnapshot()`
    重新定基**但保留原百分比**（campaign 已过期也认——那是已经许出去的承诺）。
  - `rescalePromoSnapshot(snapshot, lines)`：纯函数，保留 campaign/百分比，按新报价行重算 original/discounted/saved。
  - `promoDiscountForBill(snapshot, subtotalSen)`：纯函数，完工时返回 `min(承诺额, 账单额)`。
- `src/modules/quotations/service.ts` 的 `send()` 调用 `promisePromoOnQuote()`——**报价单是套餐之外的单据
  第一次变成钱的地方**，所以承诺在那里做。用 try/catch 包住（报价单本身绝不能被它弄挂）。
- `src/services/completion.ts` 用 `promoDiscountForBill(promo, subtotal)` 取代
  `discountForSubtotal(subtotal, promo?.discountPercent)`；并顺手修掉一个数据可达性问题：`job.booking` 关系
  只有 check-in 路径会连，柜台从维修 booking 建单时只写 `Booking.jobId`，于是完工时读不到快照
  （连带 campaign 积分加成也读不到）——改为「关系没有就按 jobId 查一次」。

## 影响

1. **修掉口子**：促销期内、预约页没选套餐的单子（柜台 check-in 才选）以前一分钱不打折，现在会按促销打折。
   e2e 的 master journey 就是活例，它现在跑出折扣（RM165 的活 → 减 RM24 → 收 RM141）。
2. **收窄折扣基数（有意为之，属营收口径变化）**：以前完工时是「促销 % × 完工总账单」，柜台后加的审批项
   （链条调整 RM20）、配件（机油滤芯 RM25）也被打折——实测旧行为：booking 快照 `savedSen=1200`、
   发票 `discountSen=1400`。现在发票只减「承诺额」，后加项按全价收。这同时让 marketing ROI
   （`performance.ts` 直接累加 `invoice.discountSen`）反映的是**真实让利**。
3. **柜台直接建单（无 booking）仍然没有折扣**——那是「要不要给散客也打折」的新业务决定，本次不发明承诺。

## 交接说明

- **为什么挂在报价单而不是 check-in**：维修（REPAIR）booking 的 check-in 不建 job、也没有计价行，柜台稍后建单
  再发报价单；挂在 `quotation.send()` 一处即可同时覆盖服务单与维修单。验过：服务单在 check-in 后立刻发报价单，
  所以两者的「报价时刻」实际是同一刻。
- **边界（都已实现并有单测）**：① 柜台换套餐 → 重定基、百分比不变；② 促销在 check-in 前结束而预约时已选套餐 →
  沿用旧快照（承诺优先）；③ 预约时没选套餐、check-in 时促销已结束 → 不打折（那一刻才第一次报价，没有可兑现的旧承诺）；
  ④ 报价行被砍到 0 → 折扣为 0；⑤ 折扣永不大于账单。
- **未做（需要 owner 表态）**：① 骑手在中途那张报价单上看不到折扣行（`Quotation` 没有折扣字段，totalSen 是行合计）——
  客户会「先看到全价、最后少付」，不亏但口径不齐；② 柜台散客单（无 booking）要不要吃促销；③
  `CompletionResult.revenueSen/grossProfitSen` 与 `ServiceHistory.totalSen` 仍按 subtotal 记（前者只回传 UI、
  未落库；后者 src 内无人读）。
- **验证**：`tests/promo-promise.test.ts` 10 例（含两条源码守卫：报价单必须调 promise、完工不许再出现
  `discountForSubtotal(subtotal` 这种「按总账单重算」）；e2e 新增 `promo-at-checkin.spec.ts`（不选套餐 → check-in 承诺 →
  完工按承诺扣、且断言**不等于**按总账单算出来的数），并同步更新 master journey 与 completion-quote 的期望值。
