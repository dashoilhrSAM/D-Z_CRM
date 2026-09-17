---
date: 2026-09-17
title: 「导出 CSV」把本月静默导成了今天——页面的导出链接只带 from/to
branch: fix/attendance-export-range
---

## 改动

修一个**已经上线**的真缺陷（PR #30 带上去的），它出现在生产环境的验收过程里，不是猜出来的。

页面的「导出 CSV」按钮生成的链接是 `/api/attendance/export?from=<起>&to=<止>`（**不带 preset**），
而导出路由把 `sp.get("preset")`（= null）直接交给 `resolveRange`。`resolveRange` 的 preset 缺省是
**"today"**，而 **"today" 会忽略 from/to** —— 于是无论你在页面上选的是本周、本月还是自定义，
**导出永远是「今天」**。

### 生产实测（四个变体，同一份数据）

| 请求 | 返回行数 | 内容 |
|---|---|---|
| `?from=2026-09-01&to=2026-09-17`（**页面链接就是这样**） | 1 | `(no records in range),…` —— **空的** |
| `?preset=custom&from=2026-09-01&to=2026-09-17` | 2 | 正确 |
| `?preset=month` | 2 | 正确 |
| `?preset=custom&from=2026-09-17&to=2026-09-17` | 1 | 占位（今天确实没记录） |

同一页的 KPI 写着 **2 人天**，导出的 CSV 却写着「没有记录」——两个数字当场对不上，这就是发现它的方式。

### 修法

在导出路由里把「只给起止日期」显式当成 custom：

```ts
const preset = sp.get("preset") ?? (sp.get("from") || sp.get("to") ? "custom" : null);
```

改在**服务端**而不是把客户端的链接补上 `preset=custom`：一个只接受起止日期的入口就该按起止日期取数，
这样任何调用方（而不只是当前这一个按钮）都不会再踩。`resolveRange` 本身不动——
页面传的是真实 preset，week/month 有意忽略 from/to，那里的行为是对的。

## 影响

- 「导出 CSV」现在真的导出你选的那段区间。**改前它对任何区间都只导今天**——
  对财务来说这是"导出了但数字是错的"，比报错更糟。
- 不影响页面本身的区间报表（它一直是对的，走的是真实 preset）。

## 交接说明

### 为什么 e2e 没拦住它（这条比缺陷本身更值得记）

原来的断言是「CSV 里要有本人（Daniel Tan）」。而这条用例**造的打卡就在今天**——
所以即使导出把区间整段丢掉、退化成「今天」，断言照样通过。
**它不可能失败**，属于本项目反复记过的那类假守卫。

现在补的是**反向**那条：选一段肯定没有记录的区间（2020-01-01 ~ 2020-01-02），
导出里就必须**没有**本人，并且要给占位行而不是空文件。
「区间外不该出现这个区间内的人」才是能失败的那句话。

**反向验证（实跑，不是推理）**：把路由改回旧实现并重新 build，这条用例**失败**（1 failed / 3 passed，
失败点正是新断言那一行）；恢复修复后重新 build，**4 passed**。
两次都是 complete e2e 文件跑（前两条用例负责造出"今天有打卡"这个前提）。

### 验证

- `pnpm exec tsc --noEmit` 0；`pnpm test` **521 通过 / 39 文件**（main 基线；本分支不加单测——
  缺陷在路由的取参逻辑，端到端那条反向断言才是真正能拦住它的东西）。
- `e2e/attendance-review.spec.ts`：修复后 4/4 通过，回退后 1 失败（见上）。
- 生产复查（浏览器实测，登录 OWNER）：月度 KPI 2 人天、导出返回 2 行数据、
  `Cache-Control: private, no-store` 仍在、区间外导出返回占位行。

### 另一条同时确认的事

这次顺带把**生产环境**的 P2 整条链路验了：部署成功后 `/workshop/attendance` 正常渲染
（期间切换、四个 KPI、异常队列、21 行人员、导出按钮），`/api/attendance/export` 无 Cookie 返回 401，
`DRIFT_CHECK_URL=… node scripts/sync-prod-schema.mjs --check` 输出 `schema and database agree` ——
**构建期 schema 自动同步第一次真正生效**（此前一直是 fail-open 地静默跳过，见同日的 IPv6 那份诊断）。
