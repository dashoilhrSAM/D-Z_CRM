-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadNumber" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "branchId" TEXT,
    "sourceId" TEXT,
    "stageId" TEXT,
    "customerName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "motorcycleInterest" TEXT,
    "modelInterest" TEXT,
    "notes" TEXT,
    "estimatedValueSen" INTEGER,
    "assignedUserId" TEXT,
    "nextFollowUpAt" DATETIME,
    "tags" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "lostReason" TEXT,
    "convertedCustomerId" TEXT,
    "campaignId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lead_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Lead_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "LeadStage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_convertedCustomerId_fkey" FOREIGN KEY ("convertedCustomerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Lead" ("assignedUserId", "branchId", "convertedCustomerId", "createdAt", "customerName", "email", "estimatedValueSen", "id", "leadNumber", "lostReason", "modelInterest", "motorcycleInterest", "nextFollowUpAt", "notes", "organisationId", "phone", "sourceId", "stageId", "status", "tags", "updatedAt") SELECT "assignedUserId", "branchId", "convertedCustomerId", "createdAt", "customerName", "email", "estimatedValueSen", "id", "leadNumber", "lostReason", "modelInterest", "motorcycleInterest", "nextFollowUpAt", "notes", "organisationId", "phone", "sourceId", "stageId", "status", "tags", "updatedAt" FROM "Lead";
DROP TABLE "Lead";
ALTER TABLE "new_Lead" RENAME TO "Lead";
CREATE UNIQUE INDEX "Lead_leadNumber_key" ON "Lead"("leadNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
