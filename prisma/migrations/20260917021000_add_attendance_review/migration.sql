-- CreateTable
CREATE TABLE "AttendanceReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "punchId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reviewedBy" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AttendanceReview_punchId_idx" ON "AttendanceReview"("punchId");

-- CreateIndex
CREATE INDEX "AttendanceReview_reviewedBy_createdAt_idx" ON "AttendanceReview"("reviewedBy", "createdAt");

-- CreateIndex
CREATE INDEX "AttendanceReview_createdAt_idx" ON "AttendanceReview"("createdAt");
