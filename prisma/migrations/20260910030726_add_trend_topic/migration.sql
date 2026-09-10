-- CreateTable
CREATE TABLE "TrendTopic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT,
    "asOf" DATETIME NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "author" TEXT,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "durationSec" INTEGER,
    "language" TEXT,
    "summary" TEXT,
    "hookPattern" TEXT,
    "format" TEXT,
    "whyItWorks" TEXT,
    "borrowableAngles" TEXT,
    "relevance" INTEGER NOT NULL DEFAULT 3,
    "dedupeKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrendTopic_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TrendTopic_dedupeKey_key" ON "TrendTopic"("dedupeKey");

-- CreateIndex
CREATE INDEX "TrendTopic_asOf_idx" ON "TrendTopic"("asOf");

-- CreateIndex
CREATE INDEX "TrendTopic_source_idx" ON "TrendTopic"("source");
