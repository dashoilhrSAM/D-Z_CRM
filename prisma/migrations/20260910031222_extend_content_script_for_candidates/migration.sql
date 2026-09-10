-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ContentScript" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'TIKTOK',
    "hook" TEXT,
    "body" TEXT NOT NULL,
    "tone" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'MANUAL',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "batchId" TEXT,
    "angle" TEXT,
    "cta" TEXT,
    "language" TEXT,
    "brandKey" TEXT,
    "occasionKey" TEXT,
    "trendKey" TEXT,
    "includeProduct" BOOLEAN NOT NULL DEFAULT false,
    "productSku" TEXT,
    "score" INTEGER,
    "reasoning" TEXT,
    "generatedAt" DATETIME,
    CONSTRAINT "ContentScript_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ContentScript" ("body", "branchId", "createdAt", "hook", "id", "platform", "title", "tone") SELECT "body", "branchId", "createdAt", "hook", "id", "platform", "title", "tone" FROM "ContentScript";
DROP TABLE "ContentScript";
ALTER TABLE "new_ContentScript" RENAME TO "ContentScript";
CREATE INDEX "ContentScript_batchId_idx" ON "ContentScript"("batchId");
CREATE INDEX "ContentScript_status_idx" ON "ContentScript"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
