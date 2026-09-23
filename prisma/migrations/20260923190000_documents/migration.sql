-- 文档通路 P0：文档表（手写，与 prisma/schema*.prisma 的 Document 模型一致）
-- 只存 storageKey（私有对象键），绝不存 URL —— 读取必须经 /api/documents/[id]/file 鉴权。
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "branchId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "customerId" TEXT,
    "motorcycleId" TEXT,
    "leadId" TEXT,
    "bookingId" TEXT,
    "jobId" TEXT,
    "invoiceId" TEXT,
    "purchaseOrderId" TEXT,
    "supplierId" TEXT,
    "uploadedById" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT,
    "verifiedAt" DATETIME,
    "verifyNote" TEXT,
    "retainUntil" DATETIME,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "Document_organisationId_branchId_status_idx" ON "Document"("organisationId", "branchId", "status");
CREATE INDEX "Document_customerId_idx" ON "Document"("customerId");
CREATE INDEX "Document_jobId_idx" ON "Document"("jobId");
CREATE INDEX "Document_invoiceId_idx" ON "Document"("invoiceId");
CREATE INDEX "Document_retainUntil_idx" ON "Document"("retainUntil");