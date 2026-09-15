---
date: 2026-09-15
title: 工单号是一段序列，不是一次字符串排序
branch: fix/job-number-sequence
---

## 改动

工单号（`DZ####`）此前有**两份**各自 max+1 的实现——`PrismaJobRepository.nextJobNumber`
与 `bookingService.checkIn` 里内联的那份——两份犯的是同一个错：把 jobNumber 当**字符串**
排序取「最大号」。这个错有两个后果，都在隔离库上确定性复现
（`scripts/perf/repro-races.ts` 场景 D）：

1. **四位数用尽就永久卡死。** 字符串序里 `DZ9999` 大于 `DZ10000`（'9' > '1'），
   于是系统认定最大号是 DZ9999、下一个发出 DZ10000 —— 而那个号已经存在，`jobNumber @unique`
   必然拒绝。这不是「并发才偶发」：**从这一刻起每一次建单都失败**，而且重试算出的还是同一个号，
   不会自愈。
2. **无关格式会把号码带跑。** 号码里混进别的格式时（压测数据造出的 `PERF900299`），
   `replace(/\D/g, "")` 会把前缀一起剥掉参与比较，算出 `DZ900300` 这种凭空跳号。
   压测库就是活例：7,307 条工单里 `PERF900299` 是字符串最大，于是 `nextJobNumber()`
   返回 DZ900300，柜台建单成功、预约 check-in 直接抛 Prisma 错误（`repro-races.ts --scenario D` 改前输出）。

- **新增 `src/lib/job-number.ts`——号码的唯一定义**：`parseJobNumber`（严格只认 `DZ<十进制数>`，
  其它格式返回 null）、`nextJobNumberFrom`（按**数值**取最大）、`allocateJobNumber`（只读
  jobNumber 一列）、`isJobNumberConflict`（只认指向 jobNumber 的 P2002）、
  `retryOnJobNumberConflict`（撞号就重算重来）。
- `src/repositories/prisma/jobs.repository.ts`：`nextJobNumber` 只转发给 `allocateJobNumber`。
- `src/modules/service-jobs/service.ts`（柜台建单）：算号与落库一起包进 `retryOnJobNumberConflict`。
- `src/modules/bookings/service.ts`（预约 check-in）：删掉内联的那份 max+1，改用
  `allocateJobNumber(tx)`（算号与插入仍在同一个事务里），整笔包进 `retryOnJobNumberConflict`。

并发那一半没有条件更新可写（编号是序列，不是计数器字段），所以由唯一约束当裁判：
两笔同时算号会算出同一个号，插入时输的那笔重算一次再来（上限 3 次）。

## 影响

- 工单号**单调递增且必定能落库**：跨数位（DZ9999 → DZ10000 → DZ10001）不再撞约束，
  四位数用完不再是末日。
- 号码只由库里的 `DZ<数字>` 行决定；导入数据、历史遗留、压测前缀不会再影响发号。
- 并发 check-in / 建单不再有一笔因抢号失败（此前那一笔会把柜台的 check-in 直接打断）。
- 代价：发号要读一遍 jobNumber 列（只取一列、不带 include）。量级参考压测档
  （35k 工单 ≈ 几百 KB）。若将来这一列成为瓶颈，升级路径是换成一张真正的计数器表
  （一次 `increment` 即出号），接口形状不变。

## 交接说明

- **验证过的事**：`pnpm exec tsc --noEmit` 0 错误；`pnpm test` **486 通过 / 38 文件**（新增 16 例）；
  隔离库复现 `DATABASE_URL="file:./perf.db" pnpm exec tsx scripts/perf/repro-races.ts --scenario D`
  改前 ❌（check-in 抛唯一约束）、改后 ✅（两条路径都成功，且给出 DZ10001）。
- **守卫做了反向验证**：`tests/job-number.test.ts` 的 D 段是源码守卫（「按字符串排序取最大号」
  这个写法必须消失、两条路径必须都用 `allocateJobNumber` + 撞号重试）。把三个源文件
  `git stash` 回 origin/main 状态后，这 3 条守卫全部失败、其余 13 条照常通过；改回来即全绿。
  A/B 两段里还各留了一条 `legacyNextJobNumber`（逐字抄自 origin/main）的反向断言，
  用来证明这些输入**真的**能踩中旧缺陷（否则用例可能只是在测旧代码本来就能过的输入）。
- **刻意没做**：没有引入计数器表，也没有用 `$queryRaw`。两者都能把发号降到 O(1)，
  但都会碰生产（schema 变更 / 两套方言的裸 SQL），而当前这条路径的量级不需要——
  判断依据写在上面「代价」一段里。
- **仍然存在的第三处号码来源（有意保留）**：`src/lib/seed-core.ts` 的 `makeJob` 自己发
  `DZ1024+seq`。它是**离线造种子数据**用的（新库、单进程、不可能并发），不走服务端那条路径；
  发完种之后真实建单会按库里已有的 `DZ<数字>` 取最大值，两者自然接上，因此不并进
  `allocateJobNumber`。顺带记一笔：同一个文件第 360 行的 `nextJobNumber` 箭头函数**从未被调用**
  （实际用的是 `makeJob` 里内联的那两行），属既有死代码，本次不动它。
- `scripts/perf/repro-races.ts` 新增场景 D（含 `cleanupJobs`：按 jobNumber 连带删掉从属行，
  脚本可反复跑）。场景 A/B/C 是上一批并发修复留下的，行为未改。
