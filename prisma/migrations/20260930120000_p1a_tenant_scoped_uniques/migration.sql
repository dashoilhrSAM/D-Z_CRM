-- P1a：租户内唯一键 + 租户列（多租户隔离，第 1 期）
--
-- 这一份迁移解决"第二家 dealer 上线第一天就会撞"的四类冲突：
--   · Motorcycle.plate      全局唯一 → 同一台车不能被两家店服务
--   · ServiceJob.jobNumber  全局唯一 → 工单号串号，且能从号码读出别家业务量
--   · Invoice.invoiceNumber 全局唯一 → 发票号无法按店分系列（税务/合规）
--   · User.email            全局唯一 → 同一个人不能在两家店各有一个身份
--   · Product.sku / PromoProduct.sku / Lead.leadNumber / LoyaltyAccount.membershipId 同理
--
-- 三件事一起做：
--   ① 给 Motorcycle / ServiceJob / Invoice / ChecklistTemplate 补**可空** organisationId
--      （可空是为了让生产能走"加法变更自动上线"；回填后再收紧为 NOT NULL，见 P1b）
--   ② 全局唯一键 → @@unique([organisationId, <键>])
--   ③ Organisation 加运营字段 slug / status / plan / trialEndsAt
--
-- DDL 的数据安全性：**全局唯一严格强于租户内唯一**，所以"去掉全局键、换成复合键"
-- 不可能与既有数据冲突（任何满足前者的行集必然满足后者）。
--
-- ⚠️ 本文件里出现了 DROP INDEX / DROP TABLE（SQLite 表重建的固有形态）。
-- 生产走 scripts/sync-prod-schema.mjs 时会**被它的破坏性守卫拦下**（这是设计如此），
-- 需要人工审核后单独执行 —— 见 docs/changes/ 里本期的交接说明。
--
-- 顺带说明：`prisma migrate diff` 同时报出 ScheduledMessage 少一个索引，那是**先前就存在**的
-- 本地漂移（该表与本轮无关），已从本迁移中剔除。剔除时务必只切它自己那一段 ——
-- 第一版切多了，把紧随其后的 ServiceJob 表重建一起删掉，导致 ServiceJob.organisationId
-- 根本没建出来（迁移却记为已应用）；是 backfill 脚本第一步查列时把它抓出来的。
--
-- DropIndex
DROP INDEX "Lead_leadNumber_key";

-- DropIndex
DROP INDEX "LoyaltyAccount_membershipId_key";

-- DropIndex
DROP INDEX "Product_sku_key";

-- DropIndex
DROP INDEX "PromoProduct_sku_key";

-- DropIndex
DROP INDEX "User_email_key";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ChecklistTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT,
    "name" TEXT NOT NULL,
    "branchId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ChecklistTemplate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ChecklistTemplate" ("branchId", "id", "isDefault", "name") SELECT "branchId", "id", "isDefault", "name" FROM "ChecklistTemplate";
DROP TABLE "ChecklistTemplate";
ALTER TABLE "new_ChecklistTemplate" RENAME TO "ChecklistTemplate";
CREATE TABLE "new_Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT,
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
    CONSTRAINT "Invoice_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ServiceJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("branchId", "customerId", "discountSen", "id", "invoiceNumber", "issuedAt", "jobId", "manualDiscountAt", "manualDiscountKind", "manualDiscountReason", "manualDiscountSen", "manualDiscountValue", "paidAt", "status", "subtotalSen", "taxSen", "totalSen") SELECT "branchId", "customerId", "discountSen", "id", "invoiceNumber", "issuedAt", "jobId", "manualDiscountAt", "manualDiscountKind", "manualDiscountReason", "manualDiscountSen", "manualDiscountValue", "paidAt", "status", "subtotalSen", "taxSen", "totalSen" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_jobId_key" ON "Invoice"("jobId");
CREATE INDEX "Invoice_organisationId_idx" ON "Invoice"("organisationId");
CREATE UNIQUE INDEX "Invoice_organisationId_invoiceNumber_key" ON "Invoice"("organisationId", "invoiceNumber");
CREATE TABLE "new_Motorcycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT,
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
    CONSTRAINT "Motorcycle_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Motorcycle_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Motorcycle" ("brand", "color", "createdAt", "currentMileage", "customerId", "engineNo", "id", "lastOilChangeMileage", "lastOilFilterMileage", "lastServiceDate", "lastServiceMileage", "model", "nextServiceEstDate", "nextServiceMileage", "notes", "plate", "purchaseDate", "qrToken", "type", "vin", "warrantyExpiry", "warrantyKm", "year") SELECT "brand", "color", "createdAt", "currentMileage", "customerId", "engineNo", "id", "lastOilChangeMileage", "lastOilFilterMileage", "lastServiceDate", "lastServiceMileage", "model", "nextServiceEstDate", "nextServiceMileage", "notes", "plate", "purchaseDate", "qrToken", "type", "vin", "warrantyExpiry", "warrantyKm", "year" FROM "Motorcycle";
DROP TABLE "Motorcycle";
ALTER TABLE "new_Motorcycle" RENAME TO "Motorcycle";
CREATE UNIQUE INDEX "Motorcycle_qrToken_key" ON "Motorcycle"("qrToken");
CREATE INDEX "Motorcycle_organisationId_idx" ON "Motorcycle"("organisationId");
CREATE UNIQUE INDEX "Motorcycle_organisationId_plate_key" ON "Motorcycle"("organisationId", "plate");
CREATE TABLE "new_Organisation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "qrToken" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "plan" TEXT NOT NULL DEFAULT 'STANDARD',
    "trialEndsAt" DATETIME,
    "currency" TEXT NOT NULL DEFAULT 'MYR',
    "logo" TEXT,
    "address" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "taxId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
    "operatingHours" TEXT,
    "lostReasons" TEXT,
    "salaryRules" JSONB,
    "commissionOnGross" BOOLEAN NOT NULL DEFAULT false,
    "commissionOnParts" BOOLEAN NOT NULL DEFAULT true,
    "enableMotorcycleQr" BOOLEAN NOT NULL DEFAULT true,
    "enableRiderProfileQr" BOOLEAN NOT NULL DEFAULT true,
    "enableWorkshopQr" BOOLEAN NOT NULL DEFAULT true,
    "promoAutoApply" BOOLEAN NOT NULL DEFAULT true,
    "attendancePhotoRequired" BOOLEAN NOT NULL DEFAULT true,
    "attendanceGeoRequired" BOOLEAN NOT NULL DEFAULT true,
    "attendanceGeofenceM" INTEGER NOT NULL DEFAULT 150,
    "attendanceAccuracyMaxM" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Organisation" ("address", "attendanceAccuracyMaxM", "attendanceGeoRequired", "attendanceGeofenceM", "attendancePhotoRequired", "commissionOnGross", "commissionOnParts", "contactEmail", "contactPhone", "createdAt", "currency", "enableMotorcycleQr", "enableRiderProfileQr", "enableWorkshopQr", "id", "logo", "lostReasons", "name", "operatingHours", "promoAutoApply", "qrToken", "salaryRules", "taxId", "timezone") SELECT "address", "attendanceAccuracyMaxM", "attendanceGeoRequired", "attendanceGeofenceM", "attendancePhotoRequired", "commissionOnGross", "commissionOnParts", "contactEmail", "contactPhone", "createdAt", "currency", "enableMotorcycleQr", "enableRiderProfileQr", "enableWorkshopQr", "id", "logo", "lostReasons", "name", "operatingHours", "promoAutoApply", "qrToken", "salaryRules", "taxId", "timezone" FROM "Organisation";
DROP TABLE "Organisation";
ALTER TABLE "new_Organisation" RENAME TO "Organisation";
CREATE UNIQUE INDEX "Organisation_qrToken_key" ON "Organisation"("qrToken");
CREATE UNIQUE INDEX "Organisation_slug_key" ON "Organisation"("slug");
CREATE TABLE "new_ServiceJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT,
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
    CONSTRAINT "ServiceJob_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ServiceJob_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceJob_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceJob_motorcycleId_fkey" FOREIGN KEY ("motorcycleId") REFERENCES "Motorcycle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceJob_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ServiceJob_servicePackageId_fkey" FOREIGN KEY ("servicePackageId") REFERENCES "ServicePackage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ServiceJob" ("bonusSen", "branchId", "commissionSen", "completedAt", "createdAt", "customerId", "customerRequest", "estimatedCompletionAt", "id", "jobNumber", "mechanicId", "mileage", "motorcycleId", "packageName", "readyAt", "servicePackageId", "startedAt", "status", "type", "updatedAt") SELECT "bonusSen", "branchId", "commissionSen", "completedAt", "createdAt", "customerId", "customerRequest", "estimatedCompletionAt", "id", "jobNumber", "mechanicId", "mileage", "motorcycleId", "packageName", "readyAt", "servicePackageId", "startedAt", "status", "type", "updatedAt" FROM "ServiceJob";
DROP TABLE "ServiceJob";
ALTER TABLE "new_ServiceJob" RENAME TO "ServiceJob";
CREATE INDEX "ServiceJob_organisationId_idx" ON "ServiceJob"("organisationId");
CREATE UNIQUE INDEX "ServiceJob_organisationId_jobNumber_key" ON "ServiceJob"("organisationId", "jobNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Lead_organisationId_leadNumber_key" ON "Lead"("organisationId", "leadNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyAccount_organisationId_membershipId_key" ON "LoyaltyAccount"("organisationId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_organisationId_sku_key" ON "Product"("organisationId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "PromoProduct_organisationId_sku_key" ON "PromoProduct"("organisationId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "User_organisationId_email_key" ON "User"("organisationId", "email");

