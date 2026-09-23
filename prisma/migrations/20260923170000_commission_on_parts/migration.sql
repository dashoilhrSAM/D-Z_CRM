-- P4b：零件（ServiceJobPart）计佣 —— 由 workshop 在佣金配置页开关。
-- 台账加 jobPartId + 唯一键：零件行也要有和 (jobItemId, kind) 同等的幂等保证。
-- NULL 在唯一索引里互不相同，所以服务行（jobPartId 为 NULL）不会互相顶掉。
ALTER TABLE "CommissionLedger" ADD COLUMN "jobPartId" TEXT;
CREATE UNIQUE INDEX "CommissionLedger_jobPartId_kind_key" ON "CommissionLedger"("jobPartId", "kind");

-- 组织开关：默认开（老板口径「零件计佣」），workshop 可随时关掉（关掉后零件完全不计提）。
ALTER TABLE "Organisation" ADD COLUMN "commissionOnParts" BOOLEAN NOT NULL DEFAULT true;
