-- P1b：补齐三处缺失的租户关系 + 删掉冗余索引。
--
-- 为什么是"补关系"而不是"再加三个 organisationId 列"：
--   这三张表（ServicePackage / Attendance / AttendanceCorrection）此前只有**裸标量外键**
--   （branchId / punchId）而**没有声明关系**，于是它们根本无法按租户收窄 ——
--   不是"少了个字段"，是"没有可达路径"。补上关系后租户作用域地图
--   （src/lib/tenant/scope-map.ts）就能给出精确路径，P2 的强制层按关系收窄即可，
--   不需要给 40 张表盲目铺 NULL 列 —— 复合唯一键不约束 NULL 行，
--   铺了没人写的列反而制造"看着隔离了"的假象。
--
-- 另外删掉 InvoiceCounter_organisationId_idx：主键已经是 [organisationId, year]，
--   org 前缀查询已被主键索引覆盖，这个索引纯冗余（schema 里本来也没声明它）。
--
-- ScheduledMessage 少一个索引是**先前就存在**的漂移，与本轮无关，已剔除
--   （只切它自己那一段 —— P1a 第一版切多了，把紧随其后的表重建一起删掉过）。
-- DropIndex
DROP INDEX "InvoiceCounter_organisationId_idx";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Attendance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "checkInAt" DATETIME,
    "checkOutAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "branchId" TEXT,
    "firstInAt" DATETIME,
    "lastOutAt" DATETIME,
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "exceptionCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    CONSTRAINT "Attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Attendance_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Attendance" ("branchId", "checkInAt", "checkOutAt", "createdAt", "date", "exceptionCount", "firstInAt", "id", "lastOutAt", "status", "userId", "workedMinutes") SELECT "branchId", "checkInAt", "checkOutAt", "createdAt", "date", "exceptionCount", "firstInAt", "id", "lastOutAt", "status", "userId", "workedMinutes" FROM "Attendance";
DROP TABLE "Attendance";
ALTER TABLE "new_Attendance" RENAME TO "Attendance";
CREATE INDEX "Attendance_branchId_date_idx" ON "Attendance"("branchId", "date");
CREATE UNIQUE INDEX "Attendance_userId_date_key" ON "Attendance"("userId", "date");
CREATE TABLE "new_AttendanceCorrection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "punchId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "beforeJson" TEXT NOT NULL,
    "afterJson" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceCorrection_punchId_fkey" FOREIGN KEY ("punchId") REFERENCES "AttendancePunch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AttendanceCorrection" ("afterJson", "approvedAt", "approvedBy", "beforeJson", "createdAt", "id", "punchId", "reason", "requestedBy") SELECT "afterJson", "approvedAt", "approvedBy", "beforeJson", "createdAt", "id", "punchId", "reason", "requestedBy" FROM "AttendanceCorrection";
DROP TABLE "AttendanceCorrection";
ALTER TABLE "new_AttendanceCorrection" RENAME TO "AttendanceCorrection";
CREATE INDEX "AttendanceCorrection_punchId_idx" ON "AttendanceCorrection"("punchId");
CREATE TABLE "new_ServicePackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "priceSen" INTEGER NOT NULL,
    "description" TEXT,
    "isBestValue" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ServicePackage_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ServicePackage" ("active", "branchId", "description", "id", "isBestValue", "name", "priceSen", "tier") SELECT "active", "branchId", "description", "id", "isBestValue", "name", "priceSen", "tier" FROM "ServicePackage";
DROP TABLE "ServicePackage";
ALTER TABLE "new_ServicePackage" RENAME TO "ServicePackage";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

