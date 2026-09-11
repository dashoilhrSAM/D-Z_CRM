# HANDOFF — D&Z Platform（2026-09-11 04:39）

> 本文件由 session-pack 生成，session-resume 可续接。

> **⛔ 逐次改动不要再往本文件加段落（2026-09-11 起）**：改动记录写在 `docs/changes/`，一次改动一个文件
> （`pnpm new:change <名字>`）。**原因**：两条分支都往本文件顶部插段落，合并必然冲突——已发生两次。
> 本文件只维护**稳定的**内容（服务恢复、基线、约定、未完成的事）。续接会话时：读本文件，再按文件名倒序读
> 最新的几个 `docs/changes/*.md`。下方历史段落冻结保留。

## 一句话状态
**全部已合并，main 干净、无待合分支。** PR #20（`fix/rider-off-news-leak`：关掉的海报不再漏给骑手 + 促销窗口统一由 isPromoActive 判定 + 改动记录一次一个文件 + **4 个既有 e2e 失败已修**）与 PR #21（`fix/completion-quote-nets-promo`：**完工 WhatsApp 报价改用发票总额**，不再报未减促销的小计）都已进 main；main = origin/main = `6bd2f44`（已在本地 pull，11 个 commit fast-forward）。生产健康（/ /login /contact 全 200）。基线全绿：tsc 0 / vitest **423**（33 文件）/ build 0 / **Playwright 全量 47 通过 · 0 失败**。**下一步的日常待办只剩「等 owner 表态的两件事」+ 逾期的两条上线项。**

## 会话信息
- 原会话 ID：session-a62205e6-be99-40cf-a61b-7fa862f52af4
- 本会话 ID：session-df92a8c8-e683-4596-ae0e-abfaa782852e（续接会话「继续 D&Z」）
- 打包时间：2026-09-11 04:39
- 续接口令：继续 D&Z
- 续接会话：session-8b24dc21-4d74-4908-8f08-f11b45dc7b86（2026-09-11 12:4x，修完 4 个 e2e 失败）

## 完成进度（近期，最新在上；完整逐次记录见 docs/changes/）
- **完工 WhatsApp 报价改净额（PR #21 已合）**：消息取自发票**总额**（已减促销）而非小计——此前同一事务里发票是对的、发给客户的消息是错的（消息 RM165 / 发票 RM148.50 / 柜台按发票收）。消息文案抽成纯模块 `completion-message.ts` + 6 例单测（含反向验证过的源码守卫）+ 从 campaign 链接进入的端到端 spec。
- **4 个既有 e2e 失败已修（不是业务 bug）**：页内功能导览的气泡卡压在页面内容上（`/rider/book` 的导语气泡正好盖住第一张分行卡），被压住的 click 一直重试到 120s 超时——测试没按用户的方式走（按 Skip），加 `dismissGuide` 后三例通过，master journey 一路绿灯。另删掉一条会腐烂的断言（硬编码 "November 2026"：估算从"今天"起算，写死月份必然过期）。全量 46 通过。
- **关掉的海报不再漏给骑手（PR #20 已合）**：News 页本来就对了，漏的是它链接过去的 /rider/promotions（读全部素材、无 published 过滤）——生产 22 个素材中 10 个已关闭却一直露出。顺带把四处各自手写的「促销是否生效」统一为 isPromoActive（其中两处只查 endDate：未开始的促销提前露出、无结束日期的长期促销被整条排除）。
- **Content Studio 三件事（PR #19 已合）**：内容其实早已落库，缺的是入口——新增「已生成内容」面板可回访（复用服务端早就存在却从未被前端调用的 GET）、一键导出 .md、标记已发布（接上预留的 status: USED + 新增 usedAt）。
- **发票就地看明细 + 结账打折（PR #17 / #18，已进 main）**：发票卡片可展开看明细行（数据源是完工快照 InvoiceItem）;收款弹窗可打百分比/金额折扣——**手动折扣与促销 discountSen 分开记**（后者是 marketing 归因字段，混写会让 ROI 失真）。
- **营销数据上生产 + 服务价目可编辑 + 日历 cron（已进 main）**：`pnpm seed:marketing` 一条命令种日历/产品/品牌；服务价目原本 UI 里根本改不了（只有 create/toggle/delete），已补 updateServiceType；日历每月 1 号 cron 自动滚动。
- **部署 45 分钟超时根治（PR #14，已进 main）**：根因是构建期 schema 同步连生产库而 execFileSync 默认无超时；改为优先 DIRECT_URL + 每命令硬超时。合并后部署回到 1–2 分钟。
- **内容引擎 P1–P7 + 海报三轮（PR #13，已进 main）**：候选脚本→人工选→展开→AI 出图全链路；海报艺术方向可选（默认平面 GRAPHIC）；抠图印刷化；文字读回校验。
- **指派机械师（PR #16，已进 main）**：下拉按工单分行过滤（此前列全部分行，选跨行的必被拒）+ 修裁切（共享 Select primitive 受益）。

## 下一步（按优先级）
1. **清理已合进 main 的分支**（`git merge-base --is-ancestor <b> origin/main` 逐条验后再删）：远端 `feat/content-studio-save` · `fix/rider-off-news-leak` · `fix/completion-quote-nets-promo`，本地同名前三条。
2. ~~4 个既有 e2e 失败要查~~ **已解决（`3c85e8c`，随 PR #20 进 main）**：真因是页内导览浮层挡住点击 + 一条会腐烂的日期断言，都不是业务 bug。
3. **等 owner 表态的两件事**：① 编辑工单弹窗里下拉浮层宽 22px（要不要改等宽，代价是长名字走省略号）；② **促销折扣只挂在「预约时选中的套餐/加项」上**——`resolvePromoForBooking()` 在`lines.length === 0` 时返回 null，而预约页套餐是可选的（默认 none，柜台 check-in 才选），所以**没在预约页选套餐的单子在促销期内不打折**（e2e master journey 就是：20% 促销生效、RM165 的单折扣 0，且 `promoAutoApply` 为 true）。要不要改成「按最终实际账单解析」，属营收行为决定。
4. **`feat/workshop-module-setup`（本地唯一未合并分支）**：a614dc0 含 scripts/setup-workshop-modules.ts（first-wave 开放 13/关闭 15），从未推送——推送 / 删除 / 放着，待定。
5. **可选清理**：`Organisation.qrEnabled` 现以 `@ignore` 挂在 pg schema（早期手工 DDL 遗留），可择机真正 DROP。
6. **经销商验证（需真人）**：填 docs/DEALER_FEEDBACK.md，按 DEMO_SCRIPT 演示，回答 6 个产品决策（dtodo 59e04e5e，逾期）。
7. **WhatsApp 真机上线（dtodo 92b29072）**：SETUP §5.3.1 五步。**另需 owner 在 Vercel 加 `DIRECT_URL`**（Supabase 直连 5432，非池化），让构建期 schema 同步走直连。

## 基线测试（命令 + 期望通过数）
- `pnpm exec tsc --noEmit`：**0 错误**（务必 `set -o pipefail`，否则 `| head` 会吞掉退出码）
- `pnpm test`：**423 个通过（33 文件）**
- `pnpm build`：通过。生产 build 复现：`pnpm exec prisma generate --schema prisma/schema.pg.prisma && pnpm exec next build`
- `pnpm exec playwright test --project=desktop-chromium`：**47 通过 · 0 失败**（跑一次会 wipe+seed prisma/e2e.db 并重启 :3102，约 5 分钟）
- 页内导览首次访问必弹且会挡住点击：spec 里导航到带引导的页面后先 `await dismissGuide(page)`（e2e/helpers.ts），不要用超时硬等
- e2e 里「有促销的单子」要 `bookViaRider(page, ctx, { query: "?campaign=<id>", packageName: "Standard Service" })`：**预约必须先选套餐**，否则 booking 没有计价行、拿不到 promo 快照（详见 docs/changes/2026-09-11-completion-quote-nets-promo.md）
- 单个 spec：`pnpm exec playwright test e2e/<name>.spec.ts --project=desktop-chromium`

## 服务与恢复
- workshop :3002：`curl -s -o /dev/null -w %{http_code} http://127.0.0.1:3002/login` = 200 ｜ 挂了：`launchctl kickstart -k gui/$(id -u)/com.dz-platform.server`
- rider :3003 / e2e :3102：同上换端口与 label（com.dz-platform.rider / .e2e）
- **改了源码必须 `pnpm build` 后 kickstart**。⚠️ **即使没改代码，只要重建过 .next 也必须 kickstart**——服务在跑期间换掉 .next，旧页面会去加载不存在的 chunk，浏览器报「This page couldn't load」。
- 生产：https://d-z-crm.vercel.app （push main 自动部署）

## git 状态
- main = origin/main = **6bd2f44**（PR #20、#21 已合并；本地已 pull）
- 远端分支：`main` · `feat/content-studio-save` · `fix/rider-off-news-leak` · `fix/completion-quote-nets-promo`（后三条都已合进 main，可删）
- 本地分支：`main` · `feat/workshop-module-setup`（未合并，见下一步 5）
- 未提交：0（tracked 干净）
- ⚠️ **勿 `git add -A`**：scripts/ 下有历史遗留脚本（_dims.ts、capture-*.ts、gen-*.ts 等）、screenshots/、docs/templates/ 等未跟踪产物，加文件务必逐个列出。

## 关键决策与约定
- **工作流**：一切改动走 feature branch → push → **owner 在 GitHub review + merge**；不直接 push main、不自行触发 Vercel 部署。
- **文档改动规矩（2026-09-11 起）**：逐次改动写 `docs/changes/YYYY-MM-DD-<slug>.md`（`pnpm new:change <名字>`），**不要再往 SETUP §9 台账加行、也不要往本文件顶部加段落**——那两处已冻结，`tests/docs-changes.test.ts` 会拦截。理由：两条分支都往同一处插内容，合并必然冲突（已发生三次）。
- **分行隔离**：org 级角色（SUPER_ADMIN/OWNER/HEAD_OFFICE_ADMIN）看全部份；其余锁 session.branchId（src/lib/branch-scope.ts）。job 创建/分配按 session/branch 且拒绝跨行 mechanic（`src/lib/job-branch.ts` 是唯一定义）。
- **消息**：所有 workshop→rider WhatsApp 必须走 messagingModule.sendDirect/sendFromTemplate（真发、记真实 status/externalId），禁止直写 status: SENT；营销必须 isMarketing:true 以走 opt-out 检查。
- **规则只写一遍**：一条业务规则出现两处实现就会漂移。已收敛的先例：`isPromoActive`（促销是否生效）、`job-branch`（工单归哪个分行）、`isWindowOpen`（内容窗口）、`applyDiscount`（折扣算法）、`orderInvoiceLines`（发票行顺序）。新增同类规则请照此办理。
- **营收相关开关存 DB，不写源码常量**：先例 `Organisation.promoAutoApply`，UI 开关在促销日历页。
- **双 schema 同步铁律**：prisma/schema.prisma（sqlite）+ prisma/schema.pg.prisma（PG）必须同步改；改完 `pnpm exec prisma generate`。
- **业务日期存 UTC 零点；金额存整数 sen。**
- **发票语义**：`Invoice.discountSen` 是**促销归因**（marketing 的 ROI 读它），柜台手动折扣必须走 `manualDiscount*` 五个字段，不得混写。

## 踩坑与事实
- **服务是 launchd `next start`，读 ./next**：改源码或重建 .next 后必须 kickstart。
- **`src/lib/i18n.ts` > 2500 行**：read(默认 limit)+write 会**截断**，必须用 `edit`，改完确认行数没缩。
- **合并 main 后若带了 schema 变更，必须 `pnpm exec prisma generate`**：否则 tsc 报 Property X does not exist，那是生成的 client 过期，不是代码错。
- **SETUP_AND_PREPARATION.md 里有 7 张表共用同一个分隔行**：要定位 §9 台账只能用它的表头 `| 日期 | 改动 | 影响 |`。
- **解决文档冲突不要手抄**：用 `git show <自己的commit>:<path>` 抽原文再插回。
- **本项目路径含 `&`**：bash 里引用路径必须加引号。`pnpm add` 需 `--store-dir .pnpm-store`。
- **只有真实 build 能抓到的坑**：opentype.js 双形态、sharp 被客户端组件间接引用（tsc 与 vitest 全绿、build 失败）。涉及原生/双形态依赖必须跑 `pnpm build`。
- **本地能登录的账号**：`daniel.tan@dz.my`（OWNER，Supabase，密码 Dashoil@!789）；`test.owner@dz.my` 与 `crm_do_owner@gmail.com` 本地登录会 Invalid login credentials。
- **本地 dev.db 重置后 Customer.authId 丢失** → rider 登录报「No D&Z account linked」（演示/截图用生产环境）。
- **Vercel CLI token 已失效**（403 invalidToken）：无法再用 API 查部署状态，看 dashboard。
- Branch/ServicePackage/Inventory 等无 createdAt（defaultSort/select 勿用）。

## 待办（dtodo）
- 59e04e5e 经销商验证（逾期 2026-08-19，需真人）
- 92b29072 生产迁移 / provider 换真（逾期 2026-08-19）：WhatsApp 上线 5 步 + Payment/Notification 选型

## 新会话头 10 分钟
1. **探活**：`curl -s -o /dev/null -w %{http_code} http://127.0.0.1:3002/login`（另 :3003 / :3102）；挂了 `launchctl kickstart -k gui/$(id -u)/com.dz-platform.{server,rider,e2e}`
2. **读本文件 + `docs/changes/` 最新几个文件**（按文件名倒序）+ memory（project/daily）+ `dtodo list`
3. **跑基线**：`set -o pipefail; pnpm exec tsc --noEmit`（0）+ `pnpm test`（**417**）
4. **挑下一步**：优先「下一步 3」那 4 个既有 e2e 失败（疑似真 bug）
5. **若改了源码**：`pnpm build` 后 kickstart 三端再验证；有新改动用 `pnpm new:change <名字>` 建条目

---

## 历史段落（冻结于 2026-09-11，逐次改动的原始记录）

**🐛 修复「关掉的内容仍出现在 rider 资讯」（分支 fix/rider-off-news-leak，已 push 待合）**：owner 报告。
**根因不在 News 页，在它链接过去的那一页** —— News（/rider/service-history）**正确过滤了 published**，
但它的 View all 指向的 **/rider/promotions 读全部素材、完全没有 published 过滤**。
生产实测 22 个素材中 10 个已关闭、News 显示 12 / Promotions 显示 22 → **10 个关掉的海报一直漏给骑手**。
**顺带发现同类的促销窗口问题**：四个 rider 页面各自手写一部分「是否生效」，其中 book 与 service-history
**只查 endDate** → 未开始的促销被提前展示、**无结束日期的长期促销被整条排除**（而 isPromoActive 认为它们是有效的）。
修法：promotions 加 published:true；四处统一用唯一的 isPromoActive；home 改为取 24 条再过滤
（原先取 3 条再过滤，若那 3 条都已结束则首页一条优惠都不显示）。
**反向验证过**：守卫在旧代码上确实失败；e2e 第一版有空跑，已改成自行造数据再断言。
vitest **397**（31 文件）、Playwright 2/2。无 schema 改动。

**📦 Content Studio 内容可回访/导出/标记已发布（分支 feat/content-studio-save，已 push 待合）**：owner 问「如何 save content」。**查清后发现内容早已落库**（expandedJson + posterUrl），真正问题是**回不去**——Studio 只把当前一次跑的结果放在内存，刷新后界面无入口。三缺口一并补：① **回访** — Studio 新增「已生成内容」面板，调用**服务端早就存在、注释写着 for the studio's history panel、却从未被前端调用的 GET**，点一条即还原（新增 `load` action）；只列 `expandedAt` 非空的，半成品候选不列（否则面板会变成第二个更差的 Script Bank）。② **导出** — 纯模块 `src/modules/marketing/content-export.ts`，一个按钮导出 4 平台 caption（各自带平台标题）+ hashtags + 海报文案 + 海报链接 + 发布提示为单个 .md（**客户端 Blob，零新依赖**）。③ **已发布** — 新增 `mark-used` action + **ContentScript.usedAt**（双 schema + 迁移 add_content_script_used_at）；此前 `status: USED` 预留却全代码零写入。实测：下载 .md 内容正确、标记后数据库 status=USED 且 usedAt 写实、列表即时变 Posted。**生产 usedAt 列已直连应用**。新增 tests/content-export.test.ts 12 例 + e2e 2 例；vitest **403**（30 文件）、build 0。

**💰 结账可打折（已合进 main，PR #18）**：柜台收款时可选「百分比 / 金额」给整单打折。**核心决策：手动折扣绝不写进 `discountSen`**——那是促销归因字段（completion 写入、marketing 的 performance.ts 读它算 campaign 折扣成本与 ROI），柜台折扣写进去会让促销 ROI 静默失真。新增 5 列（双 schema + 迁移 add_invoice_manual_discount）：manualDiscountSen/Kind/Value/Reason/At；算法唯一收在 `src/modules/finance/invoice-discount.ts`（净额=subtotal−促销−手动、下限 0；百分比以 subtotal 为基准；**记录「实际减免」而非「请求减免」**）。守卫：已结清拒绝（那是退款）、折扣后总额不得低于已收款、分行隔离、每次写 AuditLog；**不设权限门槛是 owner 的决定**。UI 在收款弹窗内三选+数值+原因并实时预览，折扣把账清零则自动结清。**生产 5 列已直连应用**（17 张发票默认 0、站点 200）。e2e 断言数据库：RM1025 → 10% → 减免 RM102.50、总额 RM922.50、促销字段不变、PAID、收款恰为 92250。vitest 391；全量 e2e 36 通过（4 个失败是既有 rider 预约问题）。

**🧾 发票页可就地看明细（已合进 main，PR #17）**：每张发票卡片一个 `<details>` 折叠（**零 JS**，页面仍是 Server Component），展开显示「描述 · 数量 × 单价 · 行小计」+ 小计/折扣/税/合计。**数据源是发票自己的 `InvoiceItem`（完工快照）而不是工单实时行**——工单事后被改也不会与已开票金额不一致。**新增 `src/lib/invoice-lines.ts`**：InvoiceItem **无 createdAt**，故在代码里定序 SERVICE → FEE → APPROVAL → PART，同类别稳定排序。实测 e2e 144 张发票全部有折叠控件、展开 3 行且 subtotal=total=16500；截图 app-screenshots/invoice-details-open.png。**生产有 1 张发票没有任何明细行**，已处理为「No line items on this invoice.」。新增 tests/invoice-lines.test.ts 8 例 + e2e/invoice-details.spec.ts 2 例。

**🔧 指派机械师修复（已合并进 main = fb63fb4，PR #16）**：owner 报「机械师下拉被挡 + 没按分行过滤」。**根因**：同一条规则写了两遍——`createJob` 按【登录者分行】（org 级→主店）建单并拒绝跨行机械师，下拉却按 `scopedStaffWhere(session)` 列【登录者能看到的全部分行】；生产实测 2 分行 13 人，owner 看到 13 个、其中 4 个选了必被拒。已抽成唯一定义 `src/lib/job-branch.ts`（`resolveNewJobBranchId` / `staffWhereForBranch` / `loadAssignableStaff`），`createJob`、`jobs/new`（工单将归属分行）、`jobs/[id]`（**工单已有 branchId**，与 assignMechanic 校验同源）共用。**下拉裁切根因**：`SelectContent` 宽度跟着触发器（而触发器 `w-fit`，只有当前选中项那么宽）+ `ItemText` 是 `shrink-0 whitespace-nowrap` + popup `overflow-x-hidden` ＝ **无省略号的硬裁**；已改 `min-w-0 truncate`（**共享 primitive，全站 Select 受益**）+ 触发器稳定宽度 + 单分行时不显示「· 分行名」。顺带把重复三遍的 `MechanicOption` 合并为 `components/workshop/mechanic-option.ts`。**验证**：e2e seed 只有 1 分行复现不了，测试**自建第二个分行+机械师**，并**反向实测**（去掉过滤后测试确实报 "offered a mechanic from E2E Other Branch"）。**⚠️ 发现 4 个既有失败**：`ahmad-complete-service-journey` 与 `booking-and-approval-flows` 的 3 个用例在 rider 选分行处 120s 超时——**已在干净 origin/main 上复现同样失败，与本分支无关**，但疑似真实问题（rider 预约链路），建议下一个 bug 从这里查。

**✅ 两个真实缺陷已修（2026-09-10，同一分支）**：① **服务价目在 UI 里根本改不了**——`actions/settings.ts` 只有 create/toggle/delete，生产 8 个服务全部 priceSen=null 且无法设置；而 `buildFactSheet` 读到 null 就不报价（引擎拒绝编造价格），于是**整条报价能力被一个缺失的编辑入口关掉**。已加 `updateServiceType`（org 级鉴权 + 校验；undefined=不改、null=清空）+ 行内编辑 + 无价提示带（三语）。② **日历会静默过期**——发薪日按当月滚动，种一次只有 18 个月；写入路径提到 `src/modules/marketing/occasion-seed.ts`（脚本与 cron 共用），新增 **每月 1 号 cron `/api/cron/marketing-calendar`**（Bearer CRON_SECRET，实测无头 401）。顺带把就绪度报告从 raw SQL 改为复用 `isWindowOpen`（消掉 camelCase 列名引号坑，本地不再显示 unknown）。⚠️ **未验证**：设置页「编辑」按钮的点击链路（本地 staff 走 Supabase 登录、无凭据），**请 owner 点一次确认**。

**✅ 营销数据已上生产（2026-09-10）**：新增唯一入口 `pnpm seed:marketing`（`scripts/seed-marketing-data.ts`）——按正确顺序种日历/产品/品牌并打印就绪度。生产实测 **38 节点 / 22 产品 / 2 品牌档案**，`rankOccasions` 当天给出 **Hari Malaysia（窗口 OPEN，D-5）**；重复执行 0 新增。四个旧脚本改为导出 seed、仅直接执行才跑（此前 import 即执行，无法编排）。**两个真实缺陷已修**：① 产品导入每次把 brand 写回 null（单独跑会把 22 个产品全去品牌）② 就绪度 SQL 里 startDate 未加引号被 Postgres 折叠成 startdate（camelCase 列名必须加引号）。**新坑**：client 按单一 schema 生成，拿 postgres URL 跑需先 `prisma generate --schema prisma/schema.pg.prisma` 再还原。⚠️ 待 owner：合并 `feat/marketing-prod-data`。

**✅ 生产 schema 已应用（2026-09-10）**：直接用直连地址对生产执行了增量同步——**66 → 70 张表、657 → 743 列**，新增 `Occasion`/`TrendTopic`/`PromoProduct`/`BrandProfile` + 10 索引 + 4 外键 + `ContentScript.angle`（可空 TEXT），共 112 条语句、**0 条 DROP/TRUNCATE**，耗时 2.2s，复验「schema and database agree」。既有数据全未受影响（User 21 / ServiceJob 25 / Invoice 17 / Booking 10 / Campaign 10 / Customer 3 / Motorcycle 6）。生产 /、/login、/contact 全 200。**⚠️ 但生产库里 Occasion=0、PromoProduct=0**——日历 38 条节点与 22 个产品当初只种进了本地 dev.db；部署成功后内容引擎会因「无节点、无产品」而看起来空转，需在生产跑 `scripts/seed-occasions.ts` 与 `scripts/import-promo-products.ts`（图片 public/products/*.webp 已随代码部署）。

**🔴 当前最要紧**：生产部署连续超时——PR#12 45.6 分钟 ERROR、PR#13 仍在 BUILDING（正常部署只要 1–2 分钟）。根因 = buildCommand 里的 schema 同步步骤连生产库、而 `execFileSync` 默认无超时，池化连接下 Prisma 不报错只是**一直等**。已在分支 **fix/build-timeout-schema-sync** 修好（优先 DIRECT_URL + 每命令硬超时 + 检查失败放行/应用失败快速失败），**待 owner 合并**；另需 owner 在 Vercel 设 `DIRECT_URL`（Supabase 直连 5432）。**marketing 分支已被 owner 合并进 main（PR #13 → 22c4d73）**。

**✅ 合并顺序已解锁**：`fix/prod-schema-drift-guard` 已由 owner 合并进 main（**PR #12 → main = 3ae3bad**），所以 **`feat/marketing-content-engine` 现可干净合并**（共同祖先 0b37413 已在 main 内，无冲突）。该分支内容引擎 **P1-P7 全部完成**（候选脚本→人工选→展开→AI 出图全链路 + 海报艺术方向可选 + 抠图印刷化）。生产当前健康（全 200，drift 0）。基线全绿（tsc 0 / lint 0 error / vitest **335**（25 文件）/ build 0）。品牌已确认 **DASHOIL**。

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
