-- P3b 第 2 步：authId 从全局唯一降为**租户内唯一**。
--
-- 为什么必须松：同一个自然人（一个 Supabase auth 账号）要在两家店各有一个业务身份 ——
-- 这是"每个 workshop 独立、customer 不共用"的前提。全局唯一键让它表达不出来。
-- 松掉之后"一人一店一条"由 AuthLink 的 @@unique([authId, organisationId]) 守。
--
-- 安全性：唯一索引的 NULL 不参与约束（SQLite/PG 都一样），所以"还没有登录"的档案
-- 可以有任意多条 —— 与改造前一致。顺序上这是**放宽**约束，不是收紧：不写这一列的老代码
-- 照常跑，没有"哪一段时间生产会写失败"的窗口。
--
-- 生产侧：DROP INDEX 会被 scripts/sync-prod-schema.mjs 判为破坏性 DDL 而拒绝自动执行，
-- 必须人工带备份执行（见 docs/changes/2026-09-30-p3b-tenant-scoped-authid.md 的 runbook）。

-- DropIndex
DROP INDEX "Customer_authId_key";

-- DropIndex
DROP INDEX "User_authId_key";

-- CreateIndex
CREATE INDEX "Customer_organisationId_phone_idx" ON "Customer"("organisationId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organisationId_authId_key" ON "Customer"("organisationId", "authId");

-- CreateIndex
CREATE UNIQUE INDEX "User_organisationId_authId_key" ON "User"("organisationId", "authId");
