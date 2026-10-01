-- CreateTable
CREATE TABLE "SupportGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "grantedByAuthId" TEXT NOT NULL,
    "grantedByEmail" TEXT,
    "reason" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- NOTE: 照例剥掉 migrate diff 顺带生成的 ScheduledMessage 重建块（历史假象 + 含 DROP TABLE）。

-- CreateIndex
CREATE INDEX "SupportGrant_organisationId_createdAt_idx" ON "SupportGrant"("organisationId", "createdAt");

