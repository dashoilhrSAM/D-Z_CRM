-- P3：阶梯组合 / 档 / 领取记录。
-- 阶梯**不存"当前件数"计数器**：件数一律从台账推导，于是"重置任务漏跑就算错"这类事故在架构上不存在。
CREATE TABLE "CommissionTierSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "targetId" TEXT,
    "windowKind" TEXT NOT NULL DEFAULT 'MONTH',
    "countUnit" TEXT NOT NULL DEFAULT 'ITEM_QTY',
    "rewardKind" TEXT NOT NULL,
    "retroactive" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CommissionTierSet_organisationId_active_idx" ON "CommissionTierSet"("organisationId", "active");

CREATE TABLE "CommissionTier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tierSetId" TEXT NOT NULL,
    "thresholdQty" INTEGER NOT NULL,
    "rewardValue" INTEGER NOT NULL,
    "note" TEXT,
    CONSTRAINT "CommissionTier_tierSetId_fkey" FOREIGN KEY ("tierSetId") REFERENCES "CommissionTierSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CommissionTier_tierSetId_thresholdQty_key" ON "CommissionTier"("tierSetId", "thresholdQty");

-- 领取记录：可领取状态是**推导**出来的（件数达标且这里没有对应行），唯一键保证只能领一次。
CREATE TABLE "CommissionClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tierSetId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "claimedQty" INTEGER NOT NULL,
    "amountSen" INTEGER NOT NULL,
    "ledgerId" TEXT,
    "claimedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CommissionClaim_userId_tierId_windowKey_key" ON "CommissionClaim"("userId", "tierId", "windowKey");
CREATE INDEX "CommissionClaim_organisationId_userId_windowKey_idx" ON "CommissionClaim"("organisationId", "userId", "windowKey");

-- 台账加三列：件数按作用域统计需要知道"这一行是什么"（与 ruleSnapshot 同理：统计不回头 join 可能被改的工单行）
ALTER TABLE "CommissionLedger" ADD COLUMN "productId" TEXT;
ALTER TABLE "CommissionLedger" ADD COLUMN "serviceTypeId" TEXT;
ALTER TABLE "CommissionLedger" ADD COLUMN "category" TEXT;
