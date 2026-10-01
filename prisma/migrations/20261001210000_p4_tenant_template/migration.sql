-- CreateTable
CREATE TABLE "TenantTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "payload" TEXT NOT NULL,
    "sourceOrganisationId" TEXT,
    "createdByAuthId" TEXT NOT NULL,
    "createdByEmail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- NOTE: 照例剥掉 migrate diff 顺带生成的 ScheduledMessage 重建块（历史假象 + 含 DROP TABLE）。

-- CreateIndex
CREATE UNIQUE INDEX "TenantTemplate_key_key" ON "TenantTemplate"("key");

