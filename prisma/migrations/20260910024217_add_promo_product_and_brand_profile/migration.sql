-- CreateTable
CREATE TABLE "PromoProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "brand" TEXT,
    "category" TEXT,
    "series" TEXT,
    "volume" TEXT,
    "imageUrl" TEXT,
    "description" TEXT,
    "specs" JSONB,
    "sellingPoints" TEXT,
    "approvedCopy" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PromoProduct_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "voice" TEXT,
    "primaryLanguage" TEXT NOT NULL DEFAULT 'ms',
    "languages" TEXT,
    "audiences" TEXT,
    "dos" TEXT,
    "donts" TEXT,
    "samplePosts" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrandProfile_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PromoProduct_sku_key" ON "PromoProduct"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "BrandProfile_organisationId_key_key" ON "BrandProfile"("organisationId", "key");
