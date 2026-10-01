-- CreateTable
CREATE TABLE "TenantTombstone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purgedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgedByAuthId" TEXT NOT NULL,
    "purgedByEmail" TEXT,
    "counts" TEXT
);

-- NOTE: 照例剥掉 migrate diff 顺带生成的 ScheduledMessage 重建块（历史假象 + 含 DROP TABLE）。

-- CreateIndex
CREATE UNIQUE INDEX "TenantTombstone_slug_key" ON "TenantTombstone"("slug");

