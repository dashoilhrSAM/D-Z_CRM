---
date: 2026-09-14
title: 柜台侧也显示促销承诺（工单报价面板 + 打印报价单）
branch: feat/workshop-shows-promo-promise
---

## 改动

促销折扣的规则是「报价即承诺」，但这个承诺此前**只有骑手看得到**：骑手报价卡有
「Promotion · <campaign> −RMxx」与净额 Total，而柜台看的工单页与打印出来的报价单都只显示原价。
同一张单，客户和柜台看到两个数字。

- `src/modules/marketing/promo-resolve.ts`：新增 `promisedPromoFor(rawSnapshot, quoteTotalSen)`——
  「快照 + 报价总额 → 承诺额」的**唯一定义**，返回 `{ name, discountSen } | null`（没有承诺、
  或承诺额为 0 时返回 null，避免在报价单上留一行 −RM0.00）。
- `src/modules/rider/status.ts`：改为调用它（原本自己拼 `readPromoSnapshot` + `promoDiscountForBill`），
  行为不变——骑手侧本来就对。
- `src/components/workshop/quotation-panel.tsx` + `src/app/workshop/jobs/[id]/page.tsx`：
  工单详情右侧的报价面板新增促销行与净额 Total（工单页用 `detail.booking.promoSnapshot` 取值，
  `jobInclude` 本来就带 booking，无需改查询）。
- `src/app/quotation/[id]/page.tsx`：打印报价单在「Parts/Labour 小计」之后加促销行，**Total 改为净额**——
  客户签字的是实付金额。

i18n 复用既有键 `quotation.promo` / `quotation.total`（EN/ZH/BM 三语已存在），无新增文案。

## 影响

- 柜台在客户确认报价前就看得见承诺的折扣，不会再出现「员工按原价解释、客户说你们答应打折」。
- 打印/PDF 报价单与发票口径一致：报价单上的 Total = 客户将实付的净额。
- 折扣金额的算法仍然只有一处：`promoDiscountForBill`（承诺额, 上限为账单）。
  新增的 `promisedPromoFor` 只是「取快照 + 收敛成 UI 需要的形状」，不含新算法。

## 交接说明

- **为什么收敛成一个函数**：三个界面（骑手卡 / 柜台面板 / 打印报价单）各自手写「快照 + 报价额 → 折扣」
  正是两边报价开始不一致的路径。`tests/promo-promise.test.ts` 新增守卫
  「every surface that shows a quote shows the same promise」：逐个断言三个文件必须有
  `promisedPromoFor(`、且**不得**出现 `promoDiscountForBill`（禁止自己再算一遍），
  并断言该函数在 promo-resolve.ts 里只有一份定义。**已反向验证**：改动前这三个文件的
  `promisedPromoFor(` 命中数都是 0，守卫在旧代码上确实失败。
- **口径**：净额 = `max(0, 报价总额 − 承诺额)`，与骑手卡、完工发票、完工 WhatsApp 消息一致。
  无 booking 的散客单仍然不打折（`promisePromoOnQuote` 有意返回 null），所以柜台面板对这类单
  不显示促销行。
- 新增 e2e 断言在既有的 `e2e/promo-at-checkin.spec.ts` 里（2c/2d 两段，用 OWNER 账号看柜台侧，
  避开分行隔离；`:3102` 是 e2e 库）。新增单测 4 例（`promisedPromoFor`）。
  验证：tsc 0；vitest 全量通过；build 通过；已重建 `.next` 并 kickstart 三端。
