-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Organisation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "qrToken" TEXT,
    "name" TEXT NOT NULL,
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
    "enableMotorcycleQr" BOOLEAN NOT NULL DEFAULT true,
    "enableRiderProfileQr" BOOLEAN NOT NULL DEFAULT true,
    "enableWorkshopQr" BOOLEAN NOT NULL DEFAULT true,
    "promoAutoApply" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Organisation" ("address", "contactEmail", "contactPhone", "createdAt", "currency", "enableMotorcycleQr", "enableRiderProfileQr", "enableWorkshopQr", "id", "logo", "lostReasons", "name", "operatingHours", "qrToken", "salaryRules", "taxId", "timezone") SELECT "address", "contactEmail", "contactPhone", "createdAt", "currency", "enableMotorcycleQr", "enableRiderProfileQr", "enableWorkshopQr", "id", "logo", "lostReasons", "name", "operatingHours", "qrToken", "salaryRules", "taxId", "timezone" FROM "Organisation";
DROP TABLE "Organisation";
ALTER TABLE "new_Organisation" RENAME TO "Organisation";
CREATE UNIQUE INDEX "Organisation_qrToken_key" ON "Organisation"("qrToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
