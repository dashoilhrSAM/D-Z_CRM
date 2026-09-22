-- CreateTable
CREATE TABLE "OtpAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phoneE164" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "ipHash" TEXT,
    "provider" TEXT,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "OtpAttempt_phoneE164_createdAt_idx" ON "OtpAttempt"("phoneE164", "createdAt");

-- CreateIndex
CREATE INDEX "OtpAttempt_ipHash_createdAt_idx" ON "OtpAttempt"("ipHash", "createdAt");
