# D&Z Platform — Setup & Preparation

> 运维/配置/准备清单总台账。覆盖本地开发、各模块配置、API、测试环境、生产迁移预备。
> **维护约定（已确认）**：每次涉及 env/模块/API/迁移/端口/依赖/测试/i18n 的改动，必须在 **§9 变更台账** 追加一行（日期|改动|影响），并视情况更新 §2 env 表 / §3 迁移表 / §5 生产清单。这是项目配置中心，改动相关配置时务必同步。

---

## 1 · 本地环境 (Local Dev)

### 1.1 前置要求
| 项 | 版本/要求 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 20 (实测 24.19.0) | 运行时 |
| pnpm | 9+ (workspace) | 包管理 |
| SQLite | 内置（Prisma 驱动） | 本地数据库，无独立服务 |
| Next.js | 16 (App Router) | 框架 |
| React | 19 | UI |
| Playwright | 内置 | E2E |

### 1.2 首次安装 & 启动
```bash
cd "/Users/Jun/Documents/CRM-D&Z"
pnpm install              # 安装依赖
pnpm db:reset             # 建库 + migrate + seed（demo 数据）
pnpm dev                  # 开发服务器（自动选端口，勿用 3000）
pnpm build && pnpm start --port 3002   # 生产模式 demo
```

### 1.3 端口约定（重要）
| 端口 | 用途 | 守护 |
| --- | --- | --- |
| **3002** | demo 服务（dev.db） | launchd `com.dz-platform.server` |
| **3102** | e2e 服务（e2e.db） | launchd `com.dz-platform.e2e` |
| ~~3000~~ | **禁用**——被 DashOil 应用抢占并会 kill 占用者 | — |

**服务管理（sandbox 会 SIGTERM 普通后台进程，必须用 launchd）**：
```bash
launchctl list | grep dz-platform                    # 状态
launchctl kickstart -k gui/$(id -u)/com.dz-platform.server   # 重启 demo
launchctl kickstart -k gui/$(id -u)/com.dz-platform.e2e      # 重启 e2e
```
plist 文件：`com.dz-platform.server.plist` / `com.dz-platform.e2e.plist`

---

## 2 · 环境变量 (Environment)

当前只有 **1 个**本地 env（`.env`）：

| 变量 | 本地值 | 生产（迁移后） | 用途 |
| --- | --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | Supabase Postgres 连接串 | 主数据库 |
| `NEXT_PUBLIC_BASE_URL` | `http://192.168.100.240:3002` | 生产域名 | 分享/提醒链接基准；真机预览时=Mac 局域网 IP（`ipconfig getifaddr en0`，IP 变化需改此值并 rebuild） |

### 生产需要新增的 env（预留给 §5 迁移）
| 变量 | 用途 | 来源 |
| --- | --- | --- |
| `DATABASE_URL` | Supabase PostgreSQL | Supabase Project Settings |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 前端 URL | Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名密钥 | Supabase |
| `OPENAI_API_KEY` | AI provider（生产） | OpenAI |
| `WHATSAPP_API_TOKEN` | Meta WhatsApp Business API | Meta Developers |
| `WHATSAPP_PHONE_ID` | WhatsApp 商业号 | Meta |
| `WHATSAPP_VERIFY_TOKEN` | WhatsApp webhook 验签 | Meta Developers |
| `WHATSAPP_APP_SECRET` | WhatsApp webhook HMAC 验签（可选） | Meta Developers |
| `STORAGE_BUCKET` | Supabase Storage bucket | Supabase |
| `SENTRY_DSN` | 错误监控 | Sentry |
| `NEXTAUTH_SECRET` / `AUTH_SECRET` | 认证加密 | 自生成 |

> ⚠️ `.env` 不入库（gitignore）。生产 env 在 Vercel/Supabase 配置。

---

## 3 · 数据库 (Prisma / SQLite → Postgres)

### 3.1 本地
- SQLite 文件：`prisma/dev.db`（demo）、`prisma/e2e.db`（测试，每次跑前清空）
- Schema：`prisma/schema.prisma`
- Seed：`prisma/seed.ts` → `src/lib/seed-core.ts`（确定性 RNG，锚定当天日期）

### 3.2 迁移记录（按时间顺序）
| 迁移 | 说明 |
| --- | --- |
| `20260818060637_init` | 初始 schema（全 §51 实体） |
| `20260818063040_review_job` | 评价/工单关联 |
| `20260819004907_promo_discount` | Campaign.discountPercent（促销引擎） |
| `20260819021924_motorcycle_type` | Motorcycle.type（车型分类） |
| `20260819043819_booking_campaign_attr` | Booking.campaignId（促销归因） |
| `20260819044007_review_reply` | Review.reply/repliedAt（评价运营） |
| `20260901005433_whatsapp_message_external_id` | Message.externalId（WhatsApp 回执关联键） |

### 3.3 数据模型（33 模型）
身份：`Organisation → Branch → User / Customer (+CustomerAuthProfile)`
车辆：`Customer → Motorcycle`
运营：`Booking → ServiceJob → (ServiceJobItem / ServiceJobPart / ChecklistExecution / InspectionFinding / CustomerApproval)`
商品：`Product / Inventory / StockMovement / Supplier / PurchaseOrder(+Item)`
财务：`Invoice(+Item) / Payment`
沟通：`Message / Notification / ServiceReminder`
营销：`Campaign / MarketingAsset / ContentScript / Review`

### 3.4 命令
```bash
pnpm db:migrate   # 开发迁移（改名 prisma migrate dev）
pnpm db:reset     # 硬重置（drop + migrate + seed）——改动 schema 后必跑
pnpm db:seed      # 重新播种
pnpm db:studio    # Prisma Studio 可视化
```

### 3.5 E2E 数据库注意
`e2e/global-setup.ts` 每次跑测试前：**删 e2e.db → migrate deploy → seed → 重启 e2e launchd**（SQLite 句柄过期）。
改 schema 后若 e2e 报「列不存在」，先手动 `DATABASE_URL=file:./e2e.db pnpm exec prisma migrate deploy` + kickstart。

### 3.6 真机预览 Rider（手机同 Wi-Fi）
三种预览方式：
1. /preview 页（电脑浏览器）——手机设备外壳 + 真实 Rider 页面，可切页面/语言/角色/设备。
2. Chrome DevTools 移动模拟——F12 → 手机模式（iPhone/Pixel）。
3. 真机访问（最真实）：手机连同一 Wi-Fi，浏览器打开 http://192.168.100.240:3002 → 点 Demo bar 切到 CUSTOMER → 进 /rider/home。
   - 服务已监听所有接口（next start 默认 0.0.0.0），防火墙已关。
   - 分享/提醒链接经 NEXT_PUBLIC_BASE_URL 指向该 IP（改了 IP 后需 rebuild）。

---

## 4 · 模块配置 & API

### 4.1 Provider 抽象（src/providers/）
| Provider | 原型实现 | 生产替换（§5） | 用途 |
| --- | --- | --- | --- |
| Messaging | `mock-whatsapp.ts`（模拟发送） | Meta WhatsApp Business API | 客户消息/群发 |
| AI | `mock-ai.ts`（规则文案） | OpenAI | 销售推荐/AI 中心 |
| Storage | `local.ts`（./storage 文件） | Supabase Storage | 海报/素材上传 |
| Payment | `mock-payment.ts`（自动成功） | 支付网关 | 发票支付 |
| Notification | `local.ts` | 推送服务 | 通知 |

> 业务代码只依赖接口（`src/providers/types.ts`），生产换实现不动业务层。

### 4.2 API 路由（src/app/api/）
| 路由 | 方法 | 用途 |
| --- | --- | --- |
| `/api/recommendations?motorcycleId=&mileage=` | GET | AI 销售推荐（创建工单时） |
| `/api/search?q=` | GET | 全局搜索（Ctrl+K 命令面板） |
| `/api/supplier-for-product?productId=` | GET | 产品→供应商查询（采购） |

### 4.3 Server Actions（src/actions/）
| 文件 | 主要 action |
| --- | --- |
| `workshop.ts` | createJob / transitionJob / assignMechanic / bookingAction / createStaff / toggleStaffActive / updateJobDetails / addJobServiceItems / removeJobItem / addAiRecommendation / createPurchaseOrder / receivePurchaseOrder |
| `rider.ts` | bookService / respondApproval / addMotorcycle / updateMotorcycle / submitReview / markNotificationsRead / updateProfile |
| `marketing.ts` | createCampaign / updateCampaign / createPoster / createScript / publishReview / replyToReview / broadcastCampaign |
| `demo.ts` | setPersona / resetDemo |
| `language.ts` | setLanguage |

### 4.4 业务目录（src/lib/）
| 文件 | 用途 | 生产备注 |
| --- | --- | --- |
| `i18n.ts` | 三语字典（en/zh/ms，395+ 词条） | 可换 next-intl |
| `motorcycle-types.ts` | 12 类车型目录 | 固定 |
| `service-catalog.ts` | 12 项服务目录 | 固定 |
| `bike-models.ts` | 品牌→型号映射 | 固定 |
| `nav-registry.ts` | 部门导航矩阵 | 权限相关 |
| `demo-user.ts` | persona→User 映射 | §5 换真实 Auth |
| `reset.ts` | RESET DEMO DATA | 生产移除 |

---

## 5 · 生产迁移清单 (§65) — READY WHEN

### 5.1 数据库
- [ ] Supabase 建 Project，创建 Postgres 数据库
- [ ] `prisma migrate deploy` 到 Supabase（SQLite→Postgres 差异检查：enum/JSON/cuid）
- [ ] 数据迁移脚本（dev.db → Postgres）：用户、客户、工单、发票全量
- [ ] **RLS（Row Level Security）**：按 tenant/branch/role 策略
- [ ] 迁移后移除 SQLite 路径，`DATABASE_URL` 指向 Postgres

### 5.2 认证 (Auth)
- [ ] Supabase Auth（email/phone + OTP），替换 demo persona cookie
- [ ] `User` / `Customer` 与 Auth 用户关联（id 对齐）
- [ ] 部门角色（Owner/Counter/Mechanic/Rider）映射到 Auth role
- [ ] 中间件从 cookie-persona 改为真实 session（现有 nav-registry/middleware 复用）

### 5.3 Provider 换真
- [x] Messaging 代码就绪并已合并到 main（merge feat/whatsapp-real-provider = d9f297a：E.164 归一化 + Message.externalId + 回执 webhook /api/webhooks/whatsapp），见下方 5.3.1 上线步骤（未上线，仅欠真实密钥与 webhook 配置）
- [ ] AI → OpenAI（`OPENAI_API_KEY`，代码就绪选中即换真）
- [x] Storage 已换真（生产 VERCEL=1 → Supabase Storage dz-assets）
- [ ] Payment → 网关（Stripe/FPX，未做）
- [ ] Notification → 推送（FCM/APNs，未做）

#### 5.3.1 WhatsApp Messaging 上线步骤（按顺序，缺一不可）
1. **生产 PG 加列（幂等，必须先于 push 部署）**——Supabase SQL editor 执行：
   ```sql
   ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
   ```
   （对应迁移 `prisma/migrations/20260901005433_whatsapp_message_external_id`；本地 dev.db 已含此列。）
2. **push main 触发 Vercel auto-deploy**：本地 `git push origin main`（勿本地 `vercel deploy`）。
3. **Vercel 配置 env（production）**：`WHATSAPP_API_TOKEN`、`WHATSAPP_PHONE_ID`、`WHATSAPP_VERIFY_TOKEN`、`WHATSAPP_APP_SECRET`（可选，启 HMAC 验签）；AI 另配 `OPENAI_API_KEY`。
4. **Meta 配置 Webhook**：Meta Developers → WhatsApp → Configuration → Callback URL = `https://d-z-crm.vercel.app/api/webhooks/whatsapp`，Verify token 与 `WHATSAPP_VERIFY_TOKEN` 一致，Subscribe `messages`。
5. **验证**：生产配 token 后发一条消息 → `Message.externalId` 有值、status 随回执更新（GET 验签 hub.challenge 200）；无 token 时走 mock（本地 :3002）。

### 5.4 部署
- [ ] Vercel 项目创建 + 环境变量配置（§2）
- [ ] 构建验证（`pnpm build` 通过）
- [ ] 域名/SSL
- [ ] CI（.github/workflows/ci.yml 已就绪：lint → typecheck → vitest → playwright → build）
- [ ] Sentry 接入（`SENTRY_DSN`）
- [ ] k6 压测（staging：10/100/500/1000 并发，目标 <2s）

### 5.5 数据治理
- [ ] 移除 demo-only：resetDemo、persona switcher、mock providers、确定性 seed
- [ ] 移除 dashboard 的「Demo customer」硬编码（Ahmad）
- [ ] 真实素材：public/posters/ 迁移到 CDN/Supabase Storage

---

## 6 · 测试环境

| 套件 | 命令 | 数量 | 说明 |
| --- | --- | --- | --- |
| Unit (Vitest) | `pnpm test` | 20 | 业务逻辑（money/state-machine/prediction/promo） |
| E2E (Playwright) | `pnpm exec playwright test` | 75 (+6 skip) | 3 浏览器矩阵 × 主旅程/预约/库存/smoke |
| CI | GitHub Actions | — | lint→typecheck→vitest→playwright→build |

**E2E 关键约定**：
- 独立 DB（e2e.db），global-setup 每次清库重播种
- `helpers.ts` setPersona 固定 `dz_lang=en`（测试断言英文文本，i18n 不破坏）
- e2e 服务必须 **build + kickstart 后**才能跑（testids 在 build 里）

---

## 7 · 素材 & 静态资源

| 资源 | 路径 | 说明 |
| --- | --- | --- |
| 海报图片 | `public/posters/*.png`（10 张） | seed 引用，workshop/rider 显示 |
| 源文件 | `Marketing_Poster/`（不入库） | 设计源 |
| 截图 | `screenshots/*.png` | 功能验证存档 |

---

## 8 · 语言 (i18n)

- 三语：English / 中文 / Bahasa Malaysia
- 字典：`src/lib/i18n.ts`（395+ 词条，key → {en, zh, ms}）
- 切换：demo-bar 的 EN/中文/BM 按钮 → `dz_lang` cookie（一年）
- 架构：server 页 `getLang()` + `t()`；client 组件 `useLang()` context
- **新增文案必须三语**（en 保持原始 UI 大小写，zh/ms 翻译）
- 覆盖：全部页面（workshop 30+ 页 + rider + 框架层）。剩余：部分 toast、AI 动态文案

---

## 9 · 变更台账 (Changelog of setup-relevant changes)

> 每次涉及 env/模块/API/迁移/端口/依赖/测试的改动，在此追加。

| 日期 | 改动 | 影响 |
| --- | --- | --- |
| 2026-09-10 | **生产事故修复 + schema 漂移守卫**（分支 fix/prod-schema-drift-guard）：PR#11 合并进 main 后生产全站 500（Vercel ERROR 3985325722，`/` 返回 500）。根因=**生产 PG 缺 6 个新列**（Prisma 默认 SELECT 所有标量字段，缺列即整表查询报错→全站挂，而非只挂新功能）：Campaign.audienceRules / Campaign.pointsBonus / Booking.promoDiscountSen / Booking.promoSnapshot / Lead.campaignId / Organisation.promoAutoApply。已用**幂等且纯新增**的 DDL 事务修复（含 Lead_campaignId_fkey 外键，默认值向后兼容，既有数据未变：10 笔 booking 的 promoDiscountSen 全为 0、旧 campaign/lead 新字段为 NULL），生产已恢复 200。**防复发**：新增 `scripts/check-prod-schema-drift.mjs`（纯 .mjs + pg，解析 schema.pg.prisma 与 information_schema 比对，漂移则打印精确幂等 DDL 并 **exit 1 阻断部署**），接入 vercel.json buildCommand。守卫策略：真漂移→阻断；连不上库→警告放行（不因网络抖动卡部署）；本地 sqlite→跳过（默认只检查 DATABASE_URL 实际使用的库，避免本地构建误连生产；显式检查用 DRIFT_CHECK_URL） | 生产已恢复；同类事故此前已发生 4 次（ServiceJobPhoto / Quotation / commissionRules / 本轮 marketing），现由构建期守卫拦截，不再以线上 500 的形式暴露。验证：正向（对生产）=0 漂移 exit 0；反向（临时 schema 注入 2 列）=精确 DDL + exit 1；tsc 0 / vitest 129（16 文件，含 drift-guard 8 例）/ build 0。⚠️ 遗留：prisma/migrations 是 sqlite 方言，无法用 `prisma migrate deploy` 自动同步生产，故仍需构建期守卫 + 手工幂等 DDL |
| 2026-09-10 | Marketing 完整化续（同分支 feat/marketing-system）：**②促销自动生效改为 marketing 可控开关** 新增 `Organisation.promoAutoApply Boolean @default(true)`（双 schema + 迁移 add_org_promo_auto_apply），`promo-resolve.ts` 由源码常量改为读 `isPromoAutoApplyEnabled()`（resolvePromoForBooking 支持 autoApply 覆盖供测试），新增 `setPromoAutoApply` action + 促销日历页开关（`components/workshop/promo-auto-apply-toggle.tsx`，开启时显式提示会减少营收）；关闭后仅带 campaign 链接的预约打折。**P4 统一群发管线** 新增 `src/modules/marketing/broadcast.ts`（`broadcast()` + 纯函数 limitRecipients/applyFrequencyCap）——campaign 群发与 poster 群发两条重复路径合并为一条，统一 opt-out/真实计数/频率上限（默认 7 天内不重复营销触达，可 per-run 关闭）；顺带修掉 sendPosterToCustomers 把**所有异常都算作 skipped**（provider 失败与退订无法区分、失败计数丢失）。**P5 生命周期 + 总览页** 新增 `src/modules/marketing/lifecycle.ts`（纯 effectiveCampaignStatus + syncCampaignStatuses）：SCHEDULED 到点自动 ACTIVE、过期自动 ENDED，DRAFT 永不自动激活、ENDED 终态；日历页读取前先同步，使展示状态与折扣引擎一致。新增营销总览 landing `/workshop/marketing`（KPI 卡/归因收入与折扣成本/进行中促销/子页入口）+ nav-registry 加 Marketing Overview 项。**MKT-014 积分促销** 新增 `Campaign.pointsBonus Int?`（双 schema + 迁移 add_campaign_points_bonus），completion.ts 在基础积分上叠加该 campaign 的奖励积分并单独记一条 CAMPAIGN 流水；campaign 表单加「奖励积分」字段。**P6** 新增 e2e/marketing.spec.ts（5 路由渲染 + 总览 + 建活动/受众预览 + 开关往返，测完复原） | 促销是否对所有预约自动打折由 marketing 在页面上决定，无需改代码发版；所有营销发送走单一管线，失败不再被误记为「跳过」，并有 7 天频率上限防止同一客户被连续轰炸；SCHEDULED 活动到点真的会开始、过期真的会结束；活动可发奖励积分。验证：tsc 0 / vitest 124 通过（15 文件，较上轮 +21）/ next build exit 0；实测 scripts/verify-marketing-invoice.ts 6/6（含 6000→1200→4800 与积分 +50 加成）。⚠️ 生产 PG 需幂等加列：Organisation.promoAutoApply BOOLEAN DEFAULT true、Campaign.pointsBonus INTEGER |
| 2026-09-10 | Marketing 系统完整化 P1-P3（分支 feat/marketing-system，待 owner review）：**P1 受众引擎** 新增 `src/modules/marketing/audience.ts`（纯函数 buildAudienceWhere(orgId, rules) → Prisma.CustomerWhereInput，全是数据库侧过滤，不再把全量客户拉进内存）+ `Campaign.audienceRules Json?`（双 schema + 迁移 add_audience_rules_and_booking_promo）；规则维度 tags/branches/motorcycleOwned/models/lastServiceWithinDays/inactiveForDays/joinedWithinDays/tiers/overdueService/requireMarketingConsent；新增 `previewAudienceCount` server action + `components/workshop/segment-builder.tsx`（替换原 5 选项下拉）+ 日历页每 campaign 真实受众数。**P2 促销真正生效（MKT-013）** 新增 `src/modules/marketing/promo-resolve.ts`——把已存在但**全仓零调用**的 `bestPromoQuote` 接进链路：`bookingService.create` 建单时解析 promo（显式 campaignId 优先，否则取最优 active，受 `AUTO_APPLY_BEST_PROMO` 常量控制）并落 `Booking.promoDiscountSen` + `promoSnapshot Json?`（双 schema）；`completion.ts` 建 invoice 时按 snapshot 百分比写 `discountSen` 且 `totalSen`/`Payment.amountSen` 同步扣减；rider `book-form` 显示原价划线 + 折扣行 + 应付总额。**P3 归因与 ROI（MKT-015/016/017）** `Lead.campaignId`（双 schema + 迁移 add_lead_campaign_attribution）+ `Campaign.leads` 反向关系；website enquiry / `/contact?campaign=` 透传归因；新增 `src/modules/marketing/performance.ts`（纯 computePerformance + loadCampaignPerformance，聚合 leads/bookings/收入/折扣成本/转化率/ROI）并在日历页展示。审计修复：① 日历页此前把**全局** dueCustomers 当成每个 campaign 的受众展示（数字错误、误导投放决策）→ 改为真实受众数；② 旧 audienceCustomers 的 `30_DAYS` 与 `60_DAYS` 走同一状态列表、**返回完全相同客户集** → 现按真实天数；③ broadcastCampaign 消息 branchId 由 operator session branch 改为 **campaign 自身 branch**。⚠️ 生产 PG 需幂等加列：Campaign.audienceRules JSONB、Booking.promoDiscountSen INTEGER DEFAULT 0 + promoSnapshot JSONB、Lead.campaignId TEXT | 折扣从「只在页面显示」变为真正在 booking/invoice 生效（rider 看到 −20% 就实付 −20%）；受众可按标签/分行/车型/服务史/沉睡天数/会员等级组合筛选并预览人数；campaign 可看 leads/预约/收入/转化/ROI。验证：tsc 0 / vitest 99 通过（13 文件，本轮 +27）/ next build exit 0；双 schema 均已 generate 通过 |
| 2026-09-10 | 分行归属 + 群发真发收严（分支 fix/branch-attribution-and-broadcast，待 owner review）：① `src/actions/leads.ts` createLead/convertLead 改按 session branch 归属（org 级回退主店；convert 优先沿用 lead 自身分行，缺失才回退）——此前硬编码 isMain 主店，导致 branch 级用户新建的 lead 立即被 leads 列表（按 session.branchId 过滤）滤掉、建完即消失；② `src/actions/marketing.ts` broadcastCampaign 改走 messagingModule.sendDirect(isMarketing:true)，补 MSG-017 opt-out 跳过 + 真实 status/externalId + MSG-020 失败记录，返回值由 `{sent,audience}` 改为 `{sent,failed,skipped,audience}` 并按真实结果计数（此前直接用 messagingProvider 直发、opt-out 被绕过、且 sent++ 无论成败都累加）；同文件 defaultBranch() 取代 mainBranchId() 的硬编码；③ `src/modules/crm/service.ts` sendMessage 同改走 messagingModule（branchId 由 hardcode null 改为 customer.branchId，去掉重复 opt-out 分支）；④ `app/workshop/ai/page.tsx` branch 按 session 收窄（此前完全未收窄、恒读主店）。新增测试 tests/broadcast-messaging.test.ts / lead-branch-attribution.test.ts / crm-send-message.test.ts | 营销群发不再发给已退订客户（合规）、失败不再计入「已发」；branch 级用户建的 lead 落在自己分行、可见；技师/customer 消息按分行归属。验证：tsc 0 / lint 0 error（827 pre-existing warnings）/ vitest 62 通过（原 53，+9）/ next build exit 0；新测试对未修复源码实测 4 条失败、修复后全绿 |
| 2026-09-07 | 数据清理：删除「D&Z Smart Workshop」的 Shah Alam 与 Johor Bahru 两个分行（本地 dev.db + 生产 PG）。连带删除两分行库存(Inventory 56 条)与 JB 的 Message(14 条)；JB 客户 Muhammad binti Zain（018-492 8009）保留，branchId 置 null（org 级共享）。现剩 主店 KL + Testing Branch 两分行 | 分行精简；客户不丢，变 org 级；幂等 SQL（事务：删 Inventory/Message → 客户置空 → 删 Branch） |
| 2026-09-07 | Mechanic 逐单奖金：新增 ServiceJob.bonusSen（双 schema 同步 + 迁移 add_service_job_bonus）；updateJobBonus action + 结算视图每单 Bonus 输入；Mechanic 收入页每单显示佣金+奖金、总佣金/总奖金(Σ per-job) | 技师每单可手填奖金并展示总奖金。⚠️ 生产 PG 需幂等加列：ALTER TABLE \"ServiceJob\" ADD COLUMN IF NOT EXISTS \"bonusSen\" INTEGER; |
| 2026-09-07 | Mechanic App 收入页精简（feat/mechanic-earnings-simplify）：去掉「服务价值」展示，每个完成工单只显示佣金(ServiceJob.commissionSen)，汇总卡改为 完成工单/总佣金(Σ commissionSen)/总奖金(Σ StaffPayout.bonusSen)；i18n 增 mech.commission/bonus/total-* | 技师收入页只看到自己的佣金与奖金（不再显示客户服务金额）；build0/tsc0/test48 全绿 |
| 2026-09-07 | 结算佣金默认放 RM10（feat/mechanic-earnings-simplify 调整）：结算表单每单「佣金」输入 placeholder 改为 10、失焦为空默认存 1000sen=RM10（仍可直接改）；结算与 Mechanic 收入页未手动设值(commissionSen=null)时统一显示 RM10，收入页总佣金按 (commissionSen ?? 1000) 累加 | 默认每单佣金 RM10、可即时改，无需逐单手填；tsc0/build0/test48 全绿 |
| 2026-09-07 | 发薪双向确认修正（feat/mechanic-earnings-simplify）：payout 生命周期改为 workshop 出粮(PENDING→AWAITING_CONFIRM 记录付款) → mechanic 确认收款(AWAITING_CONFIRM→PAID 才算完成)。此前 workshop 付款即 PAID、mechanic 确认被绕过/失效；同时修复 addPayoutPayment 新建 payout 时重复记两笔 payment 的 bug。status 为 String 无需迁移。mechanic 收入页拆「待确认收款/出粮中/发薪历史」三段 | 发薪必须双方确认：出粮后 mechanic 确认才完成；tsc0/build0/test48 全绿 |
| 2026-09-07 | Mechanic Profile 统计升级（feat/mechanic-earnings-simplify）：顶部 3 卡改为 Jobs completed / Total commission(Σ commissionSen ?? 1000) / Total bonus(Σ bonusSen ?? 0)，与 earnings 页一致；平均客单价改为平均收入、月度趋势改显示佣金(不再服务价值)；去掉原服务价值(value)与已发薪(paid)卡。 | Profile 与收入页口径统一（按每单佣金/奖金）；tsc0/build0/test48 全绿 |
| 2026-09-07 | Mechanic Profile 月度趋势图表（feat/mechanic-earnings-simplify）：把原 CSS 进度条列表换成 recharts ComposedChart（双轴，柱=完成工单数、线=佣金 RM，12 个月），新增客户端组件 components/mechanic/monthly-earnings-chart.tsx。 | 趋势更直观（工单数+佣金双轴）；tsc0/build0/test48 全绿 |
| 2026-09-07 | 修复 owner 无法编辑分行（feat/fix-branch-edit）：BranchManager 增加每行 Edit（内联编辑 name/city/phone/address/appointmentCapacity + 按天 operatingHours），Save 调 updateBranch；updateBranch 新增 city 字段（org 级可改）；settings 页给 BranchManager 传 appointmentCapacity | owner 现可在 Settings 编辑每个分行详情（此前只能列+加，且不能改 city）；build0/tsc0/test48 全绿 |
| 2026-09-07 | 产品目录管理（feat/product-management）：新增 src/actions/products.ts（createProduct/updateProduct/deleteProduct(软删 active=false)/setProductActive，均 org 级鉴权 + SKU 唯一校验）；产品页 /workshop/inventory/products 由只读改为 ProductManager 客户端组件（org 级可增/改/软删/启停，branch 级只读）；i18n 增 ws.products.* 管理键。产品页 module=PARTS 访问=OWNER+COUNTER_STAFF+MANAGER（方案①）。⚠️ DB Permission MANAGER|PARTS 需 canView/canEdit=1（本地已设），生产需同样启用否则 MANAGER 进不去（Developer Settings/seed）。 | 可新增/编辑/归档产品目录（org 级共享）；软删保留工单/PO/库存引用；build0/tsc0/test48 全绿 |
| 2026-09-07 | Settings 页角色分流（feat/manager-branch-settings）：org 级(OWNER/SUPER_ADMIN/HEAD_OFFICE_ADMIN)管理全部分行+组织资料+服务目录；branch 级(MANAGER 等)仅见「My Branch Settings」编辑自己分行(operatingHours 按天/预约容量/电话/地址)，隐藏多分行/org 区块。actions/settings.ts 加 getSessionUser 鉴权 + isOrgLevelRole + updateBranch 强制 id===session.branchId（branch 级）。i18n 增 settings-form.no-* 与 day.* 键 | 修复越权：branch 级 manager 只能改自己分行（此前 updateBranch 无鉴权、Settings 页对所有分支可见）；新增分行工作时间/容量编辑；build0/tsc0/test48 全绿 |

| 2026-09-07 | 分行隔离补全（剩余 5 个深度服务聚合）：inventoryService.purchaseOrders(branchId)→repo.listPOs；staffService.kpiBoard(branchId,days)/settlement(period,ref,branchId)/settlementByDay(days,ref,branchId)/payoutHistory(branchId) 均按 branch 过滤 staff；financeService.periodDashboard(period,ref,branchId) 按 branch 过滤 invoice；dashboard todayFinance/branchId。crm.reminders 无 branchId（顾客级）保持 org 级共享 | branch 级员工在 kpi/settlements/profit/purchase-orders 只见本分行；rider 提醒仍 org 级；签名变更同步 dashboard/ai/assistant/verify-demo 调用方；build0/tsc0/test48 全绿 |
| 2026-09-05 | 分行严格隔离 + demo/testing 分行开通：新增 src/lib/branch-scope.ts（isOrgLevelRole/scopedBranchId/applyBranchScope —— SUPER_ADMIN·OWNER·HEAD_OFFICE_ADMIN 为 org 级看全部分行，其余角色默认只见本 branchId）；workshop dashboard/bookings 接入 applyBranchScope；新增 scripts/provision-demo-branch.ts（幂等建 testing branch + appointment slots + branch 级 staff（Supabase auth 建号绑 authId）；只建一间按名称守卫，prod 需 PROVISION_ALLOWED=1） | 分支级 staff/技师登录后 UI 只见本分行（Rider/顾客仍 org 级共享，customer/motorcycle 未按 branch 砍）；App UI 走 Prisma，RLS 仅兜底 PostgREST；本地 dev.db 已开通 D&Z Testing Branch + 5 个 branch 级账号（test.manager/counter/servicemgr/mech1/mech2@dz.my · Dashoil@!789），dashboard/bookings 已验证隔离；tsc0/lint0/test48/build 全绿 |
| 2026-09-05 | 登录页三端差异化（feat/login-app-identity，已合并 main @ 06be6cd）：新增 src/components/login/login-shell.tsx 共享骨架 + globals.css 三套 .login-theme-workshop/rider/mechanic 作用域配色（覆盖 --primary/--ring/--app-glow，仅登录页生效不改各端内部主题）；三页接入 /login(Workshop 琥珀)/rider/login(Rider 青绿)/新增 mechanic-app/login(Mechanic 宝蓝)；mechanic-app/layout + middleware 改为未登录技师→/mechanic-app/login（登录页放行）；技师登出指向 /mechanic-app/login；i18n 增 login.*(badge/title/tagline/role/link/need) 词条 | 三端登录一眼可辨（配色 + 名牌徽章 + 标题/口号 + 底部角色/互跳）；认证/角色跳转逻辑未动；i18n 改动已同步 §9；tsc0/lint0(825w 存量)/test48/build 全绿；生产 Vercel auto-deploy |
| 2026-09-02 | merge feat/whatsapp-real-provider into main（5857cc4 RLS fix + d9f297a Meta WhatsApp provider：toE164ForWhatsApp 归一化 + Message.externalId（两 schema + 迁移）+ 三处持久化 externalId + /api/webhooks/whatsapp 回执 webhook）+ SETUP §5.3.1 上线 runbook（生产 PG 幂等加列 → push → Vercel env → Meta webhook） | main 现含 WhatsApp 换真代码：配 WHATSAPP_API_TOKEN/PHONE_ID/VERIFY_TOKEN + 生产 PG 加 Message.externalId + Meta webhook 即真发+回执可追踪；本地 dev.db 已含列，:3002/:3003/:3102 重启后 200；tsc0/lint0(118w)/test29/build 全绿 |
| 2026-09-03 | Workshop OS 新增 AI Assistant（feat/workshop-ai-assistant，本地未 push）：左下角浮动 FAB ↔ 可调大小面板 ↔ 最小化为图标；多轮对话 + 按当前语言回复（en/zh/ms）。intent router + tool registry 接地真值（今日预约/今日收入/客户数/工单/库存/提醒/操作指南）；AiProvider 扩展 chat(system+messages)；新增 src/modules/assistant/{router,prompt,tools,service} + src/actions/assistant.ts + src/components/workshop/ai-assistant.tsx；.env 配 OPENAI_API_KEY/OPENAI_MODEL（gpt-4o-mini）；i18n 加 ai.assistant.* 词条 | 员工在 Workshop OS 任意页可询问今日预约/收入、如何创建账单等；回复随当前语言；数据经 org/branch 限定 + action 用 getSessionUser 鉴权；tsc0/lint0(118w)/test39/build 全绿；未配 key 时 mock 兜底 |
| 2026-08-29 | Mechanic 开工前 SOP 拍照（SOP-001）：新增 ServiceJobPhoto 表 + JobPhotoAngle 枚举（迁移 pre_service_photo_sop）；/api/jobs/[id]/photos 上传；jobService.transition 对 IN_PROGRESS 强校验 5 角度齐全；技师端 sop-photo-capture（5 角度 capture）/workshop jobs 照片查看；照片走 storageProvider（生产 Supabase Storage，本地 ./storage） | 开工前必拍 5 张车辆状态照（front/back/left/right/meter），缺张无法开工；counter 可在工单查看；i18n 加 mech.sop.*/ws.job.sop-*；tsc0/lint0/unit26/build 全绿 |
| 2026-08-29 | Workshop SOP 照片点击放大：新增 src/components/workshop/job-photos-view.tsx（复用 shared/lightbox，点击放大 + X/backdrop/Esc 关闭 + 左右切换） | counter 查看开工前照片更直观；复用现有灯箱组件，无新依赖 |
| 2026-08-29 | Mechanic App 新增通知中心（Alerts）：/mechanic-app/notifications 页面 + 底部导航 Alerts tab（Bell 图标 + 未读角标随 layout 计数）+ src/actions/mechanic-notifications.ts markMechanicNotificationsRead；assignMechanic 给被指派技师发 JOB 站内通知 | Mechanic App 三端通知对齐（workshop/rider 已有）；i18n 加 mech.alerts/mech.notifications-* 等 5 key；tsc0/lint0(111w)/unit26/build 全绿 |
| 2026-08-29 | Mechanic 订单页增强（feat/mechanic-orders-refresh）：新增 MechanicOrdersView（进行中/已完成 tab 筛选 + 30s 自动刷新开关 + 手动刷新按钮）；JobCard 加 completed 标记；主页同时取 current（非 COMPLETED/CANCELLED）+ completed（COMPLETED 按完成时间倒序） | 技师可查看已完成订单 + 防漏接单；i18n 加 mech.tab.current/completed/refresh/auto-refresh；tsc0/lint0/unit26/build 全绿 |
| 2026-08-29 | 开工前报价确认（QUOT-001）：新增 Quotation 表 + QuotationStatus 枚举（迁移 quotation，两个 schema 同步）；bookingService.checkIn 建 job 后自动生成报价（PENDING）；quotationService send/respond/getForJob；assignMechanic 与 transition(IN_PROGRESS) 门禁（报价存在且非 APPROVED 则禁止；无报价历史工单不受限）；rider service-status 内联 QuotationCard（Confirm/Reject）；workshop 工单 QuotationPanel（Send/Re-send）+ mechanic-board 报价待确认徽章/派工禁用；i18n quotation.*/ws.job.quotation-* | 客户确认报价后才可派工/开工；拒绝后 counter 编辑行+重发；tsc0/unit26/build 全绿 |
| 2026-08-29 | 维修 job（REPAIR）：新增 JobType 枚举 + ServiceJob.type + Booking.type（迁移 job_type，两个 schema）；createJob 支持 type/parts/labour；bookService/booking.create 支持 type；checkIn 维修 job 不自动建报价（counter 加配件/工时后 Send）；RepairJobForm（/workshop/jobs/new?type=repair）+ jobs 列表「Create Repair Job」按钮 + /api/repair-parts 搜索；rider book 加 Service/Repair 切换（维修不选套餐只描述问题+时段）；门禁：维修 job 必须报价 APPROVED 才可派工/开工；i18n job-type.*/repair.*/ws.job.repair-* | workshop 可建维修工单（自定义配件+工时）、rider 可预约维修；结构与报价共用；tsc0/lint0/unit26/build 全绿 |
| 2026-08-29 | 每技师独立提成 + 去底薪（feat/commission-per-mechanic）：User.commissionRules（个人算法）+ ServiceJob.commissionSen（每单提成，可手动覆盖）+ StaffPayout.bonusSen（手填奖金），迁移 per_mechanic_commission（两 schema）；staffService 用 per-user rules + 每单提成计算（Σ每单提成 + 增项奖励 + 手填 bonus，无底薪）；actions：updateMechanicCommissionRules/updateJobCommission/setPayoutBonus；Settlements 每技师可配 commission + 每日账单每 job 显示/编辑提成 + bonus 输入；i18n payout.*/settle.* 更新 | 每个技师用自己的提成算法；每张账单可看/改提成；可填 bonus；去底薪。tsc0/lint0/unit26/build 全绿 |
| 2026-08-29 | 报价 PDF 下载（feat/quotation-pdf）：新增 /quotation/[id] 打印页（A4 版式：门店抬头/单据号/客户/车辆/工单/明细行含 kind/配件+工时小计/合计/有效期/签字区）；客户端 window.print() 存 PDF（零新依赖）；quote 面板加「Download PDF」按钮；jobInclude 加 branch；i18n pdf.* | workshop 可下载 service/repair 报价 PDF；结构同报价快照，零新依赖。tsc0/lint0/unit26/build 全绿 |
| 2026-09-01 | RLS 安全修复：app_jwt_claim 改为优先读 request.jwt.claims->'user_metadata' 再读顶层（修复前先读顶层，顶层 Supabase role="authenticated" 遮蔽 user_metadata 业务 role → app_is_staff() 恒 true、客户经 PostgREST 可读全 org 数据、app_is_admin() 恒 false）；生产 Supabase 已 CREATE OR REPLACE FUNCTION + 同步 scripts/gen-rls-policies.ts 与 docs/rls-policies.sql | 客户 RLS 隔离恢复（ahmad CUSTOMER 只见自己 19 条/1 客户；ANON 0；service_role 180/77 基线；OWNER 另一 org 0）；app UI 走 Prisma 不受影响；验证 CUSTOMER 19、ANON 0、SERVICE 180、OWNER 0 |
| 2026-09-01 | 维修 check-in 改走 RepairJobForm（Model A）：bookingService.checkIn 对 REPAIR 不预建 job、不报价，仅置 CHECKED_IN 并返回 type/customerId/motorcycleId；BookingActions check-in 后按 type 分流——REPAIR→/workshop/jobs/new?type=repair&customer&motorcycle&bookingId（RepairJobForm 预选并建单），SERVICE→/workshop/jobs/[jobId]；createJob 支持可选 bookingId 并回写 booking.jobId（检测重复绑定）；jobs/new 透传 bookingId；bookings 页对 CHECKED_IN 无 job 的维修单加「创建维修单」入口；i18n toast.checked-in-repair / ws.bookings.create-repair | 维修单在 check-in 后直达维修创建页一键建维修；服务单流程不变（仍建 job+自动报价）；无 schema 改动；tsc0/lint0/unit26/build 全绿；tsx 脚本验证 REPAIR check-in 0 job / SERVICE 建 job+quote / booking-job 绑定 match |
| 2026-09-01 | 修复 rider 看不到 repair quotation/status：getRiderStatus 改为返回该 bike 的所有 active job（每个 job 一行，携带 status/quotation），不再只取 booking?.job——之前无 booking 关联的维修单（或 bike 存在多个 active job 时）会被隐藏；service-status 页 key 改为按 job/booking 唯一（支持同车多 job 卡片） | rider 现在能看到维修单（repair）的 status + quotation（实测 DZ1029 repair RM126 + DZ1027 service RM60）；tsc0/lint0/unit26/build 全绿 |
| 2026-09-01 | 修复维修单里程错导致无法完成（fix/repair-mileage-prefill）：RepairJobForm 选车/预选时自动把里程预填为该车 currentMileage（此前为空/手填，易写成 < 车实际里程 → 完成时 completionService 抛 Mileage regression，维修单卡在 READY 无法 Complete；生产 DZ1208 实测即此因，修正里程后正常完成） | 维修单里程默认对上车实际里程，避免 Mileage regression；tsc0/build 全绿 |
| 2026-09-01 | bookings 状态筛选条加每状态数量（feat/bookings-filter-counts）：按 branch/date 范围 groupBy status 统计各状态 booking 数 + 总数，在筛选 pill 上显示（对齐 Service Jobs 的 board.counts 样式） | 老板一目了然每状态单量；tsc0/build 全绿 |
| 2026-09-01 | 完成的 job 发票收款 + 独立 workshop 发票页（feat/job-invoice-payment）：① InvoicePaymentPanel（job 详情右列 + 发票页复用）——总额/已收/剩余 + 录入金额/方式(CASH/CARD/ONLINE/EWALLET) 调 addInvoicePayment，满额自动结清 ② 新增 /workshop/finance/invoices 发票管理页（卡片列表 + 每状态数量 + 收款面板）③ addInvoicePayment/settleInvoices 增强：已收=状态 PAID 且非 PAY_LATER；结清时关闭自动生成的 PAY_LATER/PENDING 应收（保留记录标记 PAID，避免重复计收）④ nav 加 Invoices ⑤ i18n inv.* | 完单即可在 job 页收款；独立发票页统一管理；无 schema 变更；tsc0/build 全绿 + 实测录款 RM50→已收 RM50/剩余 RM85 |
| 2026-09-01 | 发票页加日期 + 搜索（feat/job-invoice-payment 追加）：/workshop/finance/invoices 支持按 issuedAt 当日过滤 + 搜索（发票号/工单号/客户名/车牌），计数按 日期+搜索 范围（不含 status）统计 | 筛选发票更直观；tsc0/build 全绿 + 实测搜索 DZ-2026-00003→1 张 |
| 2026-09-01 | 发票打印 PDF（feat/job-invoice-payment 追加）：新增 /invoice/[id] 打印页（复用 quotation 的 window.print() 模式，pdf.invoice-* 词条）；QuotationPrintActions 支持 title 属性；InvoicePaymentPanel 头部加 Download PDF（job 页/发票页均有）；i18n 补 pdf.invoice/invoice-no/branch/no-bike/no-items/subtotal/discount/tax/thanks | 发票可打印/存 PDF；tsc0/build 全绿 + 实测渲染明细/小计/总价/未结 |
| 2026-09-01 | Add Staff 支持创建登录账号（fix/staff-login-password）：createStaff 增加可选 email+password —— 提供时用 Supabase admin API 建 auth 账号(email_confirm) 并把 User.authId 绑上（登录时 injectBizClaims 读 User 注入 claims）；staff-manager 加 Password 字段 + toast「login created」；i18n staff.*/toast.staff-login-created | 新员工可立即用 邮箱+密码 登录（按角色路由）；无 schema 变更；tsc0/build 全绿 + 实测新增 MECHANIC staff 用 teststaff@dz.my/Test12345 登录落在 /mechanic-app |
| 2026-09-01 | 教程 DOCX 生成工具（scripts/tutorial-capture.ts + tutorial-docx.ts，依赖 docx）：Playwright 全页截图（workshop 42/rider 12/mechanic 4，生产）+ docx 库生成带 TOC/每页标题/截图/说明的《D&Z Platform User Guide.docx》；gitignore tutorial-screens/ 与生成的 docx（大产物） | 一键重生成全功能教程；脚本可复用；51MB（高分辨率全页截图） |
| 2026-09-01 | provider 换真收尾（Messaging→Meta WhatsApp）：① phone.ts 加 toE164ForWhatsApp（本地 "013-125 2832"→"+60131252832"）并在 whatsapp-business.send() 归一化 to（真实 Graph API 要求 E.164，否则换真即失败）② Message 加 externalId（迁移 whatsapp_message_external_id，两 schema 同步）③ 三处发送持久化 externalId（messaging.service/crm.service/marketing.broadcastCampaign）④ 新增 /api/webhooks/whatsapp（GET 验签 hub.challenge + POST 按 externalId 更新 status，可选 HMAC） | Messaging 换真代码完备：配好 WHATSAPP_API_TOKEN/PHONE_ID/VERIFY_TOKEN 即真发+回执可追踪；生产 PG 需加 Message.externalId 列 + 4 个 env；tsc0/lint0/unit26/build 全绿 |
| 2026-08-19 | 新增迁移 `booking_campaign_attr`、`review_reply` | Booking.campaignId、Review.reply |
| 2026-09-01 | i18n 补全 workshop 12 组件剩余硬编码英文（promo-calendar-grid/qr-settings/recommendation-actions/referral-manager/reminder-actions/reorder-actions/send-due-button/settings-forms/slot-manager/task-list/template-manager/toggle-integration），新增 80 key（promo-cal.*/qr-settings.*/recommendation.*/referral.*/reminder.*/reorder.*/send-due.*/settings-form.*/slot.*/task-list.*/template.*/toggle-int.*），复用 bike.qr-label/common.*/ws.* 等现有 key | workshop 设置/促销日历/时段/任务/模板/QR/推荐/补货界面支持 en/zh/ms；tsc0 |
| 2026-08-19 | 新增迁移 `motorcycle_type`、`promo_discount` | Motorcycle.type、Campaign.discountPercent |
| 2026-08-19 | i18n 三语支持（dz_lang cookie） | 全部页面文案 |
| 2026-08-19 | 海报素材 public/posters/（10 张） | MarketingAsset.url |
| 2026-08-19 | 灯箱组件 shared/lightbox.tsx | 图片放大 |
| 2026-08-19 | Provider 抽象（5 个接口） | 生产可替换 |
| 2026-08-19 | 新增路由 /preview（手机预览框架） | rider 调试视图（iframe 同源 + cookie 共享） |
| 2026-08-19 | rider layout 支持 dz_hide_demo cookie | 预览框架内隐藏琥珀 demo bar（完整页面视图） |
| 2026-08-19 | BottomNav/MobileNav 加 safe-area padding（env(safe-area-inset-bottom)） | 适配 iPhone home indicator，底部导航不被遮挡 |
| 2026-08-19 | rider book 页重构：套餐单选卡片 + 附加服务多选 + 实时总价 | serviceType 存「套餐 + 服务组合」字符串 |
| 2026-08-20 | 迁移 `seg1_requirements_data_model`：新增 27 个实体（Lead/LeadSource/LeadStage/LeadActivity、Task、TestRide、AppointmentSlot、ServiceType、JobStatusHistory、ServiceHistory、InventoryLocation、AutomationRule/Execution、MessageTemplate、LoyaltyAccount/Tier/Transaction、Reward/Redemption、Referral、Attachment、AuditLog、IntegrationConfig、RoleConfig/Permission、CustomerAddress/Consent）+ 现有模型补字段（Organisation 公司配置、Branch 营业时间/容量、User 密码、StockMovement.userId、Product 兼容车型） | 需求清单 §30 DATA-001~044 实体全覆盖；PLT-005/010 配置字段就位；后续段按实体补 UI/逻辑 |
| 2026-08-20 | 迁移 `seg2_auth_roles`：enum Role +7（HEAD_OFFICE_ADMIN/SALES_MANAGER/SALES_ADVISOR/SERVICE_MANAGER/PARTS_MANAGER/CUSTOMER_SERVICE/AUDITOR），User +8 认证字段（passwordHash 已有/emailVerified/mfaSecret/verifyToken/resetToken/failedLoginCount/lockedUntil） | 认证：/login 页+scrypt 哈希+HMAC 会话（dz_session 12h）+TOTP MFA+暴力锁定+AuditLog；middleware 双模式（persona 兼容/真实会话）；.env 加 AUTH_SECRET；权限引擎 src/lib/auth/permissions.ts；e2e 不受影响 |
| 2026-08-20 | 段 3 网站与线索：新增公开页 /catalogue（目录）、/contact（咨询→Lead）、/test-ride（试驾申请→Lead+TestRide）；Leads 模块 src/modules/leads + workshop /workshop/leads(+/new/[id])；nav 加 Sales>Leads；seed 补 5 条 demo leads | 咨询/试驾提交自动建 Lead（source=Website）；查重按 phone/email；LEAD/WEB 46 条需求补齐（38✅/8🟡）；rider 端不变 |
| 2026-08-20 | 段 4 销售管道/任务/试驾：新增 /workshop/pipeline（Kanban+统计+筛选+stale）、/workshop/tasks（+新建/完成/逾期）、/workshop/test-rides（+排期/状态流转）；模块 src/modules/{tasks,test-rides} + src/modules/leads/pipeline.ts；nav 加 Pipeline/Test Rides/Tasks | PIPE/TASK/TEST 52 条补齐（实测试驾完成→自动跟进任务）；试驾完成自动建任务归 TASK-016 |
| 2026-08-20 | 段 5 客户/车辆/时间线：Customer 补 tags、Motorcycle 补 engineNo/purchaseDate/warranty/notes（迁移 seg5_*）；客户详情加 Timeline tab（聚合 15+ 事件）+ loyalty/consent/附件/标签展示；新增 /workshop/motorcycles 列表+详情（服务历史/保修/转移+审计）；timeline 服务 src/modules/customers/timeline.ts | CRM/VEH/TIME 74 条补齐；车辆转移记 AuditLog；历史保留 |
| 2026-08-20 | 段 6 在线预约：BookingStatus 加 NO_SHOW；预约时段改从 AppointmentSlot 表读取（rider/book）+ 防超卖校验（bookedCount>=max 拒绝）+ bookedCount 递增；CONFIRMED 自动生成确认 Message；状态变更写 AuditLog；新增 /workshop/bookings/slots 槽位管理（生成/容量/节假日）；bookings 页加分支/日期筛选 + 月历视图 + No Show 按钮 | BOOK 35 条补齐；踩坑：BookForm timeSlot 初始值不能为空（e2e bookViaRider 不选时段），改回 '10:00' 后 booking spec 3/3 恢复 |
| 2026-08-20 | 段 7 工单/技师/服务历史：JobStatus +QC_CHECK/WAITING_PARTS/ON_HOLD（state-machines 同步，9 状态流）；jobService.transition 写 JobStatusHistory + READY 通知；completion 写 ServiceHistory（HIST 全字段）+ 状态历史；jobs 详情加状态历史区块 + 新状态按钮 | 实测：完成工单→ServiceHistory+JobStatusHistory 自动生成；state-machines 单测 7 条仍过；SQLite enum 变更无需迁移 |
| 2026-08-20 | 段 8 零件库存：Product 补 manufacturerPartNo/barcode（迁移 seg8_product_fields）；inventoryService.transferStock 分支转移（双向 ledger）；stock 页加 Adjust/Transfer 操作列；products 页加 Mfr No 列 | PART/INV 34 条补齐；实测试转移双向 StockMovement；INV-022 分支对比报表归段 11 |
| 2026-08-20 | 段 9 提醒/自动化/消息：新增 messaging 模块（模板渲染 {name}/{bike}/… + opt-out 拦截 + 发送历史）、automation 引擎（10 触发×5 动作 + 执行日志 + dedupe 防循环）、/workshop/automations + /workshop/messaging/templates 管理页；触发接入 leads/booking/job-ready；seed 演示规则 | 实测：咨询→Lead→自动建任务+执行日志；MSG-017 opt-out 生效；时间触发类（BOOKING_APPROACHING 等）待调度基础设施 |
| 2026-08-20 | 段 10 忠诚/推荐/营销：新增 loyalty 模块（getOrCreate/earn/redeem/adjust + 账本 + 等级判定）、referral 模块（推荐码/追踪/qualify 发奖/防自荐）；completion 服务完成自动发积分（RM1=1pt）；/workshop/loyalty 管理页（成员/账本/兑换/调整/推荐列表）；rider profile 数字会员卡+积分+等级；nav 加 Loyalty | 实测：完成工单→自动发 145 积分；Ahmad 320 分 Bronze 卡渲染；LOY/REF 核心闭环；MKT audience 高级过滤归段 15/ADMIN |
| 2026-08-20 | 段 11 仪表盘/营收/分析/多分支：新增 analytics 模块（销售/服务/客户/营收/库存 5 视图 + 分支对比）+ /workshop/analytics 页（recharts 图表 + CSV 导出 + 分支排名）；dashboard 补 Total Leads/Repeat %/Upcoming/Open tasks + 14 天线索趋势；nav 加 Analytics | DASH/REV/ANA/BR 111 条补齐（约 85✅/26🟡）；日期/分支过滤与对比期归段 15 |
| 2026-08-20 | 段 12 搜索/通知/导入导出/文件：search API 扩展（email/VIN/lead/booking）；通知中心 /workshop/notifications（read/unread+类型筛选+link）；CSV 导入 /workshop/import（客户，查重不覆盖）；导出 /api/export（客户/线索/预约/产品 CSV）；附件上传 /api/upload（storage provider+Attachment 记录）；Notification 加 link 字段（迁移 seg12_notif_link）；nav 加 Notifications/Import | 实测：导入 1 成功 1 重复跳过 1 失败报告；PDF 附件上传成功；SEARCH/IMPORT/EXPORT/FILE 补齐；车辆/线索/零件导入与部分导出归后续 |
| 2026-08-20 | 段 13 AI-Native：新增 AI 草稿服务 src/modules/ai/draft.ts（5 类型×3 语气，仅引用结构数据）+ AI 页草稿合成器（搜索客户/生成/编辑/发送）+ 洞察 AI 徽章 | 实测草稿引用真实数据（Ahmad Y15ZR 下次 31500km）；AI-018/019 满足；异常检测类归生产迁移 |
| 2026-08-20 | 段 14 API/审计/安全/隐私：审计查看页 /workshop/settings/audit-logs（action/entity 筛选+before/after）、集成配置页 /workshop/integrations（provider 启停+审计）、loyalty adjust 补 AuditLog 埋点 | 实测 LOYALTY_ADJUST 审计写入；SEC 生产属性（HTTPS/加密/备份）标 🟡 归生产迁移；PRIV 核心（consent/opt-out/权限）就位 |
| 2026-08-20 | 段 15 设置中心/UX/性能/可靠性/导航：/workshop/settings 从 ComingSoon 升级为配置中枢（组织资料/分支管理/服务目录 CRUD/丢失原因配置 + 8 个配置子页入口）；Organisation 补 lostReasons 字段（迁移 seg15_org_settings） | ADMIN 26 条核心配置就位；PERF/REL 生产属性标 🟡；§47 导航 23 模块清单核对 |
| 2026-08-20 | 段 16 端到端工作流+DoD：E2E-SALES/SVC/RET/BR 四流程核对（46✅/5🟡 环节）；DONE 40 条（27✅/13🟡 生产属性归迁移） | 需求验证工程 16 段全部完成：895 条核对，缺失补齐，回归全绿；生产迁移清单见 SETUP §5 |
| 2026-08-20 | rider 生命周期状态：新增 src/modules/rider/status.ts（booking+job 双状态聚合，7 阶段映射 resolveStep + 副状态 waiting_parts/on_hold/approval）；/rider/service-status 重写（多车状态卡 + 步骤条 + 空态引导 + 其他车辆摘要）；摩托车详情页加 Live status 入口；i18n 三语 svc.* 12 key | 顾客可全程追踪：预约待确认→已确认→已进店→服务中→质检→待取车→完成；实测六步流转全部正确；e2e 75 通过 |
| 2026-08-20 | 预计完成+进度：ServiceJob.estimatedCompletionAt（迁移 seg16_estimated_completion），IN_PROGRESS 时按服务时长估算（默认 120min）；rider 状态页加进度条+ETA；Workshop 工单详情加 Rider lifecycle 进度区块+customer view 链接 | JOB-016 预计完成时间补齐（需求清单 🟡→✅）；rider 与 Workshop OS 双向链接；实测 DZ1188 ETA 自动设置；e2e 75 通过 |
| 2026-08-20 | rider 三步增强：① 完成评价引导（service-status 已完成车辆加 Rate 链接→service-history ReviewCard，Workshop reviews 页已有管理）② 工单状态变化→顾客通知（IN_PROGRESS/APPROVAL/QC/WAITING_PARTS/ON_HOLD/READY/COMPLETED，link 到状态页）③ Workshop dashboard 加 Service lifecycle 分布（按顾客可见 7 阶段分桶） | 三步均双向链接 rider↔Workshop OS；回归全绿 |
| 2026-08-20 | 修复通知页筛选按钮：typeCounts 分组改用不含 type 筛选的 baseWhere——点击任一类型 filter 后所有按钮（All/INFO/JOB_READY 等）保持可见 | 实测：点 Info 后 JOB_READY 按钮仍在，点 JOB_READY 后 INFO 仍在；回归全绿 |
| 2026-08-20 | 服务套餐编辑：/workshop/packages 升级——每套餐 Edit 按钮 + PackageEditor（勾选包含项/名称价格描述/最佳值/启停 + 赠品添加 kind=GIFT）；跨套餐重复检测 dupMap（列表 ⚠ also in X + 编辑器内 ⚠ 警告）；候选列表 = 服务目录+零件+既有自由项目 | 实测：Basic 编辑含 3 个重复警告、添加赠品保存后列表显示 🎁 FREE；actions/packages.ts updatePackage 支持 diff 重写 items |
| 2026-08-20 | UI 全局增强（ui-ux-pro-max 技能驱动，不动核心逻辑）：globals.css 加 .dz-table/.dz-panel/.dz-section-title/.dz-card-link + focus-visible 无障碍环；StatCard 加 icon 槽+shadow+hover 上浮；EmptyState 加 action；StatusBadge 补 QC_CHECK/WAITING_PARTS/ON_HOLD/NO_SHOW 配色；8 个表格页升级 dz-table（sticky thead/行 hover）；leads/customers 筛选控件统一 | 回归全绿（75 e2e 无核心逻辑改动）；截图 polish-dashboard/leads/customers |
| 2026-08-20 | UI 增强第二轮（逐页深化，纯视觉）：dashboard 统计卡全部加图标（Wallet/TrendingUp/Wrench/Receipt/Filter/Users/CalendarClock/ListTodo）；jobs Kanban 列头计数徽章+卡片 dz-card-link hover；工单详情 section 统一 dz-panel；登录页品牌化（logo 图标+渐变背景+tagline+毛玻璃卡） | 回归全绿；截图 polish2-dashboard/kanban/login |
| 2026-08-20 | UI 增强第三轮（rider+详情页，纯视觉）：bookings 行卡加状态色条（7 色 border-l-4 + hover 变主色）；customers/[id] header 改 dz-panel+UserRound 图标+数据格卡片化（rounded-xl bg-muted/50 p-3）、车辆卡 hover；rider home 护照入口 dz-card-link | 回归全绿；截图 polish3-bookings/customer |
| 2026-08-20 | UI 增强第四轮（详情页，纯视觉）：leads/[id] 时间线升级——垂直引导线+环形节点+时间徽章（dz-panel）；motorcycles/[id] 护照卡与服务历史表升级 dz-panel/dz-table | 回归全绿；截图 polish4-lead-detail/motorcycle |
| 2026-08-20 | UI 增强第五轮（列表统一，纯视觉）：reminders 页升级 dz-panel/dz-table（sticky 表头+行 hover）；tasks 列表行 hover 提升 | 回归全绿；截图 polish5-reminders/tasks |
| 2026-08-20 | UI 增强第六轮（rider，纯视觉）：rider bookings 卡加状态色条（7 色 border-l-4，与 workshop bookings 呼应）+ NO_SHOW 徽章；rider layout 主区上间距 py-5→py-6 | 回归全绿；截图 polish6-rider-bookings |
| 2026-08-20 | UI 增强第七轮（剩余页统一，纯视觉）：inventory alerts/reorder/suppliers/purchase-orders、finance profit、checklists 卡片行统一 dz-panel；staff/kpi、dead-stock 表格升级 dz-table；analytics 趋势线加端点圆点+加粗 | 回归全绿；截图 polish7-alerts/profit |
| 2026-08-20 | 移动端真机间距抽查（iPhone 390×844 视口，playwright-core 脚本 scripts/mobile-audit.ts）：11 页（rider 6 + workshop 5）全部无水平溢出；rider main pb-28=112px 底部导航不遮挡；表格容器 overflow-hidden→overflow-x-auto（leads/customers/reminders/motorcycles/slots/audit-logs/dead-stock/kpi 内部滚动不压扁）；截图 mobile-*.png | 回归全绿 |
| 2026-08-20 | 深色模式专项核对（next-themes dark class）：StatusBadge 全 22 状态加 dark: 变体（bg-*-950/50 + text-*-300 + border-*-900）；task-list 优先级徽章、jobs/[id] 状态文本系列、rider home 服务提醒卡 dark 适配；审计脚本 scripts/dark-audit.ts（9 页暗色截图验证生效） | 剩余硬编码浅色（staff-manager/checklist-runner/calendar 等）标注后续轮次；回归全绿 |
| 2026-08-20 | 浅色徽章批量补齐（scripts/dark-batch.cjs 安全正则，跳过含 dark 行）：29 文件 / 95 行追加 dark: 变体（bg-*-50/100→bg-*-950/50·60 + text-*-300 + ring-*-900），覆盖 staff-manager/checklist-runner/calendar/packages/import/loyalty 等剩余页面 | 关键文件抽查确认生效；剩余 ~157 处为非徽章装饰色低风险；tsc/build/e2e 75 全绿 |
| 2026-08-20 | 暗色主题重设计（从暗色角度设计，非反转）：.dark token 全面重写——冷蓝黑分层表面（bg 0.145→card 0.185→muted 0.235→accent 0.27 明度阶梯）、主色恢复品牌橙（oklch 0.76 0.17 45，原暗色为白色 oklch 0.922 0 0）、文字三级层级（0.965/0.73）、柔和语义色+图表亮色板、侧边栏更深作 app 框架、细透明边框 | 实测 token：primary lab(71% 橙)、背景/卡片分层；e2e 75 全绿；截图 dark-redesign-dashboard |
| 2026-08-20 | Poster AI 自动生成：src/modules/marketing/poster-gen.ts（程序化 SVG 海报——4 色调×3 尺寸、标题/副标/促销/参考图嵌入、品牌装饰）；/api/poster/generate；PosterForm 升级为 Generate with AI（上传素材→/api/upload POSTER_REF + 要求→生成→预览→入库 MarketingAsset）；新增 /api/storage/[...key] 文件读取路由；LocalStorageProvider URL 改 /api/storage/ | 实测：API+UI 生成 3 张海报入库（SQUARE/banner/STORY）SVG 可访问；回归全绿；未来可换真图像生成 provider |
| 2026-08-20 | 修复海报生成卡住：生成成功后 Dialog 自动关闭 + toast 提示「Poster generated」——不再需要点击空白处返回 | 实测：Auto Close Test 生成后 dialog 关闭、海报入库列表显示；回归全绿 |
| 2026-08-20 | Poster 编辑/删除：/api/poster/[id]（DELETE 删除 + POST 重新生成更新）；PosterGrid 每卡加 Edit（内联表单：标题/促销/色调/尺寸预填原值→Regenerate）+ Delete（确认 Delete?/Yes/No） | 实测：删除流程（确认→删→列表+DB 同步）；重新生成 url 更新为新文件；回归全绿 |
| 2026-08-20 | 功能增强 ① Poster 批量+照片：生成器加 visual（poster/photo——照片风=光斑+摩托剪影+暗角+描边）+ count 批量（最多 4，自动编号+轮换色调，type=PHOTO）；UI 加 Style/数量选择 ② 服务套餐：New Package 按钮+表单（名称/层级/价格/描述+勾选项目，createPackage 落地）+ PackageSorter（价格/层级切换排序） | 实测：批量 4 张 PHOTO 入库；Annual Care 套餐创建成功；回归全绿 |
| 2026-08-20 | 功能增强 ③④⑤：③ 预约改期/取消推送给顾客（Booking rescheduled/cancelled 通知，link 到 rider/bookings）+ 评价后自动感谢消息（submitReview→Message）④ dashboard 生命周期分布行可点击下钻（步骤→工单/预约过滤）+ analytics 营收对比期（Prev 30d + Change %）⑤ rider invoices/notifications/approvals、mechanic-board 卡片统一 dz-panel | 实测：改期通知含新日期；下钻 10 链接；对比卡显示；回归全绿 |
| 2026-08-20 | 功能：Poster 分享到 WhatsApp（每卡 Share 按钮→wa.me 带标题+URL）；预约提醒发送链路升级（reminders 页 Message 按钮→模板驱动 sendReminder(reminderId)：Service Reminder 模板渲染 {name}/{bike}/{date} + opt-out 检查 + Message 记录 referenceType=SERVICE_REMINDER + 状态更新 UPCOMING→DUE_SOON） | 实测：提醒发送→Message(WHATSAPP/SENT/模板正文)+状态 DUE_SOON；poster Share 按钮渲染；回归全绿；已 push GitHub |
| 2026-08-20 | 功能 ①②③：① 提醒 {link} 接真实预约链接（NEXT_PUBLIC_BASE_URL + /rider/book，实测替换）② 批量发送今日到期提醒（sendDueReminders + reminders 页 Send all due 按钮，生产可用 Vercel Cron 调同一函数）③ Poster 一键群发（每卡 Send to customers→选顾客（标签筛选/全选）→WhatsApp 消息含海报链接，opt-out 跳过）| 实测：link 替换、群发按钮渲染；回归全绿；push GitHub |
| 2026-08-20 | Loyalty 搜索选人增强：修复搜索 bug（原 /api/search 返回 hits 无法匹配 → 新 searchLoyaltyCustomers 直接查客户表）；选中后显示账户卡（当前积分大字+等级+会员号+赚取/兑换/会员时间+近 3 笔交易）；Earn/±Adjust/Redeem 操作后实时刷新快照（act 内 refetch getLoyaltySnapshot） | 实测：搜 Ahmad→选→显示 320 分；Earn 50→DB 360 页面同步 360；回归全绿 |
| 2026-08-20 | Rider 重构：service-history 并入 My Bike（每车 passport 已按 bike 过滤显示完整服务记录）；原 History 入口改为 News（路径 /rider/service-history 内容换为资讯聚合：最新促销 Campaign + 海报 MarketingAsset + 新产品 Product，海报灯箱）；bottom-nav History→News（Newspaper 图标）；home Special offer 保留 | e2e master journey 第 9 步改为从 passport 验证 STANDARD SERVICE；75 全绿 |
| 2026-08-20 | Rider book 改造：不再直达预约——先 Branch Locator（3 门店卡：城市/地址/电话 + slots free/评分/营业时间 widget + 当前促销卡 + 营业时间卡）；选店（?branch=）后显示门店摘要（Change 换店）+ Open slots/Rating widget strip + BookForm；bookService 支持 branchId，slots 按所选分支加载 | e2e helper bookViaRider 更新（先选分支）；75 全绿；截图 book-branch-locator/selected-branch |
| 2026-08-20 | i18n 补齐 toast/反馈文案：src/lib/i18n.ts 新增 tpl() 模板函数（{placeholder} 替换）+ 30 词条（toast.* 命名空间）；13 个组件接入 useLang + t/tpl（rider: book-form/review-card/motorcycle-form/approval-card；workshop: review-manager/staff-manager/create-job-form/job-actions/booking-actions/loyalty-manager/transfer-motorcycle/ai-draft-composer/package-editor）；en 值保持原文案字节不变（e2e 零风险） | 实测：rider 中文导航正常渲染；tsc0/unit20/e2e75+6skip 全绿；已 push GitHub |
| 2026-08-20 | CI 修复：.github/workflows/ci.yml 三个 job 的 setup-node node-version 20→22（pnpm 11.22.0 要求 Node ≥22.13，内部依赖 node:sqlite，Node 20 报 ERR_UNKNOWN_BUILTIN_MODULE）；eslint.config.mjs 忽略 scripts/** 与 e2e/**（dev CJS 脚本不再 lint）；修复 29 个 lint error（lightbox prop 同步改 key 重挂载、poster-grid JSX 引号转义、preview set-state-in-effect 加 disable 说明、rider/book Date.now 加 react-hooks/purity disable） | lint 0 errors（86 warnings 不阻塞）；tsc0/unit20/e2e75+6skip 全绿；已 push GitHub |
| 2026-08-20 | CI 修复（免 workflow token 方案）：package.json packageManager pnpm@11.22.0→10.34.5（pnpm 11 要求 Node ≥22.13 内部依赖 node:sqlite，CI Node 20 崩溃；pnpm 10 兼容 Node 20 且 lockfileVersion 9.0 不变）；ci.yml 不动（Node 20 保持）。另 eslint.config.mjs 忽略 scripts/e2e + 修 29 lint error（lightbox key 重挂载/poster 引号转义/purity disable） | pnpm 10 下实测 install/lint(0err)/tsc0/unit20/build/e2e75+6skip 全绿；已 push（75356b4+b3a37cd） |
| 2026-08-20 | 功能：customers/jobs 列表分页（共享 Pagination 组件，server-safe Link、省略号范围、保留搜索/筛选 query；customers 25/页×5 页、jobs 25/页×7 页；bookings 数据量小不分页） | 实测：customers 25 行/页、页码 1…5、?page=3 正常、q=ahmad 搜索 7 条自动隐藏分页；jobs 7 页；e2e 75+6skip 全绿；已 push b7301ac |