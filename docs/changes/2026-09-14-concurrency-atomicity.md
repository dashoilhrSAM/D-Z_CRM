---
date: 2026-09-14
title: 并发一致性（时段容量、库存扣减）
branch: fix/concurrency-atomicity
---

## 改动

审计里那句话是"低并发单店能跑，多柜台并发下会稳定出账实不符"。这一批先修最贵的两条，
并且**先证明它们真实存在**——不是读代码猜的。

### 先复现：scripts/perf/repro-races.ts

一个可重复运行的复现脚本（跑在隔离的 perf.db 上，自带 perf_repro 前缀可清理）：

| 场景 | 修复前实测 | 修复后实测 |
|---|---|---|
| **A 时段容量**：容量 3 的时段，10 个并发预约 | **10 单全部成功、超卖 7 单**，bookedCount=10 | **恰好 3 单成功**，7 条 SLOT_FULL，bookedCount=3 |
| **C 取消释放**：容量 1，预约后取消 | bookedCount 仍是 **1**（名额永久占用） | bookedCount **0** |
| **B 库存**：起始 5，10 次并发各扣 1 | 5 成功、结存 0、账实相符（**本地复现不出来**，见下） | 同上 |

**B 为什么本地复现不出来，这点比 bug 本身更重要**：Prisma + sqlite 的交互事务把并发串行化了，
所以"读 current → 写 current-qty"在本地跑一百遍都是对的。而在生产 PG（READ COMMITTED）下，
两个并发事务都读到 5、都写 4 —— 实扣 2 只记 1。**这正是那类"本地测试永远抓不到、
上生产几个月后才表现为库存对不上账"的 bug。** 所以我把它当成必须按写法修的项，
而不是"跑不出来就先不管"。

### 一、时段容量：检查与占用必须同一条语句

旧写法（src/modules/bookings/service.ts）：

    const slot = await db.appointmentSlot.findUnique(...)      // 读
    if (slot.bookedCount >= slot.maxBookings) throw SLOT_FULL  // 判断
    ... 建单、促销解析、审计等若干 await ...
    if (slot) await db.appointmentSlot.update({ ... increment: 1 })   // 占用

读与占用之间隔了整条建单流程，并发下全部通过检查。改为 claimSeat()：一次条件更新
（bookedCount < maxBookings 才 +1）+ 用受影响行数判定，抢不到就是 SLOT_FULL。
另外三处配套：

- **建单失败要补偿释放**：占位发生在建单之前，建单抛错必须把名额放回去，
  否则一次失败永久吃掉一个位置（catch 里 releaseSeatById）。
- **取消/爽约要释放**：transition 之前在 CANCELLED/RESCHEDULED 时**从不碰 bookedCount**
  ——这是"容量只增不减、时段被永久占满"的另一半。
- **只在状态真的变化时释放**：重复取消同一个单会把计数减到低于真实占用
  （before.status !== status 守卫）；releaseSeatById 另有 bookedCount > 0 守卫防负数。
- 改期：**先抢新位置再改单**（抢不到整笔拒绝，不留半改状态），改单成功后才释放旧位置。

### 二、库存：改增量语义与条件更新

- 仓库层新增两个方法：addInventory（upsert + increment，不再读出来加完写回）、
  deductInventory（updateMany + quantity >= qty 守卫 + decrement，返回受影响行数）。
- 服务层：deductStockTx 用条件扣减、count===0 才回读一次把错误信息说清楚；
  addStockTx 用增量；transferStock 的调入方同样用增量。
- 为什么不是"加个锁"：条件更新在 sqlite 与 PG 上语义一致、单语句原子、不需要事务隔离级别
  也不会有死锁；而这个项目没有跨引擎的锁原语可用。

## 影响

- 时段不再超卖；取消/改期会真正释放名额；建单失败不会吃掉名额。
- 库存扣减在 PG 上不再丢更新；入库/调拨并发不再互相覆盖。
- 行为上唯一可见的变化：并发抢最后一个名额时，失败方现在拿到 SLOT_FULL（以前会静默超卖）。
- **未改**：工单号 max+1（jobs.repository 与 bookings.service 各一份副本）。
  它同样是"读后写"，但正确的修法要么上 DB 序列、要么在唯一约束冲突时重试整笔建单，
  属于下一次改动；这里单独说明，避免读了这份文档以为并发问题已清空。

## 交接说明

- **验证**：tsc 0；vitest **445 通过**（35 文件，新增 tests/concurrency-guards.test.ts 6 条）；
  build 通过；全量 e2e 见下；复现脚本改前/改后对照见上表。
- **反向验证 12/12**：同一组断言跑在 origin/main 上全部失败（含"不许再出现 current - qty"
  与"不许建完单再 increment"这两条形态守卫）。
- **为什么守卫测的是写法而不是并发**：并发复现依赖调度运气与具体引擎，
  而"能原子更新的地方不要先读后写"是可静态检查的。两者互补——复现脚本证明问题真实，
  形态守卫防止它回来。
- **踩到的自家坑**：第一版守卫的取函数体助手用 indexOf("\n  }") 找结尾，
  会被**多行参数列表**里的 "\n  }) {" 提前命中，把函数体截断在签名处，
  于是断言在测一个空片段（一条直接失败、其余几条本可能空跑）。已改为
  /\n  \}\n/ 正则，并在提取为空时显式失败。
  这已经是本项目第二次栽在同一种"守卫看起来有效、其实在测别的东西"上。
