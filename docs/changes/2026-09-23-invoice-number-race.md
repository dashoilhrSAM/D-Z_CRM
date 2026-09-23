---
date: 2026-09-23
title: 修并发完工时发票号撞车（整个完工事务会回滚）
branch: fix/invoice-number-race
---

## 怎么发现的：一条「偶发」的测试，追到最后是真 bug

全量测试跑了一轮红、单跑绿、再跑三轮又全绿 —— 典型到可以当教科书案例。
我没有把它记成「flaky 不管」，而是让实验把**失败详情**也落盘（第一次我只 grep 了 FAIL 行，
把断言与报错正文丢掉了，那是我的疏忽）。第 6 轮复现，报错是：

  PrismaClientKnownRequestError: Invalid prisma.invoice.create() invocation:
  Unique constraint failed on the fields: (invoiceNumber)
  ❯ db.$transaction.timeout src/services/completion.ts:104

## 真正的 bug

完工事务里发票号是这样生成的：

  const invCount = await tx.invoice.count({ where: { invoiceNumber: { startsWith: "DZ-" + year + "-" } } });
  const invoiceNumber = "DZ-" + year + "-" + String(invCount + 1).padStart(5, "0");

**读出当前值 → 判断 → 写回** —— 本项目早已把它写成禁区（并发一致性约定第 ① 条），
而这处漏了，并且是资金单据：两个并发的完工事务读到同一个 count，第二张发票撞唯一键，
**整个完工事务回滚**：发票、收款、库存扣减、佣金、服务提醒一起没了。

第二个隐患：count 会在**删除发票后变小** —— 号码会回退到已经用过的号。

## 为什么之前的实跑没撞上

今天在生产上跑的那几张单是**一前一后**完成的（我先建单、等技师拍照、再完工），
并发窗口根本没被打开。真实车间里两个柜台同时完工就会撞上 —— 这才是它值得修的原因。

## 修法：原子取号

- 新增 InvoiceCounter（按年份一行），取号走 upsert 的 UPDATE 分支：value = value + 1；
  Postgres 与 SQLite 都编译成 INSERT ... ON CONFLICT DO UPDATE，**是原子的**，天然不重号、不需要重试；
- 只有「计数器行第一次被创建」那一瞬间的并发会撞唯一键 → 重试（那时对方已建好，下次走 UPDATE）；
- 计数器首次建立时**从既有发票的最大号起步**（按字符串取最大，因为号码补零），绝不回退；
- 按**年份全局**编号而不是按组织：invoiceNumber 是全局唯一键，按组织分号会跨组织重号。

## 测试

本地 sqlite 在 Prisma 交互事务下是串行的，**真实竞态复现不出来**（本项目已有明文教训：
判断标准是「这段代码在目标隔离级别下是否原子」，不是「本地能不能复现」）。
所以测试钉的是**契约**：唯一、单调、删除发票后仍不回退、以及「这一年已有 00007 → 下一个必须是 00008」。

## 顺带说明：迁移里那段表重建

生成的 sqlite 迁移除了建 InvoiceCounter，还带了一段 ServiceJobItem 的重建。
我逐字比对过：**新旧定义完全相同**，唯一差别是补上了历史上缺失的 productId 索引
（本地库由迁移历史构建，缺了它；生产一直是按 schema 同步的，本来就有）。
数据由 INSERT…SELECT 完整搬迁，实测搬迁前后行数一致（工单行 38 / 零件行 4 / 发票 3）。

## 验证

- 新增 4 条测试；全量 **61 文件 / 739 测试**通过；tsc 与 eslint 干净；无残留测试数据；
- 生产 schema 检查（只读）：唯一待应用的是 CREATE TABLE InvoiceCounter —— **纯新增，无重建、无数据风险**。

## 这也解释了今天那条「偶发」

PR #62（佣金配置页重排）的说明里我写过「有一次与本改动无关的偶发失败，未能复现」。
现在它有名字了：**并发完工时的发票号撞车**。