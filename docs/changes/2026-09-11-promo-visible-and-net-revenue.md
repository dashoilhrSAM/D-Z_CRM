---
date: 2026-09-11
title: 报价单显示促销折扣（骑手批准的就是实付），并让营收/服务史记净额
branch: feat/promo-quoted-lines
---

## 改动

1. **骑手那张报价单现在带促销行与净额**
   - `src/modules/rider/status.ts`：每行的 quotation 增加 `promo: { name, discountSen } | null`，金额由
     **同一个** `promoDiscountForBill(snapshot, quotation.totalSen)` 算出（绝不另写一套算法）。
   - `src/components/rider/quotation-card.tsx`：明细行下加一行 `Promotion · <campaign>` −RMxx，
     Total 显示**净额**（客户批准的就是将要支付的）；已批准/拒绝的折叠态同样显示净额。
     新增 `data-testid="quotation-promo"` / `quotation-total` 供 e2e 断言。
   - i18n 新增 `quotation.promo`（en/zh/ms）；`src/app/rider/service-status/page.tsx` 把 promo 透传给卡片。
2. **顺手修掉一个被这个折扣行暴露出来的真 bug**：`src/modules/rider/status.ts` 以前给每个 active job 配 booking 时，
   只拿「该车最新的一条 open booking」去比 `jobId`，**骑手同一台车上有两个未完成工单时，除最新那条之外的工单都配不到自己的
   booking**（promo 承诺、生命周期步骤一起丢失）。改成按 `jobId` 建映射逐条配对。
3. **营收与历史记录改记净额**（都是「客户实付」口径）
   - `src/services/completion.ts`：`revenueSen` / `grossProfitSen` 由 `subtotal` 改为 `totalSen`（减促销后），
     与幂等分支（原本就返回 `invoice.totalSen`）一致；`ServiceHistory.totalSen` 同样改净额。

## 影响

客户在**批准报价那一刻**就知道最终要付多少，不再「先看全价、最后少付」；`CompletionResult` 两条返回路径
（新完工 / 重复完工）口径一致；服务史（车护照的数据源）与发票对得上。无 schema 改动、无迁移。

## 交接说明

- **为什么给 Quotation 加列不改，而是从 booking 快照读**：`Quotation` 只有 `totalSen` + `itemsJson`，
  加 `discountSen` 会引入**第二处真相**（booking 快照 + quotation 折扣），一旦不同步就会重演「报价与实收不一致」。
  现在折扣只有一个来源：`Booking.promoSnapshot`，展示与收费都走 `promoDiscountForBill`。
- **未做**：① workshop 侧报价单/job 页仍不显示促销行（修的是骑手那一侧）；② 忠诚度积分仍按毛额计
  （`pts = Math.max(10, Math.round(subtotal / 100))`）——「1 分/RM1 实付」严格说应按 `totalSen`，但那是**减少**客户积分，
  属业务决定，没有动；③ 手工折扣（结账时打的）本来就不经过这条链路。
- **验证**：`tests/promo-promise.test.ts` 新增一条源码守卫（`rider/status.ts` 必须用 `promoDiscountForBill`，
  防止展示端另写算法）；`e2e/promo-at-checkin.spec.ts` 增加「骑手在 check-in 后、开工前就能看到促销行与净额」的断言
  （报价 RM120 → 承诺 −RM24 → 净额 RM96，并断言显示的**不是**毛额）。
  断言按 `data-job=<jobNumber>` **限定到本工单那张卡片**——正是这条限定让上面那个配对 bug 在跑全量时现形
  （单跑该 spec 时只有一张卡片，全量时同车有两张，促销行在错配的那张上消失）。
  全量 `playwright test --project=desktop-chromium`：**48 通过 · 0 失败**；vitest **434**（34 文件）；tsc 0；build 0。
  改动过源码，已重建 `.next` 并 kickstart 三端（:3002 / :3003 / :3102 均 200）。
