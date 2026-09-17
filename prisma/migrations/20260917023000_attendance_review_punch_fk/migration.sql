-- 处置与打卡之间的外键：有它才问得出「哪些异常还没人处置」（reviews: { none: {} }），
-- 那是异常队列的定义。只存 punchId 字符串的话，问这个问题就得先把全部 id 拉回内存再 notIn。
-- SQLite 不支持给已有表加外键，所以这里按 Prisma 的标准做法重建该表（表在本分支刚建、数据为空，重建零风险）。

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AttendanceReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "punchId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reviewedBy" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceReview_punchId_fkey" FOREIGN KEY ("punchId") REFERENCES "AttendancePunch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AttendanceReview" ("createdAt", "decision", "id", "note", "punchId", "reviewedBy") SELECT "createdAt", "decision", "id", "note", "punchId", "reviewedBy" FROM "AttendanceReview";
DROP TABLE "AttendanceReview";
ALTER TABLE "new_AttendanceReview" RENAME TO "AttendanceReview";
CREATE INDEX "AttendanceReview_punchId_idx" ON "AttendanceReview"("punchId");
CREATE INDEX "AttendanceReview_reviewedBy_createdAt_idx" ON "AttendanceReview"("reviewedBy", "createdAt");
CREATE INDEX "AttendanceReview_createdAt_idx" ON "AttendanceReview"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
