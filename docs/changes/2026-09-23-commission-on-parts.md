---
date: 2026-09-23
title: 零件计佣（P4b）：ServiceJobPart 并入计提，并做成 workshop 可开关
branch: feat/commission-on-parts
---

## 老板的决定与实现方式

问：零件（ServiceJobPart）是否计佣？答：**计**，但**要让 workshop 也能开关**。

所以实现成「业务开关」而不是写死的代码：

- 新增 Organisation.commissionOnParts（**默认开**）；
- 在佣金配置页顶部给一个开关（同页还有另一个开关，见下）；
- 关掉后零件**完全不计提** —— 连 0 元痕迹都不留（有意的：否则对账会把它报成「未被规则覆盖」，那是噪声）。

## 动手前先纠正了我自己的一个错误判断

我此前在记忆里写过「零件表没有目录身份，所以无法按规则计佣」。**这是错的**：
ServiceJobPart 明明有 productId（连成本价都有），规则解析（PRODUCT / CATEGORY 作用域）
与 P3 的阶梯统计都能照常工作。零件之所以从来没计过佣，只是因为**没有任何代码读这张表**。

教训：**「某功能没实现」与「数据不支持」是两件事** —— 下结论前应该先看一眼表结构；我这次先写了结论，几轮之后才发现。

## 顺手补上的一个洞

做开关时发现 Organisation.commissionOnGross（P2 定义的「按原价还是按实付算佣金」）
**从 P2 起就没有任何界面暴露它** —— 等于「留了个口子但没人能用」。
这一期把两个开关一起放到配置页上：**钱怎么算是业务决定，不是代码常量**。

## 幂等：零件行有独立的唯一键

台账加 jobPartId 与 @@unique([jobPartId, kind])：与服务行的 (jobItemId, kind) 同等保证。
SQL 里 NULL 在唯一索引中互不相同，所以服务行（jobPartId 为 NULL）不会互相顶掉、零件行也各自只写一条。
「完工流程被重跑两次」在零件上同样于**数据库层**不可能产生第二条。

## 生产上线的顺序（血泪教训，这次提前做了）

给已有表加**唯一索引**时，构建期的 prisma db push 会拒绝执行、部署直接红
（PR #42/#43 就是这么连红两次的）。所以这次**先在生产库用幂等 DDL 建好列与索引**，再合并 schema 改动：

    ALTER TABLE "CommissionLedger" ADD COLUMN IF NOT EXISTS "jobPartId" TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS "CommissionLedger_jobPartId_kind_key" ON "CommissionLedger"("jobPartId", "kind");
    ALTER TABLE "Organisation" ADD COLUMN IF NOT EXISTS "commissionOnParts" BOOLEAN NOT NULL DEFAULT true;

已实测：执行成功、第二次执行同样成功（幂等）、PostgREST 能查到两列。

## 验证

- 新增 4 条测试：开关开时零件产生 BASE（金额 = 零件净额 × 5%、带 productId 与 jobPartId、jobItemId 为 null）、
  重跑不产生第二条、开关关时**一条台账都不写**、重新打开后重跑能补上；
- 全量 **60 文件 / 733 测试**通过，tsc 与 eslint 干净，跑完无残留测试组织。