---
date: 2026-09-15
title: 考勤打卡带上照片与定位（HRM P1：证据链地基）
branch: feat/hrm-attendance
---

## 改动

老板要的是「打卡记照片 + 记位置，用来看车间/技师/员工谁在店」。侦察后发现**考勤早就有了**，
但它只是个打卡玩具，所以这轮不是新建，而是把它升级成**有证据链**的考勤：

- **修掉一个真缺陷**：`src/actions/attendance.ts` 用 `upsert` 写当天的行，**重复打卡会把早上那次的时间覆盖掉**。
  现在一天可以有多次进出，明细进 `AttendancePunch`，`Attendance` 只做当日汇总；连打两次上班卡被拒绝（`ALREADY_IN`）。
- **新增 `AttendancePunch`（不可变明细）**：服务端时间、照片 key + SHA-256、lat/lng/accuracy、服务端复算的 distanceM、
  来源/设备/IP、以及结论 `verdict`（OK / OUT_OF_RANGE / LOW_ACCURACY / NO_LOCATION / NO_GEOFENCE / SUSPECT_REUSE）。
  没有 update/delete 入口；要改只能追加 `AttendanceCorrection`（P2 接审批）并写 AuditLog。
- **`Attendance` 升级为当日汇总**：加 branchId / firstInAt / lastOutAt / workedMinutes / exceptionCount / status。
  原字段（`checkInAt`/`checkOutAt`）保留 → **历史数据零迁移**，老看板不用改。
- **`Branch` 加 latitude/longitude**；**`Organisation` 加四个政策开关**（attendancePhotoRequired / attendanceGeoRequired /
  attendanceGeofenceM=150 / attendanceAccuracyMaxM=100）——沿用 `promoAutoApply` 的先例：营收/合规相关行为存 DB，不写源码常量。
- **判定全在服务端**（`src/modules/attendance/policy.ts` + `service.ts`，纯函数 + 薄 IO）：
  客户端只许上报原始 lat/lng/accuracy，时间取服务端时钟，距离用 Haversine 在服务端算。
- **照片进私有桶**：新增 `StorageProvider.putPrivate/getPrivate` 与 `PRIVATE_OBJECT_PREFIX = "private/"`；
  `/api/storage`（公开出口）遇到这个前缀直接 404；照片只能经 `/api/attendance/photo/[id]` 读，
  该路由要求登录 + （本人 / 有 ATTENDANCE:view 且同店 / org 级角色），响应 `Cache-Control: private, no-store`。
- **前端只认现场拍摄**：`src/components/shared/attendance-punch.tsx` 用 `getUserMedia` 实时取帧，
  **不提供相册退路**（能选相册＝能交昨天的照片）；拿不到摄像头时按钮不可用并说明原因。
  定位尽力而为，拿不到就如实上报"没有定位"，绝不编坐标。
- **三个入口共用一个组件**：`/workshop/attendance`（柜台/销售/行政）、`/mechanic-app/profile`（技师）、管理端同一块面板；
  页面**不再硬过滤 `role: "MECHANIC"`**，改按 `scopedBranchId` 做分行隔离（org 级看全部）。
- **权限与导航**：新增权限模块 `ATTENDANCE`（此前挂在 TECHNICIANS 下），nav 的 access 改
  `["OWNER","COUNTER_STAFF"]`（MECHANIC 走 mechanic-app，workshop layout 本来就把他们重定向过去）；
  RBAC 矩阵给各角色补 `ATTENDANCE` 授权（无 `*` 的角色逐条补）。
- **业务日收敛成一处**：`src/lib/business-day.ts`（原来 `todayUtcStart()` 在 action 与页面各写一份）。
- i18n：`att.*` 从「技师考勤」口径改为全员口径并新增 30+ 键（EN/ZH/BM）；`src/actions/attendance.ts` 与
  `src/components/mechanic/attendance-button.tsx` 删除。

### 补充：私有桶已建 + 坐标/政策可在界面里填（同日追加）

- **Supabase 私有桶已建并验过**：新增 `scripts/provision-private-bucket.ts`（幂等），在项目
  `dukbfgqbrprivnzcsrlh` 上创建了 `dz-private`（`public=false`）。脚本不是"建完就算"——
  它会传一个探针对象上去，**用公开地址去取必须失败**，再用 service key 读回来确认可用，然后删掉探针。
  实测：公开地址 **400**（拒绝）、鉴权读取 ok、探针已清理。顺带确认了 `dz-assets` 是 `public=true`，
  这正是考勤自拍绝不能走那条路的原因。代码默认桶名就是 `dz-private`，所以 **Vercel 不需要加任何 env**。
- **坐标与政策改成界面可填**（原来我说"直接改库"）：
  - `/workshop/settings` 的行车表单里新增**门店坐标**两个输入（Google Maps 右键复制即可），
    未填的分行在列表上显示琥珀色「未设坐标」；`updateBranch` 接受并校验坐标（必须成对、必须是合法经纬度），
    且**坐标变更写 AuditLog**（`ATTENDANCE_GEOFENCE_SET`）——老板把围栏悄悄挪一下就能让越界记录变正常，
    这种改动必须留痕。
  - 新增「考勤政策」面板（OWNER 专属）：必须拍照 / 必须定位 / 围栏半径 / 精度上限，
    action `updateAttendancePolicy` 把数值**夹到合理区间**（围栏 10–5000m、精度 5–2000m，0 或负数会让
    "在店里"失去意义）并写 AuditLog。
  - 考勤页在「本店没坐标 + 你是 org 级角色」时给一条提示横幅，点进设置——否则所有人都是 NO_GEOFENCE，
    看起来像功能坏了。

### 门店坐标已确认并写入（同日）

owner 给的真实地址：**B-10-7, 3 Two Square, 2, Jalan 19/1, Seksyen 19, 46300 Petaling Jaya, Selangor**，
坐标 **3.1111141, 101.6316582**。这个数字不是猜的，做了三层核对：

1. Nominatim 查 `3 Two Square, Petaling Jaya` → `3.1111141, 101.6316582`；
2. Photon（另一个独立数据源）查同一地点 → `101.6316582, 3.1111141`（精确到小数位一致）；
3. **反向地理编码**该坐标 → road `Jalan 19/1`、neighbourhood `Seksyen 19`、postcode `46300`、
   city `Petaling Jaya` —— 与 owner 给的地址逐项吻合。第 3 步是决定性的：
   前两步只能说明「两个服务都认为 3 Two Square 在这里」，反查才能确认「这个点确实落在 Jalan 19/1 46300」。

半径 150m 对这个场地是合适的（用真实坐标跑了一遍判定）：本楼 0m → OK；大楼另一端 60m → OK；
停车场另一侧 110m → OK；**隔一条街 230m → OUT_OF_RANGE**；对面商场 600m → OUT_OF_RANGE；
室内拿不到定位 → NO_LOCATION（待确认，不判越界）。

已写入**本地演示库**的主店（`D&Z Smart Workshop`），并留下审计 `ATTENDANCE_GEOFENCE_SET`（before/after 都在）。
工具是 `scripts/set-branch-geofence.ts`（幂等；校验规则与审计动作名都跟界面的 `updateBranch` 对齐）。

**生产暂时写不进去**：PostgREST 查 `Branch.latitude` 返回 `42703 column does not exist` —— 这列的迁移还没部署
（分支未合并）。合并部署后构建期 schema 同步会补上列，届时在 `/workshop/settings` 里填一次即可
（`set-branch-geofence.ts` 走的是本地 sqlite client，连不上 PG，已在脚本头部写明）。

### 主店地址改成真实地址（同日，owner 确认「改」）

真实地址：`B-10-7, 3 Two Square, 2, Jalan 19/1, Seksyen 19, 46300 Petaling Jaya, Selangor`，城市 `Petaling Jaya`。
改了**三处**，只改数据库行是不够的：

1. **种子** `src/lib/seed-core.ts`：主店地址原来是**随机拼出来的**占位数据
   （`No. <随机数>, Jalan <城市> Utama`，所以本地和线上各是 No. 12 / No. 62）。
   现在用常量 `MAIN_BRANCH_ADDRESS`，城市改 Petaling Jaya —— 否则下次重建库又变回假的。
2. **本地演示库**（dev.db，:3002 用）：已更新。
3. **生产库**（PostgREST PATCH 主店那一行 `cmt0vj3440002i86ahwluaslw`）：已更新并通过 `return=representation` 读回确认。

顺带发现并修掉两处「地址在说谎」的地方：

- `src/app/workshop/inventory/stock/page.tsx` 的副标题把分行名**写死成 Kuala Lumpur**
  （页面本来就查了 `branch`）——门店在 PJ，这句话会一直显示错的，改成 `branch?.city`。
- `src/lib/constants.ts` 的 `ORG_NAME` 与 `BRANCHES` **零引用**（唯一同名命中是权限矩阵里的模块名），
  而 `BRANCHES` 宣称有三家店在 Kuala Lumpur / Shah Alam / Johor Bahru —— 与真实情况不符，删掉。
  真的分行只在 DB 的 `Branch` 表 + 种子里。

验证：tsc 0；vitest 496；build 通过；e2e 全量 51 通过（新种子地址生效），
改完页面后再跑受影响的 smoke + 考勤 21 通过。

（记录一次环境抖动：其中一轮 e2e 的 global-setup 在 seed 步骤失败，报 `main.Organisation does not exist` ——
那是 migrate 与 seed 之间数据库文件被重新创建的竞态，手工按 global-setup 的步骤重跑两次都成功，
紧接着重跑 spec 也全绿。**不是**本次改动引起，但再遇到时先按这个顺序手工复现，再怀疑代码。）

### 修掉一个我自己引入的 bug：柜台同事在侧边栏看不到考勤（同日）

在本地用真浏览器走查时发现：**柜台员工（COUNTER_STAFF）的侧边栏里没有「考勤」**——
页面本身能打开（手输 URL 就能打卡），但没人找得到。根因不在考勤，而在一处**老的双份实现**：

- `src/lib/nav-registry.ts` 里手抄了一份「角色 → 可 view 的模块」矩阵（注释写着「与 permissions.ts 一致」），
  因为它被 `"use client"` 的 sidebar 引用，**不能** import 带 `server-only`+`db` 的 permissions.ts；
- 我给考勤加权限时只改了 `permissions.ts`（`MODULES` + 各角色 `ATTENDANCE`），抄件没跟；
- 于是 `moduleAllowed(role, "ATTENDANCE")` 对非通配角色恒为 false → 侧边栏把考勤整条过滤掉。
  OWNER 是 `"*"`，所以我看自己测的时候一切正常——**这类 bug 只在非通配角色身上出现**。

修法不是给抄件补一行（那只会等下一次漂移），而是**把矩阵收敛成一份**：

- 新增 `src/lib/auth/role-modules.ts`（纯数据、无依赖、可进客户端 bundle）持有 `ROLE_MODULES`；
- `permissions.ts` 与 `nav-registry.ts` 都读它，手抄的 `DEFAULT_VIEW_MATRIX` 删除；
- `PermissionAction` 类型也移到那里并由 permissions.ts 转出（两个 action 文件原本从 permissions 引它）。

新增守卫 `tests/role-matrix.test.ts`（4 例）：① nav-registry 里不许再出现手抄矩阵；② 两个消费方都读同一份；
③ **考勤那条具体回归**——`moduleAllowed("COUNTER_STAFF", "ATTENDANCE")` 必须为 true；④ 逐角色逐模块，
导航的 view 判定与授权判定一致。反向验证：把 nav-registry 退回改前版本，这 4 条**全部失败**（含第 3 条）。

验证：本地浏览器实走 —— 柜台侧边栏出现「考勤」；柜台打卡成功；OWNER 看板 16 行 / 1 条证据 / 无「未设坐标」提示；
设置页政策面板在；技师端打卡按钮在。tsc 0；vitest 500；build 通过；e2e 全量 51 通过。

### 看板直接显示地点 + 打卡详情弹窗（owner 反馈）

owner 的两条反馈：①「打卡看不到这个人在哪里」；②「点开要弹窗，里面放照片、时间、地点，右上角 X 关掉」。

第一条的根因是**信息藏起来了**：地点只写在证据条的 `title` 属性里（鼠标悬停才看得到），
而老板要的是扫一眼就知道人在不在店里。现在每个人的行上直接显示**最近一笔打卡的地点**
（`距门店 63 m`），取到定位是正常色、没定位是琥珀色 `未取到定位`；行上与弹窗共用同一个
`locationSummary()`，避免两处各写一套措辞。

第二条把「点开就是一张裸照片、还跳到新标签页」换成**详情弹窗**：照片、时间、坐标
（可点 `在地图上查看` → Google Maps）、距门店、GPS 精度、打卡来源、判定；右上角 X 关闭，
**Esc 也关**、点背景也关，打开期间锁背景滚动。照片仍是私有对象（走 `/api/attendance/photo/[id]`），
弹窗里另给一个「在新窗口打开原图」。

为什么坚持弹窗而不是只给照片：单独一张照片判断不了任何事——要判断「这次打卡可不可信」，
得把**时间、地点、距离、精度、判定**放在一起看。

验证：本地真浏览器截图 + 视觉模型复核（照片真的加载、X 在右上角、六个字段齐全、无重叠截断）；
e2e 增加 2 条断言（行上必须有地点文本；点证据条弹窗→照片 naturalWidth>0→点 X 关闭）；
tsc 0；build 通过；**e2e 全量 51 通过**。

顺带一个真实世界的确认：owner 自己在本地演示页上打了一笔卡，服务端记的是**真实网络定位**
（±35 m、距门店 63 m、判定 OK）——150m 的围栏把这个误差覆盖住了，符合预期。
### 测试分行同址 + 门店信息收敛成一份定义（owner 决定：先放一样的地址）

owner 的指示：`D&Z Testing Branch` 是**测试占位**分行，但**先按主店同一地址**处理。

改之前先查了它是怎么来的：它**不是**种子建的（种子只建主店），而是
`scripts/provision-demo-branch.ts` 开通的，而且那个脚本自己拼了 `"Lot 123, Jalan Test, " + 城市`
（默认 Subang Jaya）——同一家门店的「身份信息」散在两处、各有各的写法。

所以这次不只是改数据，而是**把门店身份收敛成一份定义** `src/lib/branch-info.ts`：
`MAIN_BRANCH_NAME/CITY/ADDRESS/COORDS`，而 `DEMO_BRANCH_*` 直接引用主店那一组
（注释写明「暂同址，有独立地址时只改这里」）；种子与开通脚本都读它；
开通脚本同时写坐标——有坐标才会做围栏判断，同址就该同围栏。

数据侧（三处）：本地 dev.db 测试分行改为主店同址同坐标（坐标走带审计的 `set-branch-geofence.ts`，
`ATTENDANCE_GEOFENCE_SET` 已记录）；生产 PG 改地址/城市；种子与开通脚本改源头。

**生产坐标仍要等这次部署**：`Branch.latitude/longitude` 两列在库里还不存在（PostgREST 报 `42703`），
部署后构建期 schema 同步补上列，再在 `/workshop/settings` 把两个分行各填一次
（`3.1111141, 101.6316582`）。**在那之前，生产上两个分行的打卡都会记成 NO_GEOFENCE**——
是「还没配」而不是「判错了」，不会误伤员工。

验证：本地浏览器实查设置页——两个分行、坐标都已填、`No coordinates` 标记为 0
（截图 `screenshots/hrm-local/7-settings-two-branches.png`）；tsc 0；vitest 500；build 通过；e2e 51 通过。

一个副作用值得知道：两个分行现在**除了名字完全一样**，分行下拉里只能靠名字区分；
将来真有第二家店时，改 `src/lib/branch-info.ts` 里的 `DEMO_BRANCH_*` 那一组即可。
## 影响

- 打卡不再只是一行时间：每次打卡都有照片、位置、距离和结论，且**结论会如实告诉本人**
  （越界/低精度/无定位/照片重复 → 提示"待主管确认"）。
- 「谁在店里」有了可核对的依据：面板上每一笔都能点开看照片（走鉴权路由，本人与管理者可见）。
- 员工自拍与定位**不会**出现在任何公开 URL 上——这是这次改动里最要紧的一条隐私边界。
- 组织政策可调：围栏半径、精度阈值、是否强制拍照/定位，**都在 /workshop/settings 里填**（不用改库）。
  门店坐标此前为空，此时打卡记为 `NO_GEOFENCE`——是配置缺口，不算员工异常，不计入 exceptionCount。
- 数据库：新增 2 表 + 4 列 + 若干索引；迁移 `20260915025446_attendance_evidence`（sqlite，**纯加性**；
  Prisma 对 SQLite 的表重定义会 DROP+重建，但数据由 INSERT…SELECT 带过去，本地实测 Organisation 1 行 / User 16 行未变）。
- 生产 PG 由构建期 `scripts/sync-prod-schema.mjs` 自动加列建表（本分支合前跑一次 `--check` 复核）。

## 交接说明

- **验证过的事**：`pnpm exec tsc --noEmit` 0 错误；`pnpm test` **496 通过 / 38 文件**（`tests/attendance.test.ts` 25 例，main 基线 470/37）；
  `pnpm build` 通过；`pnpm exec playwright test --project=desktop-chromium` **51 通过 · 0 失败**（`e2e/attendance-punch.spec.ts` 2 例：填坐标 + 打卡）。
- **e2e 是真的在打卡**：Chromium 用 `--use-fake-device-for-media-stream` 给合成摄像头
  （不加这两个开关，弹窗永远停在"正在启动摄像头"，测的会是空壳），context 授予 geolocation 并给一个吉隆坡坐标。
  断言链：摄像头 ready → 提交 → 弹窗关闭 → 板上出现可点开的证据 → 本人读该照片 200 且 `image/*` 且 `no-store`
  → `/api/storage/private/...` 必须 404 → 再打一次上班卡被拒且明细数不变（防覆盖回归）。
- **守卫做了反向验证**：`git stash push -- src/ prisma/` 把改动退回 origin/main 状态后，
  `tests/attendance.test.ts` 的 4 条源码守卫失败（旧的 `src/actions/attendance.ts` 回来了、provider 没有 `putPrivate`、
  公共出口没有 `isPrivateObjectKey`、考勤页还在按 MECHANIC 过滤），其余 19 条照常通过。
  （第二次做了同一件事，但**提交之后 stash 只会退回未提交的那部分**——那次只回退了「设置页/政策」这一增量，
  于是新增的 2 条守卫失败、其余 23 条通过。两次验证各自对应各自改动的「缺了就会失败」。）
  **一条诚实的例外**：「考勤照片路由不在 API 公开白名单」在旧代码上也通过——旧代码里没有这个路由，
  它守的是一个**保持成立**的不变量，不是一次修复。
- **踩到的坑（第一版守卫假通过）**：源码守卫一开始用 `not.toContain('role: "MECHANIC"')` 读考勤页，
  却被页面注释里那句"原来硬过滤 role: MECHANIC"喂饱了 → 守卫必然失败。修法是断言前先 `strip()` 剥注释。
  这正好是本项目的老毛病（守卫看起来有效、其实在测别的东西），所以把过程写在这里。
- **刻意没做**：没做持续位置追踪（只在打卡瞬间取一次点）；没做人脸比对（照片是给人看的证据，不交给算法判决）；
  没做班次/迟到/请假（P3）；没做薪资联动（P5）；`AttendanceCorrection` 表已建但审批界面在 P2。
- **owner 要做的两件事**：① Supabase 建一个 **private** 桶 `dz-private`（或设 `STORAGE_PRIVATE_BUCKET`），
  否则生产上打卡会在写入照片这一步报错；② 在设置里填各门店坐标（P2 做界面，当前可直接改库），
  没填之前所有人都是 `NO_GEOFENCE`。
- **踩到的坑（加迁移之后忘同步 e2e.db）**：本机三端读各自的 sqlite，加了迁移只 migrate 了 dev.db，
  结果 **e2e 服务 :3102 的 `/` 直接 500**（`Organisation.attendancePhotoRequired does not exist`），
  而 Playwright 的 webServer 探活把 500 当成"没起来"→ 它去自己启动 → `EADDRINUSE` → 整轮 e2e 根本跑不起来。
  修法：`DATABASE_URL="file:./e2e.db" pnpm exec prisma migrate deploy` 再 kickstart `:3102`。
  教训：**加迁移后 dev.db / e2e.db 都要 deploy**（dev.db 是 demo 服务在用的）。
- **踩到的坑（本地私有存储的嵌套目录）**：`LocalStorageProvider` 原来只 `mkdir` 根目录，
  而私有键是 `private/attendance/<userId>/...` 这种多层路径 → 第一次打卡就 `ENOENT`。
  现在 privatePath() 逐级建目录，并挡掉 `..` 与越出存储目录的键。**这个 bug 是 e2e 抓到的**——
  单测只读源码是查不出来的，这也是坚持给"照片真的存进去了"写端到端断言的理由。
- **HANDOFF 本分支没改**：`fix/job-number-sequence` 与 `feat/hrm-attendance` 两条分支若都改
  HANDOFF 的同一行（一句话状态 / git 状态），合并必然冲突——这正是当初冻结它的原因。
  所以逐次改动只写本文件，**等两条分支合并后回 main 一次性刷新 HANDOFF**。