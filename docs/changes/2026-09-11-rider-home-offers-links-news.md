---
date: 2026-09-11
title: 骑手首页「特别优惠」卡片改为直接进 News 页
branch: fix/rider-home-offers-to-news
---

## 改动

`src/app/rider/home/page.tsx`：首页那张两行的「Special offers」卡片，链接从 `/rider/promotions`
改为 `/rider/service-history`（**News 页**，也就是底部导航那个 News）。卡片加上 `data-testid="home-offers"`
与 `dz-card-link` 类（后者让整卡有可点的反馈），并加注释说明它是**预览**、点进去是 News 页。

新增回归守卫：`e2e/rider-news-visibility.spec.ts` 第三条用例——验证卡片 `href` 是
`/rider/service-history`，**并且真的点击一次**、断言 URL 落在 News 页（避免以后有人只改文案或改回促销页）。

## 影响

骑手在首页点优惠预览 → 进 News 页（那里能看全部内容，并可再从 News 的 View all 进促销列表）。
此前点它是直接跳进促销列表（`/rider/promotions`），与「预览 → 详情页」的预期不符。

## 交接说明

- 页面归属：`/rider/service-history` 就是 News 页（`export default async function NewsPage()`，底部导航
  「News」指向它）；`/rider/promotions` 是素材/海报列表页，由 News 页的 View all 进入——两者职责不同，
  本次只改首页卡片的落点，News 页那个入口保持不动。
- 卡片本身只在「有生效促销」时渲染（`livePromos.length > 0`），所以 e2e 里它一定存在（种子里有 3 个
  ACTIVE 促销）；断言前先 `dismissGuide(page)`，否则首访导览气泡会挡住点击（本项目既有的坑）。
- 验证：`tsc` 0；build 通过；相关 e2e 4 例全绿（含新守卫），全量 `playwright test --project=desktop-chromium`
  49 通过 · 0 失败；已重建 `.next` 并 kickstart 三端。
