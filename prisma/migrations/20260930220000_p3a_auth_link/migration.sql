-- P3a：认证身份 → 业务身份的映射表（多租户身份模型的地基）。
--
-- 为什么需要它：User.authId / Customer.authId 是**全局唯一**的，于是
-- "同一个人在两家店各有一个客户档案"在数据模型上**根本表达不出来** ——
-- 而这正是"每个 workshop 独立、customer 不共用"要的语义。
--
-- 一个自然人 = 一个 Supabase auth 账号（邮箱/手机在项目内唯一，这是 Supabase 的现实），
-- 他在 N 家店就有 N 条 AuthLink、N 个业务主体（N 个 User 或 N 个 Customer）。
-- **跨店共享的是登录凭证，不是客户数据。**
--
-- 本迁移**纯加法**：只建一张新表，不改任何既有列 —— 所以生产上会随构建的
-- schema-sync 自动应用，不需要人工 DDL。既有行为一行都不变（还没有人读它）。
--
-- ScheduledMessage 少一个索引是**先前就存在**的漂移，与本轮无关，已剔除。
-- CreateTable
CREATE TABLE "AuthLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT,
    "customerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthLink_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
CREATE INDEX "AuthLink_authId_idx" ON "AuthLink"("authId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthLink_authId_organisationId_key" ON "AuthLink"("authId", "organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthLink_organisationId_kind_userId_key" ON "AuthLink"("organisationId", "kind", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthLink_organisationId_kind_customerId_key" ON "AuthLink"("organisationId", "kind", "customerId");

