-- AlterTable
ALTER TABLE "Branch" ADD COLUMN "latitude" REAL;
ALTER TABLE "Branch" ADD COLUMN "longitude" REAL;

-- CreateTable
CREATE TABLE "AttendancePunch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "branchId" TEXT,
    "kind" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    "businessDate" DATETIME NOT NULL,
    "photoKey" TEXT NOT NULL,
    "photoSha256" TEXT NOT NULL,
    "photoMime" TEXT NOT NULL,
    "photoBytes" INTEGER NOT NULL,
    "lat" REAL,
    "lng" REAL,
    "accuracyM" REAL,
    "distanceM" REAL,
    "source" TEXT NOT NULL DEFAULT 'WEB',
    "deviceId" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "verdict" TEXT NOT NULL DEFAULT 'OK',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendancePunch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AttendanceCorrection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "punchId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "beforeJson" TEXT NOT NULL,
    "afterJson" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
    CONSTRAINT "Attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Attendance" ("checkInAt", "checkOutAt", "createdAt", "date", "id", "userId") SELECT "checkInAt", "checkOutAt", "createdAt", "date", "id", "userId" FROM "Attendance";
DROP TABLE "Attendance";
ALTER TABLE "new_Attendance" RENAME TO "Attendance";
CREATE INDEX "Attendance_branchId_date_idx" ON "Attendance"("branchId", "date");
CREATE UNIQUE INDEX "Attendance_userId_date_key" ON "Attendance"("userId", "date");
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
    "attendancePhotoRequired" BOOLEAN NOT NULL DEFAULT true,
    "attendanceGeoRequired" BOOLEAN NOT NULL DEFAULT true,
    "attendanceGeofenceM" INTEGER NOT NULL DEFAULT 150,
    "attendanceAccuracyMaxM" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Organisation" ("address", "contactEmail", "contactPhone", "createdAt", "currency", "enableMotorcycleQr", "enableRiderProfileQr", "enableWorkshopQr", "id", "logo", "lostReasons", "name", "operatingHours", "promoAutoApply", "qrToken", "salaryRules", "taxId", "timezone") SELECT "address", "contactEmail", "contactPhone", "createdAt", "currency", "enableMotorcycleQr", "enableRiderProfileQr", "enableWorkshopQr", "id", "logo", "lostReasons", "name", "operatingHours", "promoAutoApply", "qrToken", "salaryRules", "taxId", "timezone" FROM "Organisation";
DROP TABLE "Organisation";
ALTER TABLE "new_Organisation" RENAME TO "Organisation";
CREATE UNIQUE INDEX "Organisation_qrToken_key" ON "Organisation"("qrToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AttendancePunch_userId_businessDate_idx" ON "AttendancePunch"("userId", "businessDate");

-- CreateIndex
CREATE INDEX "AttendancePunch_branchId_businessDate_idx" ON "AttendancePunch"("branchId", "businessDate");

-- CreateIndex
CREATE INDEX "AttendancePunch_photoSha256_idx" ON "AttendancePunch"("photoSha256");

-- CreateIndex
CREATE INDEX "AttendanceCorrection_punchId_idx" ON "AttendanceCorrection"("punchId");
