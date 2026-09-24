---
date: 2026-09-23
title: 批量配置 P3（上半）：导入会话 —— 审到一半可以关掉页面
branch: feat/bulk-sessions
---

## 现在最具体的那个痛点

**老板审批到一半，关掉页面就全没了。**

这不是小毛病：一次真实的批量录入常有几十上百条要判，没人会一口气审完。
而「决定只存在浏览器里」正是「把录入管起来」这半句话缺的东西。

这一期做的是**服务端那一半**（表结构 + 状态机 + 动作），界面接线与历史页在下一期。

## 状态机（只有三条边，别的转移不允许）

    DRAFT ──应用成功──> APPLIED
      └────取消────────> CANCELLED

**APPLIED / CANCELLED 都是终态**：应用过的会话不能再改决定 —— 否则历史就成了假的。
所以在数据层就用 updateMany 带 status DRAFT 的条件卡住，而不是只靠界面。

## 表设计（BulkImportSession）

| 字段 | 用途 |
| --- | --- |
| fileName / fileHash | 同一份文件反复上传，历史里认得出「这是同一份」 |
| declaredSheets | 文件声明包含哪些表 —— 没包含的是「这次不涉及」，不是空表 |
| **plans** | 差异快照（每条自带**旧值**）——「预览是否过期」就靠它比 |
| **decisions** | 每条的决定：批准 / 拒绝 / 就地修改过的原始值 |
| appliedSummary / appliedAt | 应用结果（逐 sheet 计数 + 被服务端拒绝的行） |

## 动作（全部过既有权限：PARTS:edit）

- resumeSetupImport() —— 打开页面自动接上「上次没审完的那一份」
- startSetupImport(file) —— 上传即建草稿（复用现有的解析 + 差异，安全规则一条不少）
- saveSetupDecisions() —— 存决定，**只在 DRAFT 允许**
- applySetupSession() —— 只写**已批准**的行 → 标记 APPLIED → **写审计**（谁批的、哪个文件、几条）
- cancelSetupSession() —— 什么都不写
- setupSessionHistory() —— 谁、什么时候、哪个文件、几条、批了多少

**「出错的行不能被批准」在服务端也挡了一次**（界面上按不了，但服务端才是边界）。
应用时仍走既有的两道把关：值复验 + 预览过期检测。

## 迁移

模型同时加进 prisma/schema.prisma 与 prisma/schema.pg.prisma；
sqlite 迁移 20260923210000_bulk_import_sessions 已 apply 到 **dev.db 与 e2e.db 两个库**
（少做一个会出现「页面 500 但构建正常」那类假象）。
pg schema 单独校验通过（本地 .env 是 sqlite URL，校验时要显式给 postgres 前缀的串，
否则会看到一个与本次改动无关的 P1012）。

## 验证

tsc / eslint 干净；全量 **64 文件 / 790 测试**通过（既有测试不受影响）。

## 下一期（P3 下半）

界面接线：审核台从会话读、决定实时存回去；显示「上次保存于 …」；
历史页（可下钻看逐条）+ 取消按钮 + 导出本次变更清单。
