-- 注意：prisma/migrations 是 **sqlite 方言**（生产 PG 由构建期 sync-prod-schema.mjs 同步）。
-- 我第一次写成了 PG 方言（TIMESTAMP(3)/JSONB），sqlite 照单全收但 Prisma 读不懂列类型 →
-- 报 "Conversion failed: Value TIMESTAMP(3) not supported"。教训：这里的迁移必须写 sqlite 类型。

-- ① 去重键独立成列（原先误存在 error 字段里）
ALTER TABLE "AutomationExecution" ADD COLUMN "dedupeKey" TEXT;
UPDATE "AutomationExecution" SET "dedupeKey" = "error" WHERE status = 'SUCCESS' AND "error" IS NOT NULL;
UPDATE "AutomationExecution" SET "error" = NULL WHERE status = 'SUCCESS';
CREATE INDEX "AutomationExecution_ruleId_trigger_dedupeKey_idx" ON "AutomationExecution"("ruleId", "trigger", "dedupeKey");

-- ② 延迟发送队列
CREATE TABLE "ScheduledMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "branchId" TEXT,
    "customerId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "vars" JSON,
    "sendAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "isMarketing" BOOLEAN NOT NULL DEFAULT false,
    "jobId" TEXT,
    "sourceRuleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME
);
CREATE INDEX "ScheduledMessage_status_sendAt_idx" ON "ScheduledMessage"("status", "sendAt");
