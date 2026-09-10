-- AlterTable
ALTER TABLE "ContentScript" ADD COLUMN "expandedAt" DATETIME;
ALTER TABLE "ContentScript" ADD COLUMN "expandedJson" JSONB;
ALTER TABLE "ContentScript" ADD COLUMN "posterRenderedAt" DATETIME;
ALTER TABLE "ContentScript" ADD COLUMN "posterUrl" TEXT;
