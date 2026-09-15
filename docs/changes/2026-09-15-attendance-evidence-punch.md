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