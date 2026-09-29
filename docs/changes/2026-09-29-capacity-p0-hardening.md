---
date: 2026-09-29
title: 容量评估 P0：区域改到新加坡、照片上传前压缩、cron 去掉单租户假设
branch: perf/scale-p0-hardening
---

## 改动

起因：给 100 / 300 / 500 dealers 三档规模做容量评估（报告见 docs/CAPACITY_AND_UPGRADE_PLAN.md，
模型脚本 scripts/perf/capacity-model.mjs）。评估过程里查出三件**今天就有问题**的事，这一版先修这三件。

### 1. 区域错配：函数在美东，数据库在新加坡（vercel.json）

vercel.json 之前没有 regions，Vercel Fluid compute 的默认区域是 iad1（美东），
而 Supabase 项目在 ap-southeast-1。代价是每次 SQL、每次 Auth 校验都多约 200-250 ms，
一页 6 次串行往返就是多 1.2 秒。现在显式声明 regions 为 sin1，与数据库同区。

### 2. 照片管线：上传前压缩 + 护栏落到平台上限之下

实测生产 dz-assets/job-photos 的 75 张照片：平均 2.65 MB、p90 3.31 MB、**最大 4.3 MB**；
SOP-001 每单 5 张，客户端不做任何压缩，页面用裸 img 加载原图。
而 Vercel Functions 的**请求体上限是 4.5 MB**（超出直接 413 FUNCTION_PAYLOAD_TOO_LARGE，
路由处理函数根本不会执行）——也就是说「照片太大」不是将来的风险，是已经贴在悬崖边上。

- 新增 src/lib/photo-policy.ts：长边 1600 / JPEG 0.8 / 单张上限 4 MB（**低于**平台 4.5 MB），
  以及纯函数 scaledDimensions（等比缩放、绝不放大）。零依赖，客户端与服务端共用。
- 新增 src/lib/image-compress.ts：浏览器端压缩（createImageBitmap 优先、img 兜底；
  压缩失败一律回退原图，绝不因为压缩失败而挡住技师拍照）。
- src/components/mechanic/sop-photo-capture.tsx 上传前调用它；压缩后仍超 4 MB 才拒绝，
  并用带真实体积的文案提示重拍（i18n 键 mech.sop.too-large，中英马三语）。
- src/app/api/jobs/[id]/photos/route.ts 的护栏从写死的 8 MB 改为共享常量，返回 413 + 人话。

真实浏览器实测（Chromium，见下方「验证」）：12 MP 照片 2.33 MB → 301 KB（12.9%），35 ms。

### 3. cron 去掉单租户假设（P0，上第 2 家 dealer 的前提）

src/modules/automation/scan.ts 与 src/actions/reminders.ts 之前是单租户写法，且不只是「少扫几家」：
db.organisation.findFirst() 只看第一家门店的规则；三个 findMany **完全没有租户过滤**
（把别家的提醒/预约/客户喂进第一家门店的自动化规则）；take: 50/200/500/2000 是全平台共享窗口。

现在：逐家门店扫描、每个查询都按租户收窄、按天轮转起点（扫不完时今天被落下的门店明天排最前）、
时间预算 200s + 单次最多 50 家门店，并把 orgsRemaining / truncated **如实返回**，
不再让静默截断看起来像「今天没事发生」。
注意 ServiceReminder 与 Booking 两张表没有 organisationId 列，必须经关系收窄
（customer.organisationId / branch.organisationId）——这是写这一层时最容易猜错的地方。
顺带修掉同类的第三处：内置提醒取模板时不再 findFirst 全表（会命中别家门店的模板），改为按该客户所属门店取。

## 影响

- 生产下一次部署后，Vercel 函数与 Supabase 同区，页面渲染少约 1 秒的往返（尤其对马来西亚门店）。
- 新照片约为原来的 1/8 体积：按报告模型，T3（500 dealers）每天的存储增量从 97 GB 降到 12.8 GB，
  12 个月后从 34 TB 降到约 4.5 TB。**已存在的旧照片不会被压缩**（不做回溯处理，避免离线批量任务）。
- 多租户：第 2 家 dealer 进来时，其时间类自动化会正常触发；此前会静默不触发。
- 测试从 839 增到 848（新增 tests/photo-policy.test.ts 9 条、tests/automation-multi-org.test.ts 9 条）。

## 交接说明

三条改动各自独立、可以分开合。照片那条**只改新上传**，历史数据不动。
cron 那条的**剩余缺口**：单次最多扫 50 家门店、时间预算 200s —— 500 家门店时一天扫不完，
靠按天轮转在几天内覆盖完（结果里会有 truncated: true）。
真正的解是把它拆成「每家门店一个任务」的队列，属报告里的 P2，这一版没做。

验证（都在本机跑过，不是推断）：
- pnpm exec tsc --noEmit → 0 错误
- pnpm test → 72 文件 / 848 通过
- pnpm build → 通过；kickstart 三个 launchd 服务后 :3002/:3003/:3102 均正常响应
- 压缩：把 image-compress.ts 打包成 IIFE 注入真实 Chromium，跑 3 组真实 JPEG
  （12MP 横 / 12MP 竖 / 小图），断言尺寸与体积 —— 全部通过
- 反向验证：把新旧代码对比，确认「护栏低于平台上限」「组件里确实调了压缩」这两条结构断言
  在旧代码上会红（不是永远为真的空断言）
