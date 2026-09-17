# HANDOFF — D&Z Platform（2026-09-17 11:20）

> 本文件由 session-pack 生成，session-resume 可续接。

> **⛔ 逐次改动不要再往本文件加段落**：改动记录写 `docs/changes/`（`pnpm new:change <名字>`）。
> 本文件只维护**稳定的**内容（状态、基线、服务恢复、约定、未完成的事）。

## 一句话状态
**🔴 生产部署目前是停的**：护栏（PR #29）与考勤 P2（PR #30）都已合进 main，但**两次生产部署都失败了**——构建期 schema 验证连不上生产库（`DIRECT_URL` 在 Vercel Production 里没生效，回落到池化 `DATABASE_URL`），护栏按设计 exit 1 拦住构建。**这是护栏在起作用，不是新 bug**；以前同样的连不上是静默放行的（fail-open），正是 2026-09-15 整站 500 的病因。

**生产本身是健康的**：失败的部署不覆盖线上，`/` 200，仍跑上一个可用版本 **e86d7f4**（= HRM 考勤 P1；P2 与护栏都还没上线）。本地基线全绿：tsc 0 / vitest **521**（39 文件）/ build 通过 / Playwright **55 通过 · 0 失败**；生产 schema 复检：PR #29 的 schema 与库 **agree**，PR #30 的只剩 13 条**纯加性**语句（新表 AttendanceReview）。

**owner 要做的第一件事**：在 Vercel → d-z-crm → Settings → Environment Variables 的 **Production** 环境加 `DIRECT_URL`（直连 5432，值同本地 `.env` 的 `DST_DATABASE_URL`），然后 redeploy。**在它修好之前，main 上任何一次部署都会失败**（护栏已上线）。详见 `docs/changes/2026-09-17-deploy-blocked-by-schema-verification.md`。

## 会话信息
- 原会话 ID：session-c5af9e3c-d22c-49a6-8fde-3c246dbfe102（「继续 D&Z」；本轮：HRM 考勤 P1 全链路 → 合并上线 → 生产 schema 事故与修复 → 护栏 → 权限矩阵收敛 → 地址/坐标落地 → 本次 session-pack）
- 上一会话 ID：session-4b560e7e-2615-41ec-8ad9-de9c53eefa6d（三支审计修复合并前的会话）
- 本次打包：2026-09-15 16:15（session-pack）
- 续接口令：继续 D&Z

## 完成进度（近期，完整逐次记录见 docs/changes/）
- **HRM 考勤 P1（已合并 PR #28，生产验证过）**：`AttendancePunch` 不可变证据链（服务端时间、照片 key+SHA256、lat/lng/accuracy、服务端复算 distanceM、verdict）+ `Attendance` 当日汇总（原字段保留，历史零迁移）；三入口共用 `components/shared/attendance-punch.tsx`（getUserMedia 实时拍摄，**无相册退路**）；行上直接显示地点、点证据开详情弹窗（照片/时间/坐标+地图/距门店/精度/来源/判定，X/Esc/背景可关）；权限模块 `ATTENDANCE`；`src/lib/business-day.ts` 收敛业务日。
- **生产私有桶 `dz-private`（public=false）**：`scripts/provision-private-bucket.ts` 建并自验（探针公开地址 400、鉴权读 ok、探针删除）；照片只经 `/api/attendance/photo/[id]` 鉴权路由，公开 `/api/storage` 对 `private/` 前缀直接 404。
- **生产事故（今天 15:03）与修复**：PR #28 合并 → Vercel 部署新代码，但**生产库缺整批 schema**（2 表 + 12 列）→ Prisma 缺列即该模型所有查询失败 → 首页 500（Next 报错页 + ERROR digest）。已 `VERCEL_ENV=production DIRECT_URL=$DST_DATABASE_URL node scripts/sync-prod-schema.mjs` 应用加性变更（DROP=0，2 表/12 列/5 索引），恢复后 `/` 200、`--check` agree。
- **护栏 `fix/schema-drift-fails-the-build`（待审）**：构建期同步原本**读不到库就跳过、让构建继续**（fail-open），于是「构建成功 + schema 未验证 → 上线 → 整站挂」。现改为**生产无法验证 = exit 1 拦住构建**（并提示设 DIRECT_URL），本地/预览仍放行。三条路径都实测过。
- **权限矩阵收敛（dce6f71）**：`src/lib/auth/role-modules.ts` 成为唯一定义，`permissions.ts` 与客户端 `nav-registry.ts` 都读它——修掉「柜台/销售在侧边栏看不到考勤」（手抄矩阵漂移；OWNER 是通配角色所以测试时看不见）。
- **门店地址/坐标落地**：主店 = `B-10-7, 3 Two Square, 2, Jalan 19/1, Seksyen 19, 46300 Petaling Jaya, Selangor` = `3.1111141, 101.6316582`（两个独立地理编码源 + 反向地理编码确认）；测试分行暂同址；坐标改走应用界面（带 `ATTENDANCE_GEOFENCE_SET` 审计）。门店身份收敛进 `src/lib/branch-info.ts`。
- **工单号序列修复（`fix/job-number-sequence`，未合并）**：字符串排序当数字用（DZ9999 > DZ10000，四位数用尽即永久卡死）+ 外来前缀污染（PERF900299 → DZ900300）；收敛到 `src/lib/job-number.ts` + 撞唯一约束重试。

## 下一步（按优先级）
1. **🔴 owner：在 Vercel 的 Production 环境加 `DIRECT_URL`，然后 redeploy。** 这是当前唯一的阻塞点——
   加好之前 main 上**任何**部署都会失败（护栏已上线）。值同本地 `.env` 的 `DST_DATABASE_URL`：
   `postgresql://postgres:<密码>@db.dukbfgqbrprivnzcsrlh.supabase.co:5432/postgres`（**5432 直连，不是 6543 池化**）。
   加完后在 Build Logs 搜 `[schema-sync]`：第一行应是 `database from DIRECT_URL`；仍是 `from DATABASE_URL` 就是没读到。
2. **部署成功后核对一次**：`DRIFT_CHECK_URL="$DST_DATABASE_URL" node scripts/sync-prod-schema.mjs --check` 应输出
   `schema and database agree`（P2 的 AttendanceReview 由那次部署自动建）。
3. **`fix/job-number-sequence` 必须先 rebase 到 main 再合**：它是在 HRM 之前分出去的，schema 落后一大截。
   实测（只读 diff）：拿它去部署会得到 **16 条全是 DROP/TRUNCATE**（`DROP COLUMN "workedMinutes"`、`DROP TABLE "AttendancePunch"` …），
   护栏会拒绝并 exit 1。**这不是 bug，是护栏在阻止生产库被清空**。
4. **考勤 P2 的后续（P2 本体已合并）**：更正审批（`AttendanceCorrection` 表已建但零调用、没有 relation——做之前先定它的形状）、
   员工自助查看本人历史、导出加照片链接。
5. **生产数据卫生（待 owner 决定）**：Testing 账号（test.owner / test.mech6 等）及其打卡记录是否清理。
6. **逾期待办**：经销商验证 59e04e5e、WhatsApp 真机上线 92b29072（含 Vercel env）。
7. 本地可选：`.vercel/project.json` 指向失效项目 id，`npx vercel link --scope dashoilhrsams-projects --project d-z-crm` 重链（需要权限）。

## 基线测试（命令 + 期望通过数）
- `pnpm exec tsc --noEmit`：**0**（务必 `set -o pipefail`）
- `pnpm test`：**521 通过 / 39 文件**（含 `tests/attendance.test.ts` 47 例、`tests/role-matrix.test.ts` 4 例）
- `pnpm build`：通过（改源码后必须 build → kickstart 三端 → 才跑 e2e）
- `pnpm exec playwright test --project=desktop-chromium`：**55 通过 · 0 失败**（约 5.5 分钟；会 wipe+seed `prisma/e2e.db` 并重启 :3102）
- 生产 schema 漂移：`DRIFT_CHECK_URL="$DST_DATABASE_URL" node scripts/sync-prod-schema.mjs --check` → 期望 `schema and database agree`
- 单个 spec：`pnpm exec playwright test e2e/<name>.spec.ts --project=desktop-chromium`

## 服务与恢复
- workshop :3002：`curl -s -o /dev/null -w %{http_code} http://127.0.0.1:3002/login` = 200 ｜ 挂了：`launchctl kickstart -k gui/$(id -u)/com.dz-platform.server`
- rider :3003 / e2e :3102：同上换端口与 label（`.rider` / `.e2e`）
- **加迁移后**：`dev.db` 与 `e2e.db` **都要**各跑一次 `DATABASE_URL="file:./<db>.db" pnpm exec prisma migrate deploy`，再 kickstart 对应服务（只 migrate 一个 → 那个服务页面 500 → Playwright 探活把它当没起来 → EADDRINUSE）
- 压测实例（隔离，勿打）：:3202 `com.dz-platform.perf`、:3203 `com.dz-platform.perf-small`
- 生产：https://d-z-crm.vercel.app （push main 自动部署；**带 schema 变更的部署前先确认 DIRECT_URL 生效**）

## git 状态
- main = **6a726b9**（PR #30 `feat/attendance-p2-review-and-reports` 已合并）；**线上正在跑的仍是 e86d7f4**（最后一个部署成功的）
- 已合并：PR #29 `fix/schema-drift-fails-the-build`（护栏，代码在 main 上但**从未成功部署**）· PR #30 考勤 P2 ·
  `fix/api-auth-gate` · `fix/write-path-authorization` · `fix/concurrency-atomicity` · `feat/hrm-attendance`
- **仍未合并**：`fix/job-number-sequence`（**需先 rebase 到 main**，见「下一步」第 3 条）
- ⚠️ **勿 `git add -A`**：scripts/ 下有历史遗留脚本、`screenshots/`（含 `hrm-local/`、`prod/` 截图）、`docs/templates/` 等未跟踪产物，加文件逐个列出

## 关键决策与约定
- **打卡三规则**：时间只取服务端；判定（距离/精度/重复照片）只在服务端（客户端只上报原始读数）；记录只追加（更正走 `AttendanceCorrection` + 审计）。
- **员工照片是个人数据**：必须走私有桶 + 鉴权路由，**绝不允许**出现在公开 URL；公开 `/api/storage` 对 `private/` 前缀 404。
- **地点必须行上可见**（距门店 xx m / 未取到定位），不许只放 title 属性；行与弹窗共用 `locationSummary()`。
- **一条规则只写一遍**（本轮两次收敛）：门店身份 → `src/lib/branch-info.ts`；权限矩阵 → `src/lib/auth/role-modules.ts`。
- **生产 schema**：加性变更由构建期 `scripts/sync-prod-schema.mjs` 自动同步；**生产无法验证时必须拦住构建**（失败部署保留上一个可用版本，未验证部署会打挂站点）。
- **改动工作流**：feature branch → push → owner 在 GitHub review + merge；不直接 push main、不自行触发 Vercel 部署。
- 业务日期存 UTC 零点；金额存整数 sen；营收相关开关存 DB（`Organisation.*`）不写源码常量。

## 踩坑与事实
- **重建 `.next` 会让开着的标签页报「This page couldn't load」**（Next 自己的错误页 + `ERROR <digest>`）。这类**客户端** digest 不在服务端日志里；`next build` 会在服务运行时替换 `.next`，构建期间浏览必然踩到。**改完 build 一次、让用户刷新**。
- **本机路径含 `&`**：bash 里引用项目路径必须加引号（`cd "/Users/Jun/Documents/CRM-D&Z"`），否则被当成后台符号，命令静默出错。
- 一次性 `evaluate` 读图片 `complete/naturalWidth` 必然撞竞态 → 用 `expect.poll`。
- 源码守卫的取函数体助手别按「顶格两空格闭合花括号」截断：会被函数内 `if` 块或**参数列表里的内联对象类型**提前截断（本轮连栽两次），要按括号配对。
- **大文件慎用 read→write 往返**：本轮 HANDOFF 的 read+concat+write 曾静默丢掉尾 18 行；改这类文件要 `git show` 抽原文用 shell 拼接，并**用 diff 校验尾段一字未改**。macOS 是 BSD sed，`sed -n '1,/x/{...}'` 这种块语法会报错并使输出为空。
- 真机定位实测：桌面约 ±35 m、手机 ±11 m；150 m 围栏覆盖得住（生产实测距门店 52 m 判 OK）。
- **Vercel CLI 权限**：本机登录 `dashoilai5-3794`，可列部署/读部署元数据（`inspect` + `vercel ls <project>`），但**读不到构建日志与环境变量**——`inspect --logs` 与 REST `/v3/deployments/<id>/events` 都返回 404，`env ls` 报「项目已删除或已转移」；`.vercel/project.json` 里的 `orgId` 是**另一个团队**，照它查什么都查不到。
  → **排查构建失败只能靠「本地复现 + 让 owner 贴日志」，别再花时间试图在线读日志。**
- **部署失败的三种「快速失败」（都在 `next build` 之前，约 20–25 秒）**：① `prisma generate` 失败（本地实测 1.1s，所以"快"不等于"不可能"）
  ② schema 验证连不上库 → 护栏 exit 1（本地实测 **<1s**）③ diff 里出现 DROP/TRUNCATE → 拒绝并 exit 1。
  成功的部署要 1–4 分钟，所以**看部署耗时就能判断失败在哪一段**。
- **本地复现护栏的失败路径**（安全，不碰生产，<1s 出结果）：
  `VERCEL_ENV=production DATABASE_URL="postgresql://postgres:x@127.0.0.1:59999/postgres" node scripts/sync-prod-schema.mjs`
- **判断一条分支能不能部署，不用真部署**（只读）：`git show <branch>:prisma/schema.pg.prisma > /tmp/b.prisma` 再
  `npx prisma migrate diff --from-url "$DST_DATABASE_URL" --to-schema-datamodel /tmp/b.prisma --script`，
  最后 `grep -ciE '\b(DROP|TRUNCATE)\b'` 数破坏性语句。**stale 分支会在这里现原形**（实测 `fix/job-number-sequence` 16/16 全是 DROP）。
- Prisma 对 SQLite 的「表重定义」迁移会 DROP+CREATE，但数据由 INSERT…SELECT 带过，本地实测行数不变，属正常。
- 生产 `AttendancePunch` 已有 2 条测试账号打卡（Testing Owner / Testing Mechanic 6），照片在私有桶、公开地址 400。

## 待办（dtodo）
- `59e04e5e` 经销商验证（逾期 2026-08-19，需真人）
- `92b29072` 生产迁移 / provider 换真（逾期 2026-08-19）：WhatsApp 上线 5 步 + Payment/Notification 选型

## 新会话头 10 分钟
1. **探活**：`:3002` / `:3003` / `:3102` 的 `/login` 应 200；另 `curl -s -o /dev/null -w %{http_code} https://d-z-crm.vercel.app/` 应 200。挂了：`launchctl kickstart -k gui/$(id -u)/com.dz-platform.{server,rider,e2e}`
2. **读本文件 + `docs/changes/` 最新几个**（按文件名倒序）+ memory（project/daily）+ `dtodo list`
3. **查 git + 查部署**：`git fetch --prune`；再 `npx vercel ls d-z-crm --scope dashoilhrsams-projects` 看最近部署是 Ready 还是 Error。
   **main 上有提交 ≠ 线上跑的是它**——当前正是这个状态（main = 6a726b9，线上 = e86d7f4）。
4. **跑基线**：`set -o pipefail; pnpm exec tsc --noEmit`（0）+ `pnpm test`（**521**）；要动源码再加 `pnpm build`（顺序：build → kickstart 三端 → 才跑 e2e）+ 生产 drift `--check`
5. **挑下一步**：**先确认「下一步」第 1 条那条阻塞还在不在**（`DIRECT_URL` 没生效时，任何部署都白搭）→ 再看 job-number rebase → 再往下做功能。**改 schema 前必读**「关键决策与约定」里生产 schema 那条。
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
