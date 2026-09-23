---
date: 2026-09-23
title: 佣金引擎 P1：规则表 + 纯函数解析器 + 管理页（含模拟器）
branch: feat/commission-rules
---

## 这一期做了什么

P0/P0b 让系统**知道工单上每一行是什么**；P1 让它**知道该给多少钱**，并把这套规则摆到界面上。

1. **CommissionRule 表**（迁移 20260923140000_commission_rule）：
   scope（PRODUCT / SERVICE / PACKAGE / CATEGORY / DEFAULT）+ targetKey + basis（PERCENT / FIXED / COMBO）
   + value / valuePercent / valueFixedSen + 生效区间 + priority + active + note + createdBy。
   两个刻意的设计：
   - **basis 是枚举**，所以「百分比和固定额同时设置」在数据层做不到 —— 那会变成运行时猜谜，
     而金额算错是会计事故。真要「5% + 每件 RM2」就显式用 COMBO（老板已确认需要）。
   - **targetKey 是查找键不是外键**：PRODUCT/SERVICE/PACKAGE 存行 id，CATEGORY 存分类名，DEFAULT 为 null。
     四个多态外键会带来「哪个为空就用哪个」的模糊判断，而解析器只需要按 (scope, targetKey) 精确查。

2. **纯函数解析器** src/lib/commission/resolve.ts（**26 条单测**）：
   - 最具体者胜、**命中即终止、不叠加**（SKU → 服务 → 套餐 → 分类 → 默认）；
   - 同一层里不会两种算法同时生效（枚举保证）；
   - 同层多条同时生效 → 取 effectiveFrom 最新 → priority 最大 → id 稳定排序，并置 **ambiguous** 标记
     （调用方必须显示，不允许静默择一）；
   - 没有规则时**明确报 no-rule**，绝不静默算 0；
   - 金额：PERCENT 四舍五入到分、FIXED × 数量、COMBO = 百分比部分 + 每件固定部分。

3. **冲突检测** src/lib/commission/conflicts.ts（5 条单测）：同 (scope,targetKey) 生效区间重叠即冲突；
   首尾相接（旧规则设了结束日期）**不算冲突** —— 那正是「改规则」的正确做法。
   放在 lib 而不是 actions：**"use server" 文件里导出的每个函数都会变成客户端可调用的 server action**
   （本项目在骑手改号那轮踩过同样的坑）。

4. **服务端动作** src/actions/commission.ts：listCommissionConfig / upsertCommissionRule /
   setCommissionRuleActive / simulateCommission。三道自己把的门：矩阵权限（TECHNICIANS/edit，OWNER/MANAGER
   走通配、技师与服务顾问只读）、入参校验（scope 与 targetKey 必须匹配、必须是真实存在的目录行、
   PERCENT 不得超过 100%）、**写入时挡重叠**（要改先给旧规则设结束日期，报错里带上冲突规则的内容）。
   资金类写入一律留 AuditLog。

5. **管理页 /workshop/commission**（导航挂在结算旁边）：一行一个 SKU / 服务 / 套餐 / 分类 + 默认级，
   显示当前生效规则与**来源层级**（没配的写明「未配置 — 继承自 Category」而不是显示 0）；
   **未配置的排前面**（这是待办清单）；冲突横幅；「全部规则」列表（含已停用，可重新启用 ——
   否则一次误停用就只能去改数据库）；**模拟器**（给金额试算，用的就是将来计提的同一个解析器）。

## 验证

- 新增 **31 条单测**（解析器 26 + 冲突 5），全量 **50 文件 / 641 测试全绿**；tsc / eslint 干净。
- 迁移已应用到 dev.db 与 e2e.db（表与列实测存在）；生产走既有构建期 schema 自动同步。
- 写测试时抓到我自己两个真问题：一是解释函数里那行 name 自引用（TDZ 直接抛错），
  二是一条写错的测试期望（规则集里有 DEFAULT，所以分类不匹配时应落到默认级，而不是「无规则」）。

## 尚未做

- **页面还没在真实浏览器里跑过**（本地 :3002 跑的是旧构建）——下一轮我会重建本地服务做视觉复核，
  这也是本项目定过的流程：测试全绿不等于页面对。
- P2 起步：CommissionLedger（只追加台账）+ 完工自动计提 + 幂等 + 对账报告。
- 老板可留意一个可见性选择：目前**技师与服务顾问也能看到这一页（只读）**，与结算页同一批人；
  若要收窄成只有 owner/manager 可见，是一行 access 的事。
