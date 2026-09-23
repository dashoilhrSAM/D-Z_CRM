-- P1：佣金规则表。一条规则 = 一个作用域 + 一种算法（basis 是枚举，所以"百分比与固定额同时设置"
-- 在数据层无法表达 —— 这是刻意的，金额算错是会计事故）。
--
-- targetKey 是查找键不是外键：PRODUCT/SERVICE/PACKAGE 存行的 id，CATEGORY 存分类名，DEFAULT 为 null。
CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "targetKey" TEXT,
    "basis" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "valuePercent" INTEGER,
    "valueFixedSen" INTEGER,
    "effectiveFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" DATETIME,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CommissionRule_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CommissionRule_organisationId_scope_active_idx" ON "CommissionRule"("organisationId", "scope", "active");
CREATE INDEX "CommissionRule_organisationId_scope_targetKey_idx" ON "CommissionRule"("organisationId", "scope", "targetKey");
