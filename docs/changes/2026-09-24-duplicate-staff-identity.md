---
date: 2026-09-24
title: 同一个邮箱两条员工身份 —— 查明、合并、并防复发
branch: fix/duplicate-staff-identity
---

## 事故

生产里 mechanicdemo@gmail.com 有**两条 User 行**：

| 行 | authId | 名下工单 |
| --- | --- | --- |
| cmtif3h6… | **已绑定**（登录进来的就是它） | 1 张 |
| cmtidrki… | 未绑定 | 1 张（**DZ1216，WAITING、0 张照片**） |

后果：同一个技师的两张工单被拆到两个身份，**登录后只看得到其中一张** ——
很可能就是老板反馈「点了 accept order 之后还是 accept order」的一部分。

## 根因（三个，缺一不可）

1. scripts/provision-demo-branch.ts 的「按 email 幂等」用的是**大小写敏感**的精确匹配：
   库里存的是 MechanicDemo@gmail.com、脚本里写 mechanicdemo@gmail.com → 查不到 → **又建一行**。
2. createStaff（界面加员工）**根本没有查重** —— 只要有 email 就建新行。
3. 登录按 authId 匹配（唯一），而 **User.email 没有唯一约束** → 两条行能长期共存。

## 修了什么

| # | 动作 |
| --- | --- |
| 1 | **合并生产数据**：幽灵行名下 1 张工单改派到已绑定行 → 删除幽灵行 → 复验「20 个用户、0 组重复」 |
| 2 | **生产 PG 手工建唯一索引** User_email_key（顺序不能反：先建索引，才不会被构建期 db push 拒掉） |
| 3 | 两个 schema 都加 email @unique + 一条 sqlite 迁移（dev.db / e2e.db 都已应用） |
| 4 | createStaff **先查重**（忽略大小写）→ 已有档案就返回「这封邮件属于某某，去编辑他」 |
| 5 | 邮箱**小写存储**（归一化只在写入时做一次） |
| 6 | provision 脚本改用同一套忽略大小写的查重 |
| 7 | 新增 scripts/check-duplicate-staff.ts：默认只报告，加 --merge 才动数据（可反复跑） |

## 唯一约束立刻抓出的第二个 bug

加完约束后 tests/documents.test.ts 立刻变红 —— 夹具里 DocMgrA1 与 DocMgrA2
经过 replace(/[^a-z]/g, "")（**连数字也去掉**）生成**同一个邮箱** ✗。
以前它只是悄悄建出两行（正是生产问题的微缩版），现在被数据库拦住了 ✓。

## 测试

- 邮箱归一化：去空格 + 小写；空值一律 null
- **大小写不同也算同一个邮箱**（这正是事故成因）
- 合并时**保留已绑定登录的那一行**（哪怕它更晚创建）；都没绑定时留 active 的，再不行留最早的

全量 67 文件 / 819 测试通过；tsc / eslint 干净。
