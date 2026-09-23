---
date: 2026-09-23
title: 佣金引擎 P0：工单行带上目录身份（+ 归因报告）
branch: feat/commission-p0-item-catalogue
---

## 为什么

佣金要按 SKU / 服务 / 套餐配置，前提是**知道工单上的每一行是什么**。实测：ServiceJobItem 只有
description + 价格，没有 productId / serviceTypeId / packageId —— 系统今天无法回答"这一行是哪个 SKU"。
不改这个，后面所有按商品配佣金的规则都是空中楼阁。

## 改了什么

1. **schema（两个文件）**：ServiceJobItem 新增三个可空外键 —— productId / serviceTypeId / packageId
   （+ 索引 + 对端反向关系）。**有意可空**：历史行与柜台自由文本行必须能存；未链接的行在佣金侧按
   LEGACY 处理并出现在报告里，不假装准确。
   **为什么要 packageId**：工单里最大的一笔钱通常是套餐行（Standard Service RM120），它不对应任何
   Product/ServiceType —— 佣金侧因此需要"套餐"这一档作用域。
2. **迁移**：20260923120000_service_job_item_catalogue_link（sqlite 方言，ALTER TABLE ADD COLUMN +
   CREATE INDEX），已应用到 dev.db 与 e2e.db（两处都实测列存在）。
   生产侧走既有的构建期自动同步（vercel.json 的 sync-prod-schema），无需手工 DDL。
3. **写入点接上**（能在哪里知道就记下来）：
   - 套餐行 → packageId；套餐组件行 → productId；
   - 柜台加项（AddonInput）→ productId / serviceTypeId（新增两个可选参数，向后兼容）；
   - addRecommendation：**旧版本只在 PART 分支用了 productId，服务行把它丢掉了** —— 现在一并保留；
   - addJobServiceItems（柜台"市场目录"加项）→ serviceTypeId / productId 可选透传。
4. **归因报告**：scripts/commission/attribution-report.ts（只读，不修数据）。三块信息：覆盖率、
   无法归因的构成（按 kind/source + 金额前 10 描述）、**目录缺口**。

## 跑出来的数字（本地 dev.db）

    工单行 38 行，已带目录身份 0%（P0 代码尚未产生新行）
      总金额 RM 1130 | 可归因 RM 0
    金额最大的未归因描述：
      RM 240  Standard Service        ← 套餐行（packageId 会覆盖它）
      RM 135  Engine Oil Change       ← 柜台源码目录项
      RM 125  Oil Filter Replacement  ← 同上
    目录缺口：柜台在卖的 12 项里，**10 项目前没有对应的 ServiceType 行**；
      另 2 项（Engine Oil Change / Tyre Replacement）名字撞上了，但 **code 与 priceSen 都是空的**

最后一行是重点：**"列出每一个服务来配佣金"目前没有一份完整清单可列** —— 柜台卖的是源码目录
（lib/service-catalog，12 项，带稳定 key），管理员看到的是 ServiceType 表（8 行，无 code 无价），
两者粒度还不一样（DB 的 "Brake Service" vs 源码的 "Brake Pad Replacement" + "Brake Fluid Flush"）。
这就是 P0b（目录统一）要解决的事，也是"每个服务都能配"的前提。

## 验证

- 两个 schema 均通过 prisma validate；prisma generate 正常。
- 迁移已应用到 dev.db 与 e2e.db，列用 pragma table_info 实测存在。
- tsc 干净；611 测试全绿；报告脚本在 dev.db 上真实跑通。

## 说明

本 PR **不含任何佣金计算逻辑**（那是 P1/P2），页面行为不变；只是把"这一行是什么"记下来，
并给出一份能立刻看的现状报告。
