---
date: 2026-09-11
title: e2e 先关掉页内导览再操作，并删掉会腐烂的硬编码月份断言
branch: fix/rider-off-news-leak
---

## 改动

`e2e/helpers.ts` 新增 `dismissGuide(page)`：导航到任何带引导的页面后，先关掉页内功能导览，再与页面交互。
`bookViaRider` / `confirmAndCheckIn` / `runMechanicInspection` 三个 helper 与两个 spec 里所有 `page.goto` 后各调用一次。

同一个 spec 里删掉会腐烂的日期断言：`ahmad-complete-service-journey` 第 8 步原本断言首页出现
`"November 2026"`，改为断言页面上确实有 `Estimated <月> <年>`。

## 影响

此前 4 个一直失败的 e2e（`ahmad-complete-service-journey` + `booking-and-approval-flows` 三例）**不是业务 bug，
是测试没关导览**。修完：三个 booking/approval 用例通过；master journey 一路跑到第 8 步才暴露下一个问题（见下）。

## 交接说明

**根因（前一轮把它误判为「疑似真 bug」）**：页内功能导览（rider/workshop 共用运行器）在「首次进入某功能页」时弹浮层，
它的气泡卡 `z-[120]`、`pointer-events-auto`，**正压在页面内容之上**；外层遮罩是 `pointer-events-none`，
所以页面上只有气泡卡可点。`/rider/book` 的第一步导览没有目标元素，气泡固定在 `top: 90px` 居中——
**正好盖住第一张分行卡**：

```
waiting for locator('a[href*="branch="]').first()
  - locator resolved to <a href="/rider/book?branch=...">
  - <p>Pick a branch, time and service package to book a…</p> from <div role="dialog" aria-modal="true"> subtree intercepts pointer events
```

每一个 e2e context 都是「第一次来访」，所以导览每次必弹，被压住的 `click()` 一直重试到 120s 测试超时。
真实用户按 Skip 就过去了，所以**产品没坏，是测试没按用户的方式走**。测试里显式关掉（点气泡卡右上角 X，
对应组件里的 `dismiss()`），不要用 timeout 硬等。判定选择器用 `[role="dialog"][aria-modal="true"]`：
只有导览与 lightbox/qr-toggle 用这个属性，而这些页面导航后不会有后者。

**第二个问题是另一个性质**：master journey 第 8 步断言首页显示 `"November 2026"`。那个月份来自
`tests/prediction.test.ts` 的样例（18 Aug 2026 的服务 + 3,000 km ≈ November），而真实旅程里最后一次服务
**就是刚刚完成的今天**，`calculateNextServiceDate` 用「最后服务日 + intervalKm/AVG_KM_PER_MONTH 个月」
（3,000 ÷ 1,000 = 3 个月）→ 今天跑就是 December 2026。**这条断言从写下那天起就在随时间腐烂**，
不是回归。改成断言 `Estimated <月> <年>` 的形状，算术本身由 `tests/prediction.test.ts` 守着。

**遗留**：导览的 Skip 只写 sessionStorage（Done 才写 localStorage），所以同一浏览器下次开新会话还会再弹。
这是设计如此，但如果 owner 觉得烦，可以改成 Skip 也持久化——**没动**，等表态。
