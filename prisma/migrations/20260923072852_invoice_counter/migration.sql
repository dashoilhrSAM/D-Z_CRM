-- CreateTable
CREATE TABLE "InvoiceCounter" (
    "year" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "value" INTEGER NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ServiceJobItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SERVICE',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceSen" INTEGER NOT NULL,
    "lineTotalSen" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INCLUDED',
    "source" TEXT NOT NULL DEFAULT 'PACKAGE',
    "productId" TEXT,
    "serviceTypeId" TEXT,
    "packageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceJobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ServiceJob" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceJobItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ServiceJobItem_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ServiceJobItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ServicePackage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ServiceJobItem" ("createdAt", "description", "id", "jobId", "kind", "lineTotalSen", "packageId", "productId", "quantity", "serviceTypeId", "source", "status", "unitPriceSen") SELECT "createdAt", "description", "id", "jobId", "kind", "lineTotalSen", "packageId", "productId", "quantity", "serviceTypeId", "source", "status", "unitPriceSen" FROM "ServiceJobItem";
DROP TABLE "ServiceJobItem";
ALTER TABLE "new_ServiceJobItem" RENAME TO "ServiceJobItem";
CREATE INDEX "ServiceJobItem_productId_idx" ON "ServiceJobItem"("productId");
CREATE INDEX "ServiceJobItem_serviceTypeId_idx" ON "ServiceJobItem"("serviceTypeId");
CREATE INDEX "ServiceJobItem_packageId_idx" ON "ServiceJobItem"("packageId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
