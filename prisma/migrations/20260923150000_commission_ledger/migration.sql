-- P2：佣金台账（只追加）。唯一键 (jobItemId, kind) 是幂等的核心：
-- 完工流程被重跑两次时，第二条在数据库层就插不进来，而不是靠代码自觉。
CREATE TABLE "CommissionLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "branchId" TEXT,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "jobItemId" TEXT,
    "invoiceId" TEXT,
    "kind" TEXT NOT NULL,
    "amountSen" INTEGER NOT NULL,
    "basis" TEXT NOT NULL,
    "baseSen" INTEGER NOT NULL DEFAULT 0,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "ruleId" TEXT,
    "ruleSnapshot" TEXT,
    "tierSetId" TEXT,
    "tierSnapshot" TEXT,
    "reason" TEXT,
    "actorUserId" TEXT,
    "reversalOfId" TEXT,
    "earnedAt" DATETIME NOT NULL,
    "windowKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "CommissionLedger_jobItemId_kind_key" ON "CommissionLedger"("jobItemId", "kind");
CREATE INDEX "CommissionLedger_organisationId_userId_windowKey_idx" ON "CommissionLedger"("organisationId", "userId", "windowKey");
CREATE INDEX "CommissionLedger_jobId_idx" ON "CommissionLedger"("jobId");
CREATE INDEX "CommissionLedger_invoiceId_idx" ON "CommissionLedger"("invoiceId");

-- 佣金基数口径开关（默认 false = 按客户实付，发票折扣按行分摊后）
ALTER TABLE "Organisation" ADD COLUMN "commissionOnGross" BOOLEAN NOT NULL DEFAULT false;
