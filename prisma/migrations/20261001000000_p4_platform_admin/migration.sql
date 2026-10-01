-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authId" TEXT NOT NULL,
    "email" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME
);

-- NOTE: `migrate diff` 每次都会顺带生成一段 ScheduledMessage 的重建块
-- （历史上改过迁移文件导致的假象）。它与本次改动无关，而且里面是 DROP TABLE —— 
-- 生产侧的 sync-prod-schema 会拒绝执行破坏性语句，所以这里按 P3b 第 2 步的做法剥掉。
-- 真正需要的只有下面这条新增表 + 唯一索引。

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_authId_key" ON "PlatformAdmin"("authId");

