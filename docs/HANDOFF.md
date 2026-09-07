# HANDOFF — D&Z Platform（2026-09-04 17:1x）

> 本文件由 session-pack 生成，session-resume 可续接。

## 一句话状态
本地 = main @ 0ddc792（已 push，生产已部署，四端全 200）。本轮：登录页三端差异化已上线（Workshop/Rider/Mechanic 专属配色+字眼+互跳）。前序：把独立 Vite 介绍站（DZ-Intro-Site）集成为 CRM 的 /intro 静态页（public/intro，base=/intro/），提供四链接（介绍页/workshop/rider/mechanic）；TESTING_GUIDE.md 新增介绍页 + 重生成 PDF。前序：AI assistant（analytics+纯文本）、checklist 可编辑、provider（WhatsApp externalId）等已上线。

## 会话信息
- 原会话 ID：session-c5a58fbb-3d0a-4fd7-b8f8-bdc43069d460
- 打包时间：2026-09-04
- 续接口令：继续 D&Z

## 完成进度
- **介绍站**（独立项目 /Users/Jun/Documents/DZ-Intro-Site）：Vite+React19+Tailwind4；暗色金主题（D&Z amber oklch(0.62 0.19 45)）、Clash Display+Space Grotesk；Aurora/Ember 粒子、SplitText/GradientText/CountUp/Marquee/Magnetic、glass 卡；三语 EN/中文/BM（i18n context + LangToggle）；Hero 产品视觉（Workshop 浏览器 mockup + Rider/Mechanic 手机浮层）；产品视频区（intro.mp4，play/pause/replay，hover 控件）；responsive。
- **集成**：Vite base=/intro/ 构建；硬编码 /images、/videos 改 /intro/...；dist 拷入 CRM public/intro/（含 13MB 视频）；CRM tsc 0 + 生产 build 复现通过；分支 feat/intro-site 合并 main 并 push（4db10f9..f055fa6）部署；/intro 200。
- **四链接**：介绍页 https://d-z-crm.vercel.app/intro / Workshop /login / Rider /rider/login / Mechanic /mechanic-app（三端 App 200/200/307）。
- **TESTING_GUIDE**：新增 〇、介绍页 + 四入口；PDF 重生成（docs/TESTING_GUIDE.pdf 421K，未跟踪）。commit e85b363 已 push。
- 前序（已部署）：AI assistant（intent router + tools + Analytics 全数据 + sanitizeReply 纯文本）、checklist 可编辑（ChecklistTemplateEditor）、provider 上线（Message.externalId 生产已补列）。

## 下一步（按优先级）
1. **介绍站后续改动**：改 DZ-Intro-Site 源码 → node node_modules/vite/bin/vite.js build（base=/intro/）→ 拷 dist/* 到 CRM public/intro/ → CRM 提交部署。勿改 CRM Next 代码。
2. 经销商验证（需真人：DEALER_FEEDBACK + DEMO_SCRIPT，dtodo 59e04e5e）。
3. provider 换真收尾（dtodo 92b29072）：Vercel 配 WHATSAPP_API_TOKEN/PHONE_ID/VERIFY_TOKEN(+OPENAI_API_KEY) + Meta webhook；生产 PG externalId 列已补；Payment/Notification 未做（选型待定）。
4. 待用户定：Payment/Notification 选型；MANAGER 权限开放更多模块；枚举下拉（MAINTENANCE/REPAIR、WHATSAPP/SMS/EMAIL/APP）翻中文；Rider 文档语言。
5. 处理 58 个 untracked 交付物（docs/backups/*.sql 生产备份、screenshots、TESTING_GUIDE.pdf、ACCEPTANCE_REPORT.html、scripts/*.ts 等）——提交前先 gitignore/排除敏感项。

## 基线测试（命令 + 期望通过数）
- pnpm exec tsc --noEmit：0 错误
- pnpm lint：0 errors（~118 warnings 存量）
- pnpm test：48 通过（6 文件）
- pnpm build：本地 sqlite 通过
- 生产 build 复现：prisma generate --schema schema.pg.prisma && next build：0

## 服务与恢复
- workshop demo :3002：curl 200 ｜ 挂了：launchctl kickstart -k gui/$(id -u)/com.dz-platform.server
- rider demo :3003：curl 200 ｜ 挂了：launchctl kickstart -k gui/$(id -u)/com.dz-platform.rider
- e2e :3102：curl 200 ｜ 挂了：launchctl kickstart -k gui/$(id -u)/com.dz-platform.e2e
- 生产：https://d-z-crm.vercel.app（push main auto-deploy）；介绍页 https://d-z-crm.vercel.app/intro（/intro/ 308→/intro）

## git 状态
- 分支：main @ 06be6cd（已推送，生产已部署）——登录页三端差异化已合并上线（Workshop 琥珀 / Rider 青绿 / Mechanic 宝蓝 + 名牌徽章 + 标题/口号 + 底部角色互跳 + 新增 /mechanic-app/login；认证/跳转逻辑未动）。docs/backups/ 已 gitignore。；未跟踪约 57 项（screenshots、TESTING_GUIDE.pdf、ACCEPTANCE_REPORT.html、scripts/*.ts、docs/logo-png、docs 文档等）。docs/backups/*.sql（生产库备份含 PII）已加入 .gitignore 不再入库。
- 注意：改 Prisma schema 必须 sqlite + schema.pg.prisma 同步；勿 git add -A。

## 关键决策与约定
- 介绍站集成：Vite base=/intro/ → CRM public/intro/ 静态，同一 Next 部署下 /intro 提供介绍页；不改 Next 路由/构建（safe）；硬编码资源路径需 /intro/ 前缀。
- 业务日期存 UTC 零点（YYYY-MM-DD+T00:00:00Z）；真实时间戳 UTC；金额整数 sen，展示预格式化 RM。
- 三端 i18n：只翻 UI 文案，数据值/品牌/原始枚举不翻；DICT 追加 i18n.ts 末尾。
- 生产 DB 变更用幂等 SQL 定向加（勿 db push）；双 schema 同步铁律。
- local demo 用 :3002（勿 3000，被另一 AI 会话占用并 kill 占用者）。
- 生产文档截图：dev.db reset 后 Customer.authId 绑定丢失，教学截图一律用生产。

## 踩坑与事实
- pnpm 10 的 verify-deps-before-run 因 esbuild ignored-builds 硬报错（pnpm.onlyBuiltDependencies 弃用、pnpm-workspace.yaml 亦未生效）→ 直跑 node node_modules/vite/bin/vite.js build|dev 绕过。
- sips 默认居中裁剪，顶部裁剪用 --cropOffset 0 0；项目无 sharp（改 sips）。
- /intro/ 308→/intro（Next trailing slash），用 /intro 无斜杠。
- Next.js 对 public/<subdir>/index.html 的托管需部署完成才 200（期间服务旧版）。
- OPENAI key 曾在对话明文出现 → 上线后建议轮换。
- Playwright 合成事件不触发 CSS :hover；下拉需 click 状态（ExploreMenu 已做 hover+click 双模式）。

## 待办（dtodo）
- 59e04e5e 经销商验证（需真人，逾期 2026-08-19）
- 92b29072 生产迁移（q2，逾期 2026-08-19）：provider 换真——WhatsApp 代码已合并+生产 externalId 列已补；剩 Vercel env + Meta webhook + Payment/Notification 选型

## 新会话头 10 分钟
1. curl :3002 / :3003 / :3102 / prod / /intro 探活（挂了 launchctl kickstart）
2. 读 docs/HANDOFF.md + memory project/daily + dtodo
3. 跑基线（tsc 0 / lint 0errors / test 48 / build）
4. 从下一步挑：介绍站改动 / 经销商验证(需真人) / provider env+webhook / 处理 untracked
- 文档：docs/TESTING_BRANCH_GUIDE.md（Testing Branch 详情+指南：账号(角色+123)/隔离/开通流程/验证）+ docs/ACCOUNTS_BY_BRANCH.md（全组织账号清单）。
- 待 owner merge：feat/manager-branch-settings（Settings 角色分流 + MyBranchSettings + actions 鉴权）
- 待 owner merge：feat/product-management（产品目录增删改管理，org级）
- feat/product-management：产品目录增删改（MANAGER 可管理）；需生产启用 DB Permission MANAGER|PARTS。
- feat/product-management：产品目录管理含图片展示/Image URL 编辑（恢复被删的图片列）。
- feat/product-management：产品目录管理 + 图片显示/上传（storageProvider）。
- 已修：Testing Manager 侧边栏/问候语显示其自身分行（767e324/a241bb4），测试分行城市=Subang Jaya；Vercel 部署排队。
