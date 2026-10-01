-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorAuthId" TEXT NOT NULL,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "targetOrganisationId" TEXT,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- NOTE: 照例剥掉 migrate diff 顺带生成的 ScheduledMessage 重建块
--（历史假象：早期改过迁移文件；而且里面是 DROP TABLE，生产侧会拒绝执行）。

-- CreateIndex
CREATE INDEX "PlatformAuditLog_targetOrganisationId_createdAt_idx" ON "PlatformAuditLog"("targetOrganisationId", "createdAt");

