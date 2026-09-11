# HANDOFF — D&Z Platform（2026-09-10 11:05）

> 本文件由 session-pack 生成，session-resume 可续接。

## 一句话状态
**🧾 发票页可就地看明细（分支 feat/invoice-quick-view，已 push 待合）**：每张发票卡片一个 `<details>` 折叠（**零 JS**，页面仍是 Server Component），展开显示「描述 · 数量 × 单价 · 行小计」+ 小计/折扣/税/合计。**数据源是发票自己的 `InvoiceItem`（完工快照）而不是工单实时行**——工单事后被改也不会与已开票金额不一致。**新增 `src/lib/invoice-lines.ts`**：InvoiceItem **无 createdAt**，故在代码里定序 SERVICE → FEE → APPROVAL → PART，同类别稳定排序。实测 e2e 144 张发票全部有折叠控件、展开 3 行且 subtotal=total=16500；截图 app-screenshots/invoice-details-open.png。**生产有 1 张发票没有任何明细行**，已处理为「No line items on this invoice.」。新增 tests/invoice-lines.test.ts 8 例 + e2e/invoice-details.spec.ts 2 例。

**🔧 指派机械师修复（已合并进 main = fb63fb4，PR #16）**：owner 报「机械师下拉被挡 + 没按分行过滤」。**根因**：同一条规则写了两遍——`createJob` 按【登录者分行】（org 级→主店）建单并拒绝跨行机械师，下拉却按 `scopedStaffWhere(session)` 列【登录者能看到的全部分行】；生产实测 2 分行 13 人，owner 看到 13 个、其中 4 个选了必被拒。已抽成唯一定义 `src/lib/job-branch.ts`（`resolveNewJobBranchId` / `staffWhereForBranch` / `loadAssignableStaff`），`createJob`、`jobs/new`（工单将归属分行）、`jobs/[id]`（**工单已有 branchId**，与 assignMechanic 校验同源）共用。**下拉裁切根因**：`SelectContent` 宽度跟着触发器（而触发器 `w-fit`，只有当前选中项那么宽）+ `ItemText` 是 `shrink-0 whitespace-nowrap` + popup `overflow-x-hidden` ＝ **无省略号的硬裁**；已改 `min-w-0 truncate`（**共享 primitive，全站 Select 受益**）+ 触发器稳定宽度 + 单分行时不显示「· 分行名」。顺带把重复三遍的 `MechanicOption` 合并为 `components/workshop/mechanic-option.ts`。**验证**：e2e seed 只有 1 分行复现不了，测试**自建第二个分行+机械师**，并**反向实测**（去掉过滤后测试确实报 "offered a mechanic from E2E Other Branch"）。**⚠️ 发现 4 个既有失败**：`ahmad-complete-service-journey` 与 `booking-and-approval-flows` 的 3 个用例在 rider 选分行处 120s 超时——**已在干净 origin/main 上复现同样失败，与本分支无关**，但疑似真实问题（rider 预约链路），建议下一个 bug 从这里查。

**✅ 两个真实缺陷已修（2026-09-10，同一分支）**：① **服务价目在 UI 里根本改不了**——`actions/settings.ts` 只有 create/toggle/delete，生产 8 个服务全部 priceSen=null 且无法设置；而 `buildFactSheet` 读到 null 就不报价（引擎拒绝编造价格），于是**整条报价能力被一个缺失的编辑入口关掉**。已加 `updateServiceType`（org 级鉴权 + 校验；undefined=不改、null=清空）+ 行内编辑 + 无价提示带（三语）。② **日历会静默过期**——发薪日按当月滚动，种一次只有 18 个月；写入路径提到 `src/modules/marketing/occasion-seed.ts`（脚本与 cron 共用），新增 **每月 1 号 cron `/api/cron/marketing-calendar`**（Bearer CRON_SECRET，实测无头 401）。顺带把就绪度报告从 raw SQL 改为复用 `isWindowOpen`（消掉 camelCase 列名引号坑，本地不再显示 unknown）。⚠️ **未验证**：设置页「编辑」按钮的点击链路（本地 staff 走 Supabase 登录、无凭据），**请 owner 点一次确认**。

**✅ 营销数据已上生产（2026-09-10）**：新增唯一入口 `pnpm seed:marketing`（`scripts/seed-marketing-data.ts`）——按正确顺序种日历/产品/品牌并打印就绪度。生产实测 **38 节点 / 22 产品 / 2 品牌档案**，`rankOccasions` 当天给出 **Hari Malaysia（窗口 OPEN，D-5）**；重复执行 0 新增。四个旧脚本改为导出 seed、仅直接执行才跑（此前 import 即执行，无法编排）。**两个真实缺陷已修**：① 产品导入每次把 brand 写回 null（单独跑会把 22 个产品全去品牌）② 就绪度 SQL 里 startDate 未加引号被 Postgres 折叠成 startdate（camelCase 列名必须加引号）。**新坑**：client 按单一 schema 生成，拿 postgres URL 跑需先 `prisma generate --schema prisma/schema.pg.prisma` 再还原。⚠️ 待 owner：合并 `feat/marketing-prod-data`。

**✅ 生产 schema 已应用（2026-09-10）**：直接用直连地址对生产执行了增量同步——**66 → 70 张表、657 → 743 列**，新增 `Occasion`/`TrendTopic`/`PromoProduct`/`BrandProfile` + 10 索引 + 4 外键 + `ContentScript.angle`（可空 TEXT），共 112 条语句、**0 条 DROP/TRUNCATE**，耗时 2.2s，复验「schema and database agree」。既有数据全未受影响（User 21 / ServiceJob 25 / Invoice 17 / Booking 10 / Campaign 10 / Customer 3 / Motorcycle 6）。生产 /、/login、/contact 全 200。**⚠️ 但生产库里 Occasion=0、PromoProduct=0**——日历 38 条节点与 22 个产品当初只种进了本地 dev.db；部署成功后内容引擎会因「无节点、无产品」而看起来空转，需在生产跑 `scripts/seed-occasions.ts` 与 `scripts/import-promo-products.ts`（图片 public/products/*.webp 已随代码部署）。

**🔴 当前最要紧**：生产部署连续超时——PR#12 45.6 分钟 ERROR、PR#13 仍在 BUILDING（正常部署只要 1–2 分钟）。根因 = buildCommand 里的 schema 同步步骤连生产库、而 `execFileSync` 默认无超时，池化连接下 Prisma 不报错只是**一直等**。已在分支 **fix/build-timeout-schema-sync** 修好（优先 DIRECT_URL + 每命令硬超时 + 检查失败放行/应用失败快速失败），**待 owner 合并**；另需 owner 在 Vercel 设 `DIRECT_URL`（Supabase 直连 5432）。**marketing 分支已被 owner 合并进 main（PR #13 → 22c4d73）**。

**✅ 合并顺序已解锁**：`fix/prod-schema-drift-guard` 已由 owner 合并进 main（**PR #12 → main = 3ae3bad**），所以 **`feat/marketing-content-engine` 现可干净合并**（共同祖先 0b37413 已在 main 内，无冲突）。该分支内容引擎 **P1-P7 全部完成**（候选脚本→人工选→展开→AI 出图全链路 + 海报艺术方向可选 + 抠图印刷化）。生产当前健康（全 200，drift 0）。基线全绿（tsc 0 / lint 0 error / vitest **335**（25 文件）/ build 0）。品牌已确认 **DASHOIL**。

## 会话信息
- 原会话 ID：session-a62205e6-be99-40cf-a61b-7fa862f52af4
- 本会话 ID：session-df92a8c8-e683-4596-ae0e-abfaa782852e（续接会话「继续 D&Z」）
- 打包时间：2026-09-10 08:44（本会话续接后更新）
- 续接口令：继续 D&Z

## 完成进度
- **Workshop→Rider WhatsApp 真发（PR#9，已合并进 main）**：booking 确认 / 服务完成 / 好评致谢 / 海报群发 / automation SEND_MESSAGE 全部从假 `status:"SENT"` 直写改为经 MessagingProvider 真发（messagingModule.sendDirect / sendFromTemplate，记录真实 status+externalId，遵守营销 opt-out MSG-017 与失败记录 MSG-020）；completion 的 WhatsApp 移到事务提交后发送并触发 SERVICE_COMPLETED 自动化；automation 规则 SEND_MESSAGE 加模板选择器。
- **分行隔离收严（PR#10，已合并进 main）**：① 选 mechanic 下拉用 scopedStaffWhere 按 session.branchId 收窄 + 显示分店名（jobs/new · jobs/[id] · mechanic/jobs/[id] · mechanic 看板）；② createJob 按 session branch 建单（org 级回退主店）+ 跨行 mechanic 抛错，assignMechanic / updateJobDetails 拒绝跨行；③ bookingAction CHECKED_IN / createStaff / createPurchaseOrder / receivePurchaseOrder 改为按 session/creator/booking branch。DB 实测 KL(4)/Testing(2) mechanic 已分开、无跨行分配。
- **冲突解决**：fix/staff-access(#8) 与本分支同改 workshop.ts → merge origin/main 解决（去掉重复 `session` 声明与重复 `getSessionUser` import）。
- **pull 最新 main**（a241bb4 → a4d16d4，42 commits）→ 发现 .next 是旧构建 → `pnpm build`(0) + kickstart 重启三服务。
- **分行归属 + 群发真发收严（fix/branch-attribution-and-broadcast @ 8710683，已 push 待 review）**：① `actions/leads.ts` createLead/convertLead 按 session branch 归属（org 级回退主店，convert 优先沿用 lead 自身分行）——此前硬编码主店，branch 级用户新建 lead 会被列表按 session.branchId 过滤掉、**建完即消失**；② `actions/marketing.ts` broadcastCampaign 改走 messagingModule.sendDirect(isMarketing:true)，补 MSG-017 opt-out 跳过 + 真实 status/externalId + MSG-020 失败记录，返回 `{sent,failed,skipped,audience}` 按真实结果计数（此前 messagingProvider 直发、opt-out 被绕过、sent++ 无论成败都累加）；③ `modules/crm/service.ts` sendMessage 同改走 messagingModule（branchId 由 hardcode null → customer.branchId）；④ `app/workshop/ai/page.tsx` branch 按 session 收窄（此前完全未收窄、恒读主店）。新增 3 个测试文件 9 例，实测对未修复源码失败、修复后全绿。
- **isMain 逐点评估结论（本轮盘点约 30 处）**：**已正确无需改**=inventory 四页 / dashboard / layout（`scopedBranch ? … : main` 正确模式）· website / test-rides / rider.bookService（表单显式 branchId + 主店兜底）· qr/workshop · rider-book · settings-forms（仅显示 isMain 徽章/排序）· constants / seed-core（种子数据）· workshop.ts（已收严）。**本分支已修**=leads / marketing(2) / ai 页。**判定为可接受遗留**=api/import(customers,motorcycles) 与 api/poster/generate（customer/motorcycle 属 org 级共享，branchId 仅归属标注）、assistant/tools.ts（ctx.branchId 优先，主店仅兜底）。

## Marketing 完整化（feat/marketing-system @ 047f61e，已 push 待 review）
- **P1 受众引擎（MKT-005~012）**：新增 `src/modules/marketing/audience.ts`（纯函数 buildAudienceWhere(orgId, rules) → Prisma.CustomerWhereInput，过滤下推到 DB，不再把全量客户拉进内存）+ `Campaign.audienceRules Json?`（双 schema + 迁移）。维度：tags/branches/motorcycleOwned/models/lastServiceWithinDays/inactiveForDays/joinedWithinDays/tiers/overdueService/requireMarketingConsent。新增 `previewAudienceCount` + `components/workshop/segment-builder.tsx`（替换原 5 选项下拉）。旧 audience 代码仍可解析，存量 campaign 不受影响。
- **P2 促销真正生效（MKT-013，最高价值）**：`promo.ts` 的 bestPromoQuote 此前**全仓零调用**（已测但从未接线）。新增 `promo-resolve.ts`：booking 建单解析 promo（显式 campaignId 优先，否则取最优 active，受 `AUTO_APPLY_BEST_PROMO` 常量控制）+ 落 `Booking.promoDiscountSen`/`promoSnapshot`；`completion.ts` 按 snapshot 写 `discountSen`/`totalSen`/`Payment.amountSen`；rider book-form 显示原价划线+折扣行+应付。
- **P3 归因与 ROI（MKT-015/016/017）**：`Lead.campaignId`（双 schema + 迁移）+ website enquiry / `/contact?campaign=` 透传；新增 `performance.ts`（纯 computePerformance + loadCampaignPerformance）聚合 leads/预约/收入/折扣成本/转化率/ROI，日历页展示。
- **顺带修掉的审计问题**：① 日历页把**全局** dueCustomers 当成每个 campaign 受众展示（误导）→ 改真实受众数；② 旧 30_DAYS 与 60_DAYS 走同一状态列表、**返回完全相同的客户集** → 按真实天数；③ broadcastCampaign 消息 branchId 由 operator session 改为 campaign 自身 branch。
- **② 促销自动生效改为 marketing 可控开关（用户要求）**：原 `AUTO_APPLY_BEST_PROMO` 是源码常量，改行为要改代码发版。现改为 `Organisation.promoAutoApply`（双 schema + 迁移）+ 促销日历页开关 `promo-auto-apply-toggle.tsx`（开启时明示会减少营收），`isPromoAutoApplyEnabled()` 读库；关闭后仅带 campaign 链接的预约打折。
- **P4 统一群发管线**：新增 `modules/marketing/broadcast.ts`（`broadcast()` + 纯函数 limitRecipients/applyFrequencyCap），campaign 与 poster 两条重复路径合并；统一 opt-out/真实计数/**7 天频率上限**（可 per-run 关闭）。顺带修掉 sendPosterToCustomers 把**所有异常都算 skipped**（provider 失败被伪装成退订）。
- **P5 生命周期 + 总览页**：新增 `modules/marketing/lifecycle.ts`（纯 effectiveCampaignStatus + syncCampaignStatuses）——SCHEDULED 到点自动 ACTIVE、过期自动 ENDED，DRAFT 永不自动激活、ENDED 终态；日历页读取前先同步，展示状态与折扣引擎一致。新增 `/workshop/marketing` 总览 landing（KPI/归因收入 vs 折扣成本/进行中促销/子页入口）+ nav 加 Marketing Overview。
- **MKT-014 积分促销**：`Campaign.pointsBonus Int?`（双 schema + 迁移），completion 在基础积分上叠加并单独记 CAMPAIGN 流水；campaign 表单加「奖励积分」。
- **P6 e2e**：新增 `e2e/marketing.spec.ts`（5 路由渲染 + 总览 + 建活动含 segment builder + 受众预览 + 开关往返并复原）——**9/9 通过**。
- **实测证据**：`scripts/verify-marketing-promo.ts`（5/5）+ `scripts/verify-marketing-invoice.ts`（**6/6**）——20% promo 把 6000 sen 工单变成 1200 sen 折扣、invoice 总额与应收均为 4800 sen、积分 60+50=110；两脚本自建自清，不污染演示数据（已核对无残留）。
- **P1-P6 已全部完成**，MKT-001~017 需求已全部有实现。

## Marketing 内容引擎（feat/marketing-content-engine @ eb482bd，已 push 待 review）
- **P1 地基已完成**：① **AI 严格模式 + chatJson** —— 修掉「缺 key/出错静默返回兜底马来语文案」的地基隐患（做 JSON 生成会被静默污染）；openai.ts 支持 strict 抛错 + 自动剥 markdown 围栏/前后散文 + 解析失败带原因重试一次；mock 的 chatJson **刻意抛错**不编造。已用真实 key 实测通过。② **PromoProduct**（宣传专用目录，**刻意与库存 Product 分离**，无成本/库存字段）+ **BrandProfile**（品牌调性/do&donts/范例），双 schema + 迁移。③ **22 张产品图**从 86MB/2250px 优化为 **WebP 1000px 共 2.4MB**（PNG 要 11.5MB），规格**逐张从标签读取**（黏度/API/JASO/容量/claims/奖项）导入 22 条产品。④ 种子 `scripts/seed-brand-profiles.ts` 写入 DZ_WORKSHOP 品牌调性（马来语优先）。
- **✅ 品牌已确认 DASHOIL**（原卡点解除）：`scripts/apply-dashoil-brand.ts` 回填 22 个产品 + 新建 DASHOIL 品牌档案（与 DZ_WORKSHOP 并存）。
- **P2 已完成（Occasion 日历）**：新增 `Occasion` 模型 + `src/modules/marketing/occasions.ts`。**核心设计 = 内容窗口在日期「之前」打开**（`leadDays` 决定何时开始推，`angleHint` 决定说什么）——修车行不是靠节日卖货，是靠**长假前几百万人要长途骑行回家、想先检查车**卖货；只知日期的编排会在节日当天发祝福而错过整个营收窗口。`rankOccasions` 按「相关度 × 窗口内临近度」排序，窗口未开/已过沉底。数据为官方口径：2026/2027 公共假期 + 教育部学校假期 + 季风季 + 月度发薪日，共 38 条。Raya 给 28 天提前量、CNY 21 天（全年两大出行高峰）。实测 2026-09-10 当日唯 Hari Malaysia 窗口开启。
- **用户已确认的四项决策**：① 海报要接真 AI 生图（key 由 owner 放 Vercel env，**勿贴对话**）② 爆点尽量做爆款视频分析（YouTube 可自动，TikTok/IG 无公开 API → 人工贴链接）③ 马来语优先 ④ **不要自动发布，人工过滤**。
- **架构铁律（已定）**：**不要让 AI 画产品**——AI 只生成背景场景，真实产品抠图由程序合成，文字由程序叠加（AI 画不出 "API SP JASO MA2" 这类标签，必然乱码毁品牌）。
- **P3 已完成（爆点/爆款结构）**：新增 `TrendTopic` 模型 + `src/modules/marketing/trends.ts`。**约束决定做法**：YouTube `captions.download` 需 OAuth 且仅视频所有者可用 → **拿不到别人爆款的逐字稿**；TikTok 无公开趋势 API、IG 仅自有 → 因此做**结构分析**（hookPattern/format/whyItWorks/borrowableAngles），**不存原文**（版权 + 可复用性双重考虑）。**手动贴链接即可用，无需 YouTube key**（oEmbed 公开）；YouTube Data API key 只用于自动发现与播放量。**相关度守卫已实测**：摩车内容 r5、1.5B 播放的无关爆款 r1，且 `structureDigest` 只放 relevance≥3 的条目进脚本生成。
- **P4 已完成（候选脚本生成，用户核心需求）**：扩展 `ContentScript` 承载候选（候选=未选中的脚本，故 Script Bank 页零改动）。`src/modules/marketing/content.ts`：`buildFactSheet` 从 DB 组装**唯一允许引用的事实**（产品真实规格 + 服务真实价格，无价则渲染 "price not set" 而非编造）；`generateScriptCandidates` 一次出 6-12 条角度各异候选（自动拼装 品牌调性 + 当前 Occasion 窗口 + 趋势结构 + 事实表）；`selectCandidate` 选中并自动 rejected 同批其余；`discardBatch` 整批丢。**产品开关按条粒度**（includeProduct + productSku）。**实测**：开关 OFF 时 0 条提及产品、ON 时 SKU 全真实。**修掉一个实测才发现的真实不一致**：模型会写「Guna DASHOIL…」却把 includeProduct 留 false（脚本提产品但海报不配图）→ 新增纯函数 `reconcileProductFlag` 以文案为准校正，实测修复后 0 处不一致。
- **⚠️ 数据缺口**：`ServiceType.priceSen` **全部为 null** → 目前内容无法报价（AI 正确选择不报而非编造）。**建议 owner 补服务价目表**。
- **P5/P6 已完成（展开成稿 + AI 出图）**：**新依赖** `sharp`（栅格合成）+ `opentype.js`（文字转矢量）。`expand.ts`：选中脚本→多平台 caption（含各平台字数上限）+ hashtags + **海报文案行**（强制≤5/8/6 词）+ 场景描述 + 发布提示。`images.ts`：gpt-image-1 **只生成场景**（prompt 硬禁文字/logo/产品）。`poster.ts` 三层合成 = AI 背景 → **真实产品抠图**（模糊接触阴影 + 亮度/饱和调色匹配光照）→ 矢量文字；另含 `footerBlocks` 品牌页脚（无页脚=匿名图）。**关键技术决策（实测得出，勿改回）**：文字**必须转 SVG 路径**而非 <text>——① Vercel 无 fontconfig，<text> 静默渲染空白；② 实测 sharp 自带 librsvg **不支持 @font-face**（用系统不存在的字体名渲染，加不加该规则墨迹数完全相同）；③ fontconfig 方案不可靠（sharp 加载即初始化，Next.js 模块顺序不可控）。故字体 base64 内嵌 + 转路径 = **零字体依赖、本地线上一致**；字体子集化 316KB/575KB → **19.5KB/16.3KB**（Inter ExtraBold + Noto Sans Bold，SIL OFL 1.1）。**实测成品**：瓶身是真实标签（DASHCIL/E1300+/API SP JASO MA2/4T 10W40/1.2L）——AI 画必然乱码，三层设计目的达成。**已知局限**：棚拍光产品 vs 暗调背景仍有轻微贴图感，调色只缓解不消除。
- **⚠️ 注意**：`pnpm add` 若报 store 位置错误，需加 `--store-dir .pnpm-store`（本项目用本地 store）。
- **P7 已完成（Content Studio UI）**：`/workshop/marketing/content` + `components/workshop/content-studio.tsx`，五步一体（需求 → 6-12 条候选卡片 → 选中 → 展开 4 平台文案+hashtags+海报行 → 出图下载）。**架构**：慢操作走 route handler `/api/marketing/content`（maxDuration=60 + **强制登录鉴权**，这些调用花钱），不用 Server Action（会被超时切断且调用方无从得知）。ContentScript 存 expandedJson/posterUrl，刷新不丢。**端到端 UI 实测通过**（浏览器登录→生成→选→展开→出图 1080×1080 可下载）。
- **⚠️ 两个新踩坑（已解决，勿重犯）**：① **opentype.js v2 的 CJS 有 default、ESM 只有命名导出**，Turbopack 用 ESM → 默认导入会让 **build 失败**，而 **tsc 与 vitest 都发现不了**（它们解析另一种形态）——凡涉及双形态依赖必须真实 build 验证；② **本项目路径含 `&`，bash 中引用路径必须加引号**，否则被当成后台符号。
- **模型已升级**：文本 `gpt-4o-mini` → **`gpt-4.1`**、图像 `gpt-image-1` → **`gpt-image-2.5-sunburst`**（`.env` 已设，代码默认值同步；**Vercel 也要设 `OPENAI_MODEL` / `OPENAI_IMAGE_MODEL`**，不设则走同样的代码默认值）。实测：gpt-4.1 马来语明显比 4o-mini 地道且产品规格准确；**gpt-image-2.5-sunburst 比 gpt-image-1 快一倍以上**（9:16 从 52.9s→22.5s，**原值已逼近 maxDuration=60 上限，升级顺带消除超时风险**）。**兼容性坑**：gpt-5/o 系拒绝 `max_tokens`（需 `max_completion_tokens`）且只接受默认 temperature，原代码两种都发会直接报错——已由 `OpenAIProvider.requestBody()` 按模型名适配，故换任何模型都不必再改代码。
- **海报已重新设计（用户反馈「只是压字」后重做）**：**推翻了「AI 画不好文字」这个过时假设**——实测 `gpt-image-2.5` 能正确渲染文字，于是改为**让模型设计整张海报**（排版层级/徽章/角标/网格/按钮），实测已达 7/10 且有真实平面设计元素。**产品仍不能交给模型**（让它画瓶子会编造标签，实测出现虚构的 "FULL SYNTHETIC ENGINE OIL"），故提示词强制留空白打光台 + 禁止绘制产品，再由程序合成**真实抠图**；**提示词描述的产品台与合成坐标取自同一份 `POSTER_LAYOUTS`**，避免漂移。**新增文字校验**：模型写文案带来拼写风险（实测疑似出现 "Cuti Lancer"），生成后用视觉模型读回比对，缺失即**自动重生成一次**并在 UI 告警。新增 `poster-design.ts` / `poster-verify.ts` / provider `chatVision()`。
- **海报再改：艺术方向可选 + 默认平面海报（用户第二次反馈「不要只有字」）**：上一版虽由模型设计，但**只有一种偏摄影的视觉方向**，用户反馈 "dont focus on the word, it should create a real poster, not only pasting text in"。**先测量再改**：并排实测四种方向——**摄影类永远落在「一张图上面压了字」**（BOLD/CINEMATIC 7/10，评语与用户原话同义：text placed over an image rather than integrated into the design），**平面类字即构图的一部分**（FLAT GRAPHIC **9/10**「designed, integrated graphic poster… text woven into the layout」；INDUSTRIAL 8/10；BLUEPRINT 7/10 但把 WhatsApp 渲染成 WhaltsApp → 文字校验必须保留）。故 `poster-design.ts` 重写为方向系统：`POSTER_STYLES`（GRAPHIC/INDUSTRIAL/BLUEPRINT/BOLD/CINEMATIC，各带 direction/swatch/summary + **`medium: "graphic"|"photo"`** 标注哪类会退化成压字）+ `styleFor()` + **`DEFAULT_POSTER_STYLE = "GRAPHIC"`**（摄影风保留可选但绝不默认）；brief 的 `mood` 改为 `style` + `subject`。**不变量（换风格不得破坏）**：每个方向都强制留空白产品台（允许圆框/色块/光晕去**框**它，不许填充），坐标与提示词描述仍取自同一份 `POSTER_LAYOUTS`。风格经 render-poster → `/api/marketing/content` → Content Studio 艺术方向选择器（`data-testid="poster-style-<KEY>"`）贯通。tests/marketing-poster-design.test.ts 25 → **34 例**。**实测**：真实 key 生成（默认 GRAPHIC）= 2079KB / style used: GRAPHIC / product: E1300 / text check ok:true、missing:none。
- **⚠️ 只有真实 build 能抓到的坑（又一次）**：`poster-design.ts` 被客户端组件（Content Studio 的艺术方向选择器）导入，它 import 的读色模块又 import 了 `sharp` → **sharp 被打进浏览器包、build 失败**，而 **tsc 与 vitest 全绿**（与 opentype.js 那次同型）。已拆成纯函数 `product-colours.ts`（无 node 依赖）+ 读图 `product-colours-read.ts`（含 sharp），并加源码级边界单测防回退。**凡被客户端组件导入的模块，一律不得 import sharp / node:*。**
- **海报产品合成「测量化」（用户第二次反馈的继续）**：艺术方向改平面后**设计本身 9/10**（字即构图、无摄影），但**合成真实产品后掉到 6/10**，三次独立评语都指向「product photo pasted on / the lighting doesn't match」。① 新增 `poster-grade.ts`——**采样预留产品窗的实测环境光**（`sampleRegion` 读 `stageRect`，与提示词/合成坐标同源），对抠图做**部分**校正（亮度最多 ±10%、色偏 0.94–1.06），因为标签颜色不能改。② **实测否决了「给抠图加墨色描边」**（两次评语都说描边让它「look like a distinct, pasted-on element」，正是要治的病）→ 已撤掉，源码留注释 + 单测防回退。③ 提示词把预留区改为**「摄影窗」并给出精确百分比坐标**（由 stageRect 算出），窗内只画无缝影棚布景 + 落影、禁止任何物体，**窗底色必须取自海报自身配色、不得纯白亮盒**（实测纯白窗在暗色海报上 "punches a hole"）。④ 新增 `product-colours.ts`——**从真实抠图读出包装主色**（跳过透明像素、64×64 降采样、命名颜色、**优先取有色相的颜色**，因为「黑+炭黑」对配色毫无信息）写进提示词，让模型**围绕产品选色**（PRODUCT PALETTE 优先于风格里写死的配色）。新增 tests/marketing-poster-grade.test.ts 15 例 + tests/marketing-product-colours.test.ts 15 例。**实测**：真实渲染 stage luma 0.428 → brightness 0.900、cast 1.042/0.991/0.961；读回 ok 无缺失词；评语确认窗是「distinct rounded rectangle with a **dark red** background」（从纯白盒 → 与产品同色系），且「typography is not just text but a graphic element」。**⚠️ 已知局限（诚实记录，未解决）**：**照片级抠图 vs 平面插画的风格差**靠光照/调色消除不掉，评语三次都提同一句。三条路（需 owner 定）：(a) 放产品时默认走摄影向风格（字排版会退步）(b) 接受「产品插图窗」版式（杂志常见）(c) 对抠图做印刷化处理（半调/双色调）——效果最好但会改标签颜色。
- **抠图印刷化处理 + 取消产品窗（owner 说「根据你的建议」，即方案 c）**：新增 `poster-print.ts`——对比度 1.12 + 饱和度 1.06 + **6 级色阶** + **斜向网点纹理**（13% 不透明、pitch 随尺寸缩放）。**为什么 6 级不是真海报的 3 级**：3 级会毁掉标签小字，品牌标签不是我们能溶解的东西；`tonalRange()` 守这条线。**实测标签仍全部可读**（并排给视觉模型逐字转录，处理前后文字完全相同，评语「reads like screen-printed」）。**自己造的严重 bug（已修）**：网点层用 joinChannel 贴 alpha 时，对几乎全透明的网点栅格先 `removeAlpha()` 会得到**整块不透明黑色画布** → **产品全变纯黑剪影、标签全毁**（代码看不出，只有图能看出）；改为**手动相乘两个 alpha**，并加回归测试（不得变黑/形状保持/色阶数下降）。**同时取消了上一轮的「摄影窗」**：产品已是印刷品、不再需要照片容身之处，提示词改为**要求预留区与画面连续**（明确禁止 panel/inset/frame/box/plate），实测评语「No distinct panel — the artwork continues through that area」。新增 tests/marketing-poster-print.test.ts 15 例。**⚠️ 仍未解决**：产品**接地感**（阴影方向/透视/光照一致性）是评语当前最大弱点，需真实场景光照理解，或让 AI 画产品（会编造标签，是底线，不做）。
- **下一步（内容引擎 P1-P7 已全部完成）**：可选 = ① 服务价目表补齐（否则内容不能报价）② YouTube API key 开启自动爆点 ③ 排期日历视图 ④ **产品接地感/阴影方向匹配**（见上，需真实场景光线理解）。
- **可选补充**：YouTube Data API key（放 `YOUTUBE_API_KEY`）可开启自动拉取 MY 地区热门，非必需。
- **运行脚本**：`pnpm exec tsx scripts/import-promo-products.ts`（产品，依赖 /tmp/dz-p 的优化图，重跑前需先解压 Product.zip 并转 WebP）· `scripts/seed-brand-profiles.ts` · `scripts/apply-dashoil-brand.ts` · `scripts/seed-occasions.ts`（18 个月发薪日滚动）

## 生产事故（2026-09-10，已修复）
- **现象**：PR#11 合并后生产全站 500（Vercel ERROR 3985325722，`/` 返回 500）。
- **根因**：**不是 Vercel 的问题**——生产 PG 缺 6 个新列（Campaign.audienceRules/pointsBonus、Booking.promoDiscountSen/promoSnapshot、Lead.campaignId、Organisation.promoAutoApply）。Prisma 默认 SELECT 所有标量字段，**缺一列即整表查询报错 → 全站挂**，而非只挂新功能。
- **修复**：幂等纯新增 DDL（含 Lead_campaignId_fkey），事务提交；既有数据未变（10 笔 booking promoDiscountSen=0、旧 campaign/lead 新字段 NULL）。已确认生产全部 200、无 500。
- **根治（本轮完成）**：`scripts/sync-prod-schema.mjs` + `vercel.json` buildCommand。`VERCEL_ENV=production` 时**检查→应用新增变更→复验**（`prisma migrate diff` + `prisma db push --skip-generate`，不带 --accept-data-loss）；preview/本地**只检查不动手**。**改 schema 只需改 `schema.pg.prisma`，构建期自动同步生产**——不再依赖人肉记着加列。
- **安全网**：DROP/TRUNCATE **一律拒绝并 exit 1**；db push 自身也拒绝数据丢失；只碰 `DATABASE_URL` 实际使用的库（本地 sqlite 直接跳过，显式检查用 `DRIFT_CHECK_URL`）；库不可达只警告放行；新增列向后兼容，先于新代码生效无风险。
- **顺手挖出的第二个隐患**：生产库有 schema 里**没有**的列 `Organisation.qrEnabled`（全代码零引用、git 历史从未出现、值仅默认 true，早期手工 DDL 遗留）。只查 schema→DB 单向是发现不了的；若直接接 db push 会**每轮构建都 DROP 生产列**。已用 `@ignore` 非破坏性化解（保留列、不进 client、不参与 diff），日后可专门清理。同时补上生产真正缺失的 `Booking_servicePackageId_fkey`（验零孤儿后应用）。
- **诊断命令**：`set -a; . ./.env; set +a; DRIFT_CHECK_URL="$DST_DATABASE_URL" node scripts/check-prod-schema-drift.mjs`

## 下一步（按优先级）
1. **合并 `fix/build-timeout-schema-sync`**（PR：https://github.com/dashoilhrSAM/D-Z_CRM/pull/new/fix/build-timeout-schema-sync）——**部署超时修复**，合并后生产才可能部署成功。**同时需在 Vercel 加 `DIRECT_URL`**（Supabase 直连 5432，非池化）。
2. **（原）合并 `feat/marketing-content-engine`**（PR：https://github.com/dashoilhrSAM/D-Z_CRM/pull/new/feat/marketing-content-engine）——前置的 `fix/prod-schema-drift-guard` 已进 main（PR #12），**基已就位、可干净合并**，不会再触发上次那种全站 500。该分支含 10 个 commit（内容引擎 P1-P7 + 海报艺术方向 + 抠图印刷化）。
2. **可选清理**：`Organisation.qrEnabled` 现以 `@ignore` 挂着，可择机真正 DROP（需人工决定）。
3. **经销商验证（需真人）**：填 docs/DEALER_FEEDBACK.md，按 DEMO_SCRIPT 演示，回答 6 个产品决策（dtodo 59e04e5e，逾期）。
4. **WhatsApp 真机上线（dtodo 92b29072）**：SETUP §5.3.1 五步 —— 生产 PG 幂等加 Message.externalId 列 → push main（auto-deploy）→ Vercel 配 WHATSAPP_* env → Meta 配 webhook → 验证回执。
5. **Payment / Notification provider 选型**（待用户定网关/推送方案）。
6. **Marketing 后续可选**：consent 口径（PDPA）待用户定夺——目前无 consent 记录时放行，已提供 per-campaign `requireMarketingConsent` 条件；以及把频率上限 7 天做成可配置。
7. 可选：继续给更多页面加 FeatureTutorial（tutorial-definitions.ts 加 def + data-tut + i18n tut.*）。

## 基线测试（命令 + 期望通过数）
- `pnpm exec tsc --noEmit`：0 错误
- `pnpm test`：**285 个通过**（22 文件；含 marketing-content/trends/occasions/poster/poster-design/broadcast/schema-sync 等）
- `pnpm exec tsc --noEmit`：**注意用 `set -o pipefail`**，否则 `| head` 会掩盖真实退出码（本次就因此漏看了 3 个类型错误）
- `pnpm build`：通过（本地 sqlite；生产 build 复现用 `pnpm exec prisma generate --schema prisma/schema.pg.prisma && pnpm exec next build`）
- `pnpm exec playwright test e2e/marketing.spec.ts --project=desktop-chromium`：9 通过（会 wipe+seed prisma/e2e.db 并重启 :3102）
- 端到端实测：`pnpm exec tsx scripts/verify-marketing-promo.ts`（5/5）、`pnpm exec tsx scripts/verify-marketing-invoice.ts`（6/6）

## 服务与恢复
- workshop demo :3002：`curl localhost:3002` = 200 ｜ 挂了：`launchctl kickstart -k gui/$(id -u)/com.dz-platform.server`
- rider demo :3003：`curl localhost:3003` = 200 ｜ 挂了：`launchctl kickstart -k gui/$(id -u)/com.dz-platform.rider`
- e2e :3102：`curl localhost:3102` = 200 ｜ 挂了：`launchctl kickstart -k gui/$(id -u)/com.dz-platform.e2e`
- **改源码后必须 `pnpm build` 再 kickstart**，否则服务仍跑旧 .next（本次已踩到）。
- 生产：https://d-z-crm.vercel.app （push main auto-deploy；Vercel 曾因 GitHub App RBAC 停更）

## git 状态
- 当前分支：**feat/marketing-content-engine**（栈在 fix/prod-schema-drift-guard @ 0b37413 之上，已 push，等 owner review：内容引擎 P1-P7 + 海报艺术方向）
- **踩坑提醒**：`git add -A scripts/` 会把项目历史遗留脚本（capture-*.ts、gen-*.ts/py、_dims.ts 等 11 个）一起提交，已 amend 撤回；加文件务必逐个列出
- main = origin/main = **3ae3bad**（PR#12 fix/prod-schema-drift-guard 已合并；本地 main 已 ff 同步）
- 已合并分支：feat/marketing-system（eb76825/c5a7260/047f61e）、fix/branch-attribution-and-broadcast(8710683) 均已进 main，本地可删
- 另一分支：fix/branch-attribution-and-broadcast @ 8710683（已 push，其改动已被 feat/marketing-system 包含）
- 另：`feat/marketing-content-engine` 未含 main 的合并提交 3ae3bad，但共同祖先 0b37413 已在 main 内 → 合并干净；如需本地验证可 `git merge origin/main` 后再跑基线。
- 未提交：docs/HANDOFF.md（会话文档，随功能一起提交）+ 大量 untracked（docs/setup-templates、docs/templates、screenshots/*、docs/logo-png 等历史产物，**勿 git add -A**）
- 已合并分支：fix/mechanic-branch-scope(9f0e163) 已进 main，本地分支可删；本轮两分支待 review 后删

## 关键决策与约定
- 工作流：一切改动走 feature branch → push → **owner 在 GitHub review + merge**；不直接 push main、不自行触发 Vercel 部署。
- 分行隔离：org 级角色（SUPER_ADMIN/OWNER/HEAD_OFFICE_ADMIN）看全部份；其余锁 session.branchId（src/lib/branch-scope.ts）。选 staff/mechanic 用 scopedStaffWhere；job 创建/分配按 session/branch 且拒绝跨行 mechanic。
- 消息：所有 workshop→rider WhatsApp 必须走 messagingModule.sendDirect/sendFromTemplate（经 provider 真发、记录真实 status/externalId），禁止直写 `status:"SENT"` 伪送达。
- 双 schema 同步铁律：prisma/schema.prisma（sqlite）+ prisma/schema.pg.prisma（PG）必须同步改。
- 业务日期存 UTC 零点；金额存整数 sen。

## 踩坑与事实
- 服务是 launchd `next start`，读 ./next —— 改源码必须 build + kickstart 才生效。
- src/lib/i18n.ts > 2000 行：read(默认 limit 2000)+write 会**截断**，必须用 edit。
- 合并 fix/staff-access 与分行分支时 workshop.ts 冲突：createStaff 重复 `const session` 声明 + 重复 `getSessionUser` import。
- 本地 dev.db 重置后 Customer.authId 丢失 → rider 登录报 'No D&Z account linked'（教学/演示截图用生产环境）。
- Branch/ServicePackage/Inventory 等无 createdAt（defaultSort/select 勿用）。

## 待办（dtodo）
- 59e04e5e 经销商验证（逾期 2026-08-19，需真人）
- 92b29072 生产迁移 q2 / provider 换真（逾期 2026-08-19）：WhatsApp 上线 5 步 + Payment/Notification 选型

## 新会话头 10 分钟
1. 探活：`curl localhost:3002` / :3003 / :3102（挂了 `launchctl kickstart -k gui/$(id -u)/com.dz-platform.{server,rider,e2e}`）
2. 读 docs/HANDOFF.md + memory（project/daily）+ `dtodo list`
3. 跑基线：`pnpm exec tsc --noEmit`（0）+ `pnpm test`（53）
4. 从「下一步」挑：起新分支收严剩余 isMain / 经销商验证(需真人) / WhatsApp 上线
5. 若改了源码：`pnpm build` 后 kickstart 重启服务再验证
