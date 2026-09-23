-- P0：让工单行带上"目录身份"——佣金按 SKU / 服务 / 套餐配置的前提。
--
-- 三个列都有意可空：历史行与柜台自由文本行必须能存下来。未链接的行在佣金侧按 LEGACY
-- 处理，并出现在"无法归因"报告里（不假装准确）。
--
-- 为什么"套餐"也要一列：工单里最大的一笔钱通常不是某个 SKU 行，而是套餐行
-- （如 Standard Service RM120），它不对应任何 Product/ServiceType。
ALTER TABLE "ServiceJobItem" ADD COLUMN "productId" TEXT REFERENCES "Product"("id");
ALTER TABLE "ServiceJobItem" ADD COLUMN "serviceTypeId" TEXT REFERENCES "ServiceType"("id");
ALTER TABLE "ServiceJobItem" ADD COLUMN "packageId" TEXT REFERENCES "ServicePackage"("id");

CREATE INDEX "ServiceJobItem_productId_idx" ON "ServiceJobItem"("productId");
CREATE INDEX "ServiceJobItem_serviceTypeId_idx" ON "ServiceJobItem"("serviceTypeId");
CREATE INDEX "ServiceJobItem_packageId_idx" ON "ServiceJobItem"("packageId");
