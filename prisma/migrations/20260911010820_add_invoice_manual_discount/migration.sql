-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "Invoice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ServiceJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("branchId", "customerId", "discountSen", "id", "invoiceNumber", "issuedAt", "jobId", "paidAt", "status", "subtotalSen", "taxSen", "totalSen") SELECT "branchId", "customerId", "discountSen", "id", "invoiceNumber", "issuedAt", "jobId", "paidAt", "status", "subtotalSen", "taxSen", "totalSen" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_jobId_key" ON "Invoice"("jobId");
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
