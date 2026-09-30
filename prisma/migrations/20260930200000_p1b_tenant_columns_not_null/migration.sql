-- P1b：把四个模型的 organisationId 收紧为 NOT NULL。
--
-- 为什么现在才能做：P1a 只加了**可空**列（生产上是纯加法、能随构建自动上线），
-- 数据靠 scripts/backfill-tenant-columns.ts 回填。回填完成后（本地与生产均为 0 行 NULL），
-- 才可以把"必须有租户"变成数据库层面的硬约束。
--
-- 为什么值得做：复合唯一键在 SQLite/PostgreSQL 上**都不约束 organisationId 为 NULL 的行**。
-- 列可空时，任何一条漏写这一列的写入路径都会让该行**静默逃出唯一约束**。
-- 收紧为 NOT NULL 之后，那种行连插入都插不进来 —— 静态守卫之外再多一道数据库防线。
-- （静态守卫仍在：tests/tenant-isolation-guards.test.ts。）
--
-- ScheduledMessage 的漂移与本轮无关，已剔除（只切它自己那一段）。
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ChecklistTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branchId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ChecklistTemplate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ChecklistTemplate" ("branchId", "id", "isDefault", "name", "organisationId") SELECT "branchId", "id", "isDefault", "name", "organisationId" FROM "ChecklistTemplate";
DROP TABLE "ChecklistTemplate";
ALTER TABLE "new_ChecklistTemplate" RENAME TO "ChecklistTemplate";
CREATE INDEX "ChecklistTemplate_organisationId_idx" ON "ChecklistTemplate"("organisationId");
CREATE TABLE "new_Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "jobId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" DATETIME,
    "subtotalSen" INTEGER NOT NULL DEFAULT 0,
    "discountSen" INTEGER NOT NULL DEFAULT 0,
    "manualDiscountSen" INTEGER NOT NULL DEFAULT 0,
    "manualDiscountKind" TEXT,
    "manualDiscountValue" INTEGER,
    "manualDiscountReason" TEXT,
    "manualDiscountAt" DATETIME,
    "taxSen" INTEGER NOT NULL DEFAULT 0,
    "totalSen" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Invoice_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ServiceJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("branchId", "customerId", "discountSen", "id", "invoiceNumber", "issuedAt", "jobId", "manualDiscountAt", "manualDiscountKind", "manualDiscountReason", "manualDiscountSen", "manualDiscountValue", "organisationId", "paidAt", "status", "subtotalSen", "taxSen", "totalSen") SELECT "branchId", "customerId", "discountSen", "id", "invoiceNumber", "issuedAt", "jobId", "manualDiscountAt", "manualDiscountKind", "manualDiscountReason", "manualDiscountSen", "manualDiscountValue", "organisationId", "paidAt", "status", "subtotalSen", "taxSen", "totalSen" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_jobId_key" ON "Invoice"("jobId");
CREATE INDEX "Invoice_organisationId_idx" ON "Invoice"("organisationId");
CREATE UNIQUE INDEX "Invoice_organisationId_invoiceNumber_key" ON "Invoice"("organisationId", "invoiceNumber");
CREATE TABLE "new_Motorcycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "qrToken" TEXT,
    "customerId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "plate" TEXT NOT NULL,
    "vin" TEXT,
    "engineNo" TEXT,
    "color" TEXT,
    "type" TEXT NOT NULL DEFAULT 'UNDERBONE',
    "currentMileage" INTEGER NOT NULL DEFAULT 0,
    "purchaseDate" DATETIME,
    "warrantyExpiry" DATETIME,
    "warrantyKm" INTEGER,
    "notes" TEXT,
    "lastServiceDate" DATETIME,
    "lastServiceMileage" INTEGER,
    "lastOilChangeMileage" INTEGER,
    "lastOilFilterMileage" INTEGER,
    "nextServiceMileage" INTEGER,
    "nextServiceEstDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Motorcycle_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Motorcycle_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Motorcycle" ("brand", "color", "createdAt", "currentMileage", "customerId", "engineNo", "id", "lastOilChangeMileage", "lastOilFilterMileage", "lastServiceDate", "lastServiceMileage", "model", "nextServiceEstDate", "nextServiceMileage", "notes", "organisationId", "plate", "purchaseDate", "qrToken", "type", "vin", "warrantyExpiry", "warrantyKm", "year") SELECT "brand", "color", "createdAt", "currentMileage", "customerId", "engineNo", "id", "lastOilChangeMileage", "lastOilFilterMileage", "lastServiceDate", "lastServiceMileage", "model", "nextServiceEstDate", "nextServiceMileage", "notes", "organisationId", "plate", "purchaseDate", "qrToken", "type", "vin", "warrantyExpiry", "warrantyKm", "year" FROM "Motorcycle";
DROP TABLE "Motorcycle";
ALTER TABLE "new_Motorcycle" RENAME TO "Motorcycle";
CREATE UNIQUE INDEX "Motorcycle_qrToken_key" ON "Motorcycle"("qrToken");
CREATE INDEX "Motorcycle_organisationId_idx" ON "Motorcycle"("organisationId");
CREATE UNIQUE INDEX "Motorcycle_organisationId_plate_key" ON "Motorcycle"("organisationId", "plate");
CREATE TABLE "new_ServiceJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "jobNumber" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "motorcycleId" TEXT NOT NULL,
    "mechanicId" TEXT,
    "servicePackageId" TEXT,
    "packageName" TEXT,
    "mileage" INTEGER NOT NULL,
    "customerRequest" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "type" TEXT NOT NULL DEFAULT 'SERVICE',
    "estimatedCompletionAt" DATETIME,
    "startedAt" DATETIME,
    "readyAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "commissionSen" INTEGER,
    "bonusSen" INTEGER,
    CONSTRAINT "ServiceJob_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceJob_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceJob_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceJob_motorcycleId_fkey" FOREIGN KEY ("motorcycleId") REFERENCES "Motorcycle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceJob_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ServiceJob_servicePackageId_fkey" FOREIGN KEY ("servicePackageId") REFERENCES "ServicePackage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ServiceJob" ("bonusSen", "branchId", "commissionSen", "completedAt", "createdAt", "customerId", "customerRequest", "estimatedCompletionAt", "id", "jobNumber", "mechanicId", "mileage", "motorcycleId", "organisationId", "packageName", "readyAt", "servicePackageId", "startedAt", "status", "type", "updatedAt") SELECT "bonusSen", "branchId", "commissionSen", "completedAt", "createdAt", "customerId", "customerRequest", "estimatedCompletionAt", "id", "jobNumber", "mechanicId", "mileage", "motorcycleId", "organisationId", "packageName", "readyAt", "servicePackageId", "startedAt", "status", "type", "updatedAt" FROM "ServiceJob";
DROP TABLE "ServiceJob";
ALTER TABLE "new_ServiceJob" RENAME TO "ServiceJob";
CREATE INDEX "ServiceJob_organisationId_idx" ON "ServiceJob"("organisationId");
CREATE UNIQUE INDEX "ServiceJob_organisationId_jobNumber_key" ON "ServiceJob"("organisationId", "jobNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

