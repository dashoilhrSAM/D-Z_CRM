---
date: 2026-09-11
title: 完工 WhatsApp 报价改用发票总额（不再报未减促销的小计）
branch: fix/completion-quote-nets-promo
---

## 改动

新增纯模块 `src/modules/messaging/completion-message.ts`（`completionMessage()`），
`src/services/completion.ts` 的完工消息改由它生成：**报价用 `totalSen`（发票总额，已减促销），
有折扣时附一句 `(diskaun RMxx)`**；金额格式统一走 `formatRM`（与 app 页面同一个格式化器）。

新增 `tests/completion-message.test.ts` 6 例（含一条源码守卫：`completion.ts` 不许再出现
`(subtotal / 100).toLocaleString()` 这种旧写法），新增 `e2e/completion-quote.spec.ts` 端到端证明。

## 影响

促销打折的单子，客户收到的 WhatsApp 价从「未减促销的小计」改成「发票上的总额」，
不再出现**消息里 RM165、发票上 RM148.50**的自相矛盾（骑手 app 的发票页本来就显示总额）。

## 交接说明

**根因**：`completion.ts` 第 153 行的 `notify.body` 是内联拼的，取的是 `subtotal`——
而同一段代码在**上面第 86 行**已经算出 `discountSen`、第 87 行算出 `totalSen` 并写进发票。
也就是说：同一次事务里，发票是对的，发给客户的消息是错的。骑手在 app 里看到 RM148.50、
收到 WhatsApp 说 RM165，柜台按发票收钱——三方对不上。

**为什么以前没人发现**：e2e 的 master journey 没有促销（book 页的 `forBranch` 要求
`campaign.branchId === 所选分行`，而种子里的促销 `branchId` 为 null，所以自动折扣不生效），
subtotal 与 total 恰好相等（RM165），消息正确与否无从分辨。所以这次特意新增了一条**从 campaign 链接
进入**的 e2e：种一个 10% 的 PROMO（branchId = 主分行）→ `/rider/book?campaign=<id>` 下单 →
完工 → 断言 `Message.body` 含 `Total RM148.50` 与 `(diskaun RM16.50)`、**且不含** `Total RM165`，
并断言 `Payment.amountSen === invoice.totalSen`（要收的钱也跟发票一致）。

**同一事务里另外两处仍按 subtotal 记，是有意留着等 owner 表态的**（不在本次改动范围）：
① `CompletionResult.revenueSen / grossProfitSen` 与 ② `ServiceHistory.totalSen`。
前者目前只被 `transitionJob` 原样返回给 UI、未落库、未进任何报表（`revenueSen` 的读者是
marketing `performance.ts`，它读的是 `invoice.totalSen`）；后者在 `src/` 内**无人读取**
（骑手护照页读的是 `invoice.totalSen`）。它们口径该不该也改成净额，取决于财务口径
（折扣算营销成本还是收入抵减），属产品决定，故只记录不改。

## 验证

- `pnpm exec tsc --noEmit` 0；`pnpm test` **423 通过（33 文件）**（新增 6 例）。
- **反向验证（做过）**：把 `completion.ts` 的消息改回旧的 subtotal 内联写法 → 守卫测试立刻失败
  （`completion.ts` 不许再出现 `(subtotal / 100).toLocaleString()`）；改回新写法 → 6 例全绿。
- **端到端（做过）**：`e2e/completion-quote.spec.ts` 通过，实测输出
  `invoice {subtotalSen:14000, discountSen:1400, totalSen:12600}`、`booking promo 1200`、
  消息正文 `Hi Ahmad, motosikal awak dah siap! Total RM126 (diskaun RM14). …`；
  并断言 `Payment.amountSen === invoice.totalSen`。
- 全量 `playwright test --project=desktop-chromium`：46 + 1（新增）= 47 通过。

## 顺带发现（**未改**，等 owner 定）

预订时的促销折扣挂在 **booking 自己的计价行**（套餐 + 加项）上：`resolvePromoForBooking()` 在
`lines.length === 0` 时直接返回 null。而骑手预约表单的套餐是可选的（默认 none，柜台 check-in 时才选），
所以**没在预约页选套餐的单子，即使当时有生效促销，也不会拿到折扣**（e2e 的 master journey 就是这种：
促销 20% 生效、订的是 RM165 的单，折扣为 0；而 `Organisation.promoAutoApply` 在 e2e 库中是 true）。
正确的口径可能是「按最终实际计入账单的行打折」（即完工时用 isPromoActive 重新解析，而不是依赖预约快照），
但那是营收行为改动，需 owner 决定。
