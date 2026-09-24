-- 批量配置 P3：导入会话（手写，与 prisma/schema*.prisma 的 BulkImportSession 模型一致）
-- 为什么落库而不是只放浏览器：一次导入常有上百条要判，审到一半关掉页面不该全丢。
-- plans 是差异快照（每条自带旧值）；应用时拿旧值与当前库比对，不一致就拒绝那一行（不覆盖别人的修改）。
CREATE TABLE "BulkImportSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "declaredSheets" TEXT,
    "plans" JSONB,
    "decisions" JSONB,
    "appliedSummary" JSONB,
    "appliedAt" DATETIME
);

CREATE INDEX "BulkImportSession_organisationId_branchId_status_idx" ON "BulkImportSession"("organisationId", "branchId", "status");
CREATE INDEX "BulkImportSession_organisationId_uploadedAt_idx" ON "BulkImportSession"("organisationId", "uploadedAt");
