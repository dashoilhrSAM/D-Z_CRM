-- CreateTable
CREATE TABLE "Occasion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "nameZh" TEXT,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "type" TEXT NOT NULL,
    "relevance" INTEGER NOT NULL DEFAULT 3,
    "leadDays" INTEGER NOT NULL DEFAULT 7,
    "angleHint" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Occasion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Occasion_key_key" ON "Occasion"("key");

-- CreateIndex
CREATE INDEX "Occasion_startDate_idx" ON "Occasion"("startDate");

-- CreateIndex
CREATE INDEX "Occasion_type_idx" ON "Occasion"("type");
