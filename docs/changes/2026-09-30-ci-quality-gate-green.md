---
date: 2026-09-30
title: 让 CI 的 quality 门真正变绿（lint 0 error + e2e job 补 build）
branch: docs/perf-load-results
---

## 改动

CI 在我这批改动之前就是红的（上一次 main 的失败日志与本次逐字相同：`829 problems (2 errors)`，
失败在 `pnpm lint`）。所以这一轮不是"修我弄坏的东西"，而是**把这道门修成有意义的口径** ——
否则后面的大改动没有可靠的口令。

### 1. 两个 lint error（`react-hooks/set-state-in-effect`，Next 16 新启用）

- **`src/components/shared/attendance-punch.tsx`** —— 打卡面板在 effect 里同步复位
  `phase`/`cameraError`/`geo`。改成 React 文档给的等价写法：**渲染期间调整 state**
  （`prevOpen !== open` 时复位）。语义没变（open 变 true 的那次渲染就重置），但没有级联渲染。
  另外把「浏览器不支持定位」那条分支移进既有的异步块 —— 它原先也是 effect 里的同步 setState。
- **`src/components/workshop/content-studio.tsx:81`** —— 这一处规则是**误报**：
  `refreshSaved()` 的第一条语句就是 `await fetch(...)`，同步路径上没有任何 setState。
  用**带理由的行内豁免**处理，而**没有**把规则整体降级 —— 那样会削弱整道门。

判据不是"看着像"，而是 `pnpm lint` 退出码：改前 `832 problems (2 errors)` 退出码 1，
改后 **`830 problems (0 errors)` 退出码 0**。

### 2. CI 的 Playwright job 一直失败在"没有构建"

它直接跑 `pnpm exec playwright test`，而 `playwright.config.ts` 的 webServer 是
`pnpm start`（`next start`）—— 没有 `.next` 就起不来，报
`Could not find a production build in the '.next' directory`。
**这个报错与测试本身无关，却让整条 CI 看起来像"测试挂了"。**
补上 `pnpm build`，并把 e2e 的真实依赖（Supabase 三个 key + AUTH_SECRET）从 GitHub secrets 接线。

**刻意不加 `continue-on-error`**：缺 secret 时这个 job 会红，但红得**说明白缺什么**；
把它变成"总是绿的"等于把信号藏起来。

## 影响

- `pnpm lint` 现在退出码 0；CI 的 quality job（lint + tsc + test）三道全部本地实测退出码 0。
- e2e job 仍需要在仓库 Settings → Secrets 配置那四个值才会绿 —— 这是**待办，不是缺陷**。
- 830 个 warning 保持可见（没有顺手清理，避免把无关改动混进来）。

## 交接说明

- 打卡与内容工作室是这次唯一动到的两个功能，已跑对应 e2e 验证：4/4 通过
  （`attendance-punch.spec.ts`、`content-studio-save.spec.ts`）。
- 本地基线：tsc 0 错误 · `pnpm test` 930 通过 · `pnpm build` 通过 · `pnpm lint` 退出码 0。
