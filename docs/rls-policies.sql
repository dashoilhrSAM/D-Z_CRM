-- D&Z Platform — RLS 策略（Supabase）
-- 生成：scripts/gen-rls-policies.ts · 身份来源 request.jwt.claims
-- 可重复执行：所有策略 DROP IF EXISTS

-- ============ helper 函数 ============
-- 2026-09-30（P0）只认 app_metadata：user_metadata **登录用户自己就能改**
-- （supabase.auth.updateUser({ data }) 正是往那里写），而策略把里面的 orgId 当租户身份用 ——
-- 于是任何登录用户都能把自己的 orgId 改成别家，然后读到别家的行。
-- app_metadata 只有 service role 能写，用户改不了。**刻意不回退到 user_metadata**：
-- 留回退等于没修（攻击者不用 app_metadata 就是了）。代价是 PostgREST 面在 P3 把
-- injectBizClaims 改写到 app_metadata 之前会一律拒绝 —— 应用不走 PostgREST，零影响；
-- 宁可 fail-closed，也不要可伪造的租户身份。
CREATE OR REPLACE FUNCTION app_jwt_claim(name text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb->'app_metadata'->>name, ''), NULLIF(current_setting('request.jwt.claims', true)::jsonb->>name, ''), '') $$;
CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT app_jwt_claim('orgId') $$;
CREATE OR REPLACE FUNCTION app_current_branch_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT app_jwt_claim('branchId') $$;
CREATE OR REPLACE FUNCTION app_current_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT app_jwt_claim('role') $$;
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT app_jwt_claim('userId') $$;
CREATE OR REPLACE FUNCTION app_current_customer_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT app_jwt_claim('customerId') $$;
CREATE OR REPLACE FUNCTION app_is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT app_current_org_id() <> '' AND app_current_role() IN ('SUPER_ADMIN','OWNER','HEAD_OFFICE_ADMIN') $$;
CREATE OR REPLACE FUNCTION app_is_staff() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT app_current_org_id() <> '' AND app_current_role() NOT IN ('', 'CUSTOMER') $$;

-- ============ 表策略 ============
-- Organisation
ALTER TABLE "Organisation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_organisation ON "Organisation";
CREATE POLICY tenant_isolation_organisation ON "Organisation" FOR ALL USING (("Organisation"."id" = app_current_org_id())) WITH CHECK (("Organisation"."id" = app_current_org_id()));

-- Branch
ALTER TABLE "Branch" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_branch ON "Branch";
CREATE POLICY tenant_isolation_branch ON "Branch" FOR ALL USING (("Branch"."organisationId" = app_current_org_id())) WITH CHECK (("Branch"."organisationId" = app_current_org_id()));

-- User
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_user ON "User";
CREATE POLICY tenant_isolation_user ON "User" FOR ALL USING (("User"."organisationId" = app_current_org_id() AND (app_is_admin() OR "User"."branchId" IS NULL OR "User"."branchId" = app_current_branch_id()))) WITH CHECK (("User"."organisationId" = app_current_org_id() AND (app_is_admin() OR "User"."branchId" IS NULL OR "User"."branchId" = app_current_branch_id())));

-- Customer
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_customer ON "Customer";
CREATE POLICY tenant_isolation_customer ON "Customer" FOR ALL USING (("Customer"."organisationId" = app_current_org_id() AND (app_is_admin() OR "Customer"."branchId" IS NULL OR "Customer"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "Customer"."id" = app_current_customer_id()))) WITH CHECK (("Customer"."organisationId" = app_current_org_id() AND (app_is_admin() OR "Customer"."branchId" IS NULL OR "Customer"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "Customer"."id" = app_current_customer_id())));

-- CustomerAuthProfile
ALTER TABLE "CustomerAuthProfile" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_customerauthprofile ON "CustomerAuthProfile";
CREATE POLICY tenant_isolation_customerauthprofile ON "CustomerAuthProfile" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Customer" ON "Customer"."organisationId" = o."id" WHERE "CustomerAuthProfile"."customerId" = "Customer"."id") AND (app_is_staff() OR "CustomerAuthProfile"."customerId" = app_current_customer_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Customer" ON "Customer"."organisationId" = o."id" WHERE "CustomerAuthProfile"."customerId" = "Customer"."id") AND (app_is_staff() OR "CustomerAuthProfile"."customerId" = app_current_customer_id())));

-- Motorcycle
ALTER TABLE "Motorcycle" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_motorcycle ON "Motorcycle";
CREATE POLICY tenant_isolation_motorcycle ON "Motorcycle" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Customer" ON "Customer"."organisationId" = o."id" WHERE "Motorcycle"."customerId" = "Customer"."id") AND (app_is_staff() OR "Motorcycle"."customerId" = app_current_customer_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Customer" ON "Customer"."organisationId" = o."id" WHERE "Motorcycle"."customerId" = "Customer"."id") AND (app_is_staff() OR "Motorcycle"."customerId" = app_current_customer_id())));

-- Booking
ALTER TABLE "Booking" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_booking ON "Booking";
CREATE POLICY tenant_isolation_booking ON "Booking" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "Booking"."branchId" = "Branch"."id") AND (app_is_admin() OR "Booking"."branchId" IS NULL OR "Booking"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "Booking"."customerId" = app_current_customer_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "Booking"."branchId" = "Branch"."id") AND (app_is_admin() OR "Booking"."branchId" IS NULL OR "Booking"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "Booking"."customerId" = app_current_customer_id())));

-- ServiceJob
ALTER TABLE "ServiceJob" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_servicejob ON "ServiceJob";
CREATE POLICY tenant_isolation_servicejob ON "ServiceJob" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "ServiceJob"."branchId" = "Branch"."id") AND (app_is_admin() OR "ServiceJob"."branchId" IS NULL OR "ServiceJob"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "ServiceJob"."customerId" = app_current_customer_id()) AND (NOT (app_current_role() = 'MECHANIC') OR "ServiceJob"."mechanicId" = app_current_user_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "ServiceJob"."branchId" = "Branch"."id") AND (app_is_admin() OR "ServiceJob"."branchId" IS NULL OR "ServiceJob"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "ServiceJob"."customerId" = app_current_customer_id()) AND (NOT (app_current_role() = 'MECHANIC') OR "ServiceJob"."mechanicId" = app_current_user_id())));

-- ServiceJobItem
ALTER TABLE "ServiceJobItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_servicejobitem ON "ServiceJobItem";
CREATE POLICY tenant_isolation_servicejobitem ON "ServiceJobItem" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" JOIN "ServiceJob" ON "ServiceJob"."branchId" = "Branch"."id" WHERE "ServiceJobItem"."jobId" = "ServiceJob"."id"))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" JOIN "ServiceJob" ON "ServiceJob"."branchId" = "Branch"."id" WHERE "ServiceJobItem"."jobId" = "ServiceJob"."id")));

-- ServiceJobPart
ALTER TABLE "ServiceJobPart" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_servicejobpart ON "ServiceJobPart";
CREATE POLICY tenant_isolation_servicejobpart ON "ServiceJobPart" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Product" ON "Product"."organisationId" = o."id" WHERE "ServiceJobPart"."productId" = "Product"."id"))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Product" ON "Product"."organisationId" = o."id" WHERE "ServiceJobPart"."productId" = "Product"."id")));

-- ChecklistTemplate
ALTER TABLE "ChecklistTemplate" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_checklisttemplate ON "ChecklistTemplate";
CREATE POLICY tenant_isolation_checklisttemplate ON "ChecklistTemplate" FOR ALL USING ((true AND (app_is_admin() OR "ChecklistTemplate"."branchId" IS NULL OR "ChecklistTemplate"."branchId" = app_current_branch_id()))) WITH CHECK ((true AND (app_is_admin() OR "ChecklistTemplate"."branchId" IS NULL OR "ChecklistTemplate"."branchId" = app_current_branch_id())));

-- ChecklistItem
ALTER TABLE "ChecklistItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_checklistitem ON "ChecklistItem";
CREATE POLICY tenant_isolation_checklistitem ON "ChecklistItem" FOR ALL USING ((true)) WITH CHECK ((true));

-- ChecklistExecution
ALTER TABLE "ChecklistExecution" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_checklistexecution ON "ChecklistExecution";
CREATE POLICY tenant_isolation_checklistexecution ON "ChecklistExecution" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" JOIN "ServiceJob" ON "ServiceJob"."branchId" = "Branch"."id" WHERE "ChecklistExecution"."jobId" = "ServiceJob"."id"))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" JOIN "ServiceJob" ON "ServiceJob"."branchId" = "Branch"."id" WHERE "ChecklistExecution"."jobId" = "ServiceJob"."id")));

-- ChecklistExecutionItem
ALTER TABLE "ChecklistExecutionItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_checklistexecutionitem ON "ChecklistExecutionItem";
CREATE POLICY tenant_isolation_checklistexecutionitem ON "ChecklistExecutionItem" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" JOIN "ServiceJob" ON "ServiceJob"."branchId" = "Branch"."id" JOIN "ChecklistExecution" ON "ChecklistExecution"."jobId" = "ServiceJob"."id" WHERE "ChecklistExecutionItem"."executionId" = "ChecklistExecution"."id"))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" JOIN "ServiceJob" ON "ServiceJob"."branchId" = "Branch"."id" JOIN "ChecklistExecution" ON "ChecklistExecution"."jobId" = "ServiceJob"."id" WHERE "ChecklistExecutionItem"."executionId" = "ChecklistExecution"."id")));

-- InspectionFinding
ALTER TABLE "InspectionFinding" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_inspectionfinding ON "InspectionFinding";
CREATE POLICY tenant_isolation_inspectionfinding ON "InspectionFinding" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" JOIN "ServiceJob" ON "ServiceJob"."branchId" = "Branch"."id" WHERE "InspectionFinding"."jobId" = "ServiceJob"."id"))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" JOIN "ServiceJob" ON "ServiceJob"."branchId" = "Branch"."id" WHERE "InspectionFinding"."jobId" = "ServiceJob"."id")));

-- CustomerApproval
ALTER TABLE "CustomerApproval" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_customerapproval ON "CustomerApproval";
CREATE POLICY tenant_isolation_customerapproval ON "CustomerApproval" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" JOIN "ServiceJob" ON "ServiceJob"."branchId" = "Branch"."id" WHERE "CustomerApproval"."jobId" = "ServiceJob"."id"))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" JOIN "ServiceJob" ON "ServiceJob"."branchId" = "Branch"."id" WHERE "CustomerApproval"."jobId" = "ServiceJob"."id")));

-- ServicePackage
ALTER TABLE "ServicePackage" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_servicepackage ON "ServicePackage";
CREATE POLICY tenant_isolation_servicepackage ON "ServicePackage" FOR ALL USING ((true AND (app_is_admin() OR "ServicePackage"."branchId" IS NULL OR "ServicePackage"."branchId" = app_current_branch_id()))) WITH CHECK ((true AND (app_is_admin() OR "ServicePackage"."branchId" IS NULL OR "ServicePackage"."branchId" = app_current_branch_id())));

-- ServicePackageItem
ALTER TABLE "ServicePackageItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_servicepackageitem ON "ServicePackageItem";
CREATE POLICY tenant_isolation_servicepackageitem ON "ServicePackageItem" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Product" ON "Product"."organisationId" = o."id" WHERE "ServicePackageItem"."productId" = "Product"."id"))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Product" ON "Product"."organisationId" = o."id" WHERE "ServicePackageItem"."productId" = "Product"."id")));

-- Product
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_product ON "Product";
CREATE POLICY tenant_isolation_product ON "Product" FOR ALL USING (("Product"."organisationId" = app_current_org_id())) WITH CHECK (("Product"."organisationId" = app_current_org_id()));

-- Inventory
ALTER TABLE "Inventory" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_inventory ON "Inventory";
CREATE POLICY tenant_isolation_inventory ON "Inventory" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "Inventory"."branchId" = "Branch"."id") AND (app_is_admin() OR "Inventory"."branchId" IS NULL OR "Inventory"."branchId" = app_current_branch_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "Inventory"."branchId" = "Branch"."id") AND (app_is_admin() OR "Inventory"."branchId" IS NULL OR "Inventory"."branchId" = app_current_branch_id())));

-- StockMovement
ALTER TABLE "StockMovement" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_stockmovement ON "StockMovement";
CREATE POLICY tenant_isolation_stockmovement ON "StockMovement" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "StockMovement"."branchId" = "Branch"."id") AND (app_is_admin() OR "StockMovement"."branchId" IS NULL OR "StockMovement"."branchId" = app_current_branch_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "StockMovement"."branchId" = "Branch"."id") AND (app_is_admin() OR "StockMovement"."branchId" IS NULL OR "StockMovement"."branchId" = app_current_branch_id())));

-- Supplier
ALTER TABLE "Supplier" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_supplier ON "Supplier";
CREATE POLICY tenant_isolation_supplier ON "Supplier" FOR ALL USING (("Supplier"."organisationId" = app_current_org_id())) WITH CHECK (("Supplier"."organisationId" = app_current_org_id()));

-- PurchaseOrder
ALTER TABLE "PurchaseOrder" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_purchaseorder ON "PurchaseOrder";
CREATE POLICY tenant_isolation_purchaseorder ON "PurchaseOrder" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "PurchaseOrder"."branchId" = "Branch"."id") AND (app_is_admin() OR "PurchaseOrder"."branchId" IS NULL OR "PurchaseOrder"."branchId" = app_current_branch_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "PurchaseOrder"."branchId" = "Branch"."id") AND (app_is_admin() OR "PurchaseOrder"."branchId" IS NULL OR "PurchaseOrder"."branchId" = app_current_branch_id())));

-- PurchaseOrderItem
ALTER TABLE "PurchaseOrderItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_purchaseorderitem ON "PurchaseOrderItem";
CREATE POLICY tenant_isolation_purchaseorderitem ON "PurchaseOrderItem" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Product" ON "Product"."organisationId" = o."id" WHERE "PurchaseOrderItem"."productId" = "Product"."id"))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Product" ON "Product"."organisationId" = o."id" WHERE "PurchaseOrderItem"."productId" = "Product"."id")));

-- Invoice
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_invoice ON "Invoice";
CREATE POLICY tenant_isolation_invoice ON "Invoice" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "Invoice"."branchId" = "Branch"."id") AND (app_is_admin() OR "Invoice"."branchId" IS NULL OR "Invoice"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "Invoice"."customerId" = app_current_customer_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "Invoice"."branchId" = "Branch"."id") AND (app_is_admin() OR "Invoice"."branchId" IS NULL OR "Invoice"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "Invoice"."customerId" = app_current_customer_id())));

-- InvoiceItem
ALTER TABLE "InvoiceItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_invoiceitem ON "InvoiceItem";
CREATE POLICY tenant_isolation_invoiceitem ON "InvoiceItem" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" JOIN "Invoice" ON "Invoice"."branchId" = "Branch"."id" WHERE "InvoiceItem"."invoiceId" = "Invoice"."id"))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" JOIN "Invoice" ON "Invoice"."branchId" = "Branch"."id" WHERE "InvoiceItem"."invoiceId" = "Invoice"."id")));

-- Payment
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_payment ON "Payment";
CREATE POLICY tenant_isolation_payment ON "Payment" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" JOIN "Invoice" ON "Invoice"."branchId" = "Branch"."id" WHERE "Payment"."invoiceId" = "Invoice"."id"))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" JOIN "Invoice" ON "Invoice"."branchId" = "Branch"."id" WHERE "Payment"."invoiceId" = "Invoice"."id")));

-- ServiceReminder
ALTER TABLE "ServiceReminder" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_servicereminder ON "ServiceReminder";
CREATE POLICY tenant_isolation_servicereminder ON "ServiceReminder" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Customer" ON "Customer"."organisationId" = o."id" WHERE "ServiceReminder"."customerId" = "Customer"."id") AND (app_is_staff() OR "ServiceReminder"."customerId" = app_current_customer_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Customer" ON "Customer"."organisationId" = o."id" WHERE "ServiceReminder"."customerId" = "Customer"."id") AND (app_is_staff() OR "ServiceReminder"."customerId" = app_current_customer_id())));

-- Message
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_message ON "Message";
CREATE POLICY tenant_isolation_message ON "Message" FOR ALL USING (("Message"."organisationId" = app_current_org_id() AND (app_is_admin() OR "Message"."branchId" IS NULL OR "Message"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "Message"."customerId" = app_current_customer_id()))) WITH CHECK (("Message"."organisationId" = app_current_org_id() AND (app_is_admin() OR "Message"."branchId" IS NULL OR "Message"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "Message"."customerId" = app_current_customer_id())));

-- Notification
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_notification ON "Notification";
CREATE POLICY tenant_isolation_notification ON "Notification" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "User" ON "User"."organisationId" = o."id" WHERE "Notification"."userId" = "User"."id") AND (app_is_admin() OR "Notification"."branchId" IS NULL OR "Notification"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "Notification"."customerId" = app_current_customer_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "User" ON "User"."organisationId" = o."id" WHERE "Notification"."userId" = "User"."id") AND (app_is_admin() OR "Notification"."branchId" IS NULL OR "Notification"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "Notification"."customerId" = app_current_customer_id())));

-- Review
ALTER TABLE "Review" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_review ON "Review";
CREATE POLICY tenant_isolation_review ON "Review" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "Review"."branchId" = "Branch"."id") AND (app_is_admin() OR "Review"."branchId" IS NULL OR "Review"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "Review"."customerId" = app_current_customer_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "Review"."branchId" = "Branch"."id") AND (app_is_admin() OR "Review"."branchId" IS NULL OR "Review"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "Review"."customerId" = app_current_customer_id())));

-- Campaign
ALTER TABLE "Campaign" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_campaign ON "Campaign";
CREATE POLICY tenant_isolation_campaign ON "Campaign" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "Campaign"."branchId" = "Branch"."id") AND (app_is_admin() OR "Campaign"."branchId" IS NULL OR "Campaign"."branchId" = app_current_branch_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "Campaign"."branchId" = "Branch"."id") AND (app_is_admin() OR "Campaign"."branchId" IS NULL OR "Campaign"."branchId" = app_current_branch_id())));

-- MarketingAsset
ALTER TABLE "MarketingAsset" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_marketingasset ON "MarketingAsset";
CREATE POLICY tenant_isolation_marketingasset ON "MarketingAsset" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "MarketingAsset"."branchId" = "Branch"."id") AND (app_is_admin() OR "MarketingAsset"."branchId" IS NULL OR "MarketingAsset"."branchId" = app_current_branch_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "MarketingAsset"."branchId" = "Branch"."id") AND (app_is_admin() OR "MarketingAsset"."branchId" IS NULL OR "MarketingAsset"."branchId" = app_current_branch_id())));

-- ContentScript
ALTER TABLE "ContentScript" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_contentscript ON "ContentScript";
CREATE POLICY tenant_isolation_contentscript ON "ContentScript" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "ContentScript"."branchId" = "Branch"."id") AND (app_is_admin() OR "ContentScript"."branchId" IS NULL OR "ContentScript"."branchId" = app_current_branch_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "ContentScript"."branchId" = "Branch"."id") AND (app_is_admin() OR "ContentScript"."branchId" IS NULL OR "ContentScript"."branchId" = app_current_branch_id())));

-- RoleConfig
ALTER TABLE "RoleConfig" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_roleconfig ON "RoleConfig";
CREATE POLICY tenant_isolation_roleconfig ON "RoleConfig" FOR ALL USING (("RoleConfig"."organisationId" = app_current_org_id())) WITH CHECK (("RoleConfig"."organisationId" = app_current_org_id()));

-- Permission
ALTER TABLE "Permission" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_permission ON "Permission";
CREATE POLICY tenant_isolation_permission ON "Permission" FOR ALL USING (("Permission"."organisationId" = app_current_org_id())) WITH CHECK (("Permission"."organisationId" = app_current_org_id()));

-- CustomerAddress
ALTER TABLE "CustomerAddress" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_customeraddress ON "CustomerAddress";
CREATE POLICY tenant_isolation_customeraddress ON "CustomerAddress" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Customer" ON "Customer"."organisationId" = o."id" WHERE "CustomerAddress"."customerId" = "Customer"."id") AND (app_is_staff() OR "CustomerAddress"."customerId" = app_current_customer_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Customer" ON "Customer"."organisationId" = o."id" WHERE "CustomerAddress"."customerId" = "Customer"."id") AND (app_is_staff() OR "CustomerAddress"."customerId" = app_current_customer_id())));

-- CustomerConsent
ALTER TABLE "CustomerConsent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_customerconsent ON "CustomerConsent";
CREATE POLICY tenant_isolation_customerconsent ON "CustomerConsent" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Customer" ON "Customer"."organisationId" = o."id" WHERE "CustomerConsent"."customerId" = "Customer"."id") AND (app_is_staff() OR "CustomerConsent"."customerId" = app_current_customer_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Customer" ON "Customer"."organisationId" = o."id" WHERE "CustomerConsent"."customerId" = "Customer"."id") AND (app_is_staff() OR "CustomerConsent"."customerId" = app_current_customer_id())));

-- LeadSource
ALTER TABLE "LeadSource" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_leadsource ON "LeadSource";
CREATE POLICY tenant_isolation_leadsource ON "LeadSource" FOR ALL USING (("LeadSource"."organisationId" = app_current_org_id())) WITH CHECK (("LeadSource"."organisationId" = app_current_org_id()));

-- LeadStage
ALTER TABLE "LeadStage" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_leadstage ON "LeadStage";
CREATE POLICY tenant_isolation_leadstage ON "LeadStage" FOR ALL USING (("LeadStage"."organisationId" = app_current_org_id())) WITH CHECK (("LeadStage"."organisationId" = app_current_org_id()));

-- Lead
ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lead ON "Lead";
CREATE POLICY tenant_isolation_lead ON "Lead" FOR ALL USING (("Lead"."organisationId" = app_current_org_id() AND (app_is_admin() OR "Lead"."branchId" IS NULL OR "Lead"."branchId" = app_current_branch_id()))) WITH CHECK (("Lead"."organisationId" = app_current_org_id() AND (app_is_admin() OR "Lead"."branchId" IS NULL OR "Lead"."branchId" = app_current_branch_id())));

-- LeadActivity
ALTER TABLE "LeadActivity" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_leadactivity ON "LeadActivity";
CREATE POLICY tenant_isolation_leadactivity ON "LeadActivity" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Lead" ON "Lead"."organisationId" = o."id" WHERE "LeadActivity"."leadId" = "Lead"."id"))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Lead" ON "Lead"."organisationId" = o."id" WHERE "LeadActivity"."leadId" = "Lead"."id")));

-- Task
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_task ON "Task";
CREATE POLICY tenant_isolation_task ON "Task" FOR ALL USING (("Task"."organisationId" = app_current_org_id() AND (app_is_admin() OR "Task"."branchId" IS NULL OR "Task"."branchId" = app_current_branch_id()))) WITH CHECK (("Task"."organisationId" = app_current_org_id() AND (app_is_admin() OR "Task"."branchId" IS NULL OR "Task"."branchId" = app_current_branch_id())));

-- TestRide
ALTER TABLE "TestRide" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_testride ON "TestRide";
CREATE POLICY tenant_isolation_testride ON "TestRide" FOR ALL USING (("TestRide"."organisationId" = app_current_org_id() AND (app_is_admin() OR "TestRide"."branchId" IS NULL OR "TestRide"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "TestRide"."customerId" = app_current_customer_id()))) WITH CHECK (("TestRide"."organisationId" = app_current_org_id() AND (app_is_admin() OR "TestRide"."branchId" IS NULL OR "TestRide"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "TestRide"."customerId" = app_current_customer_id())));

-- AppointmentSlot
ALTER TABLE "AppointmentSlot" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_appointmentslot ON "AppointmentSlot";
CREATE POLICY tenant_isolation_appointmentslot ON "AppointmentSlot" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "AppointmentSlot"."branchId" = "Branch"."id") AND (app_is_admin() OR "AppointmentSlot"."branchId" IS NULL OR "AppointmentSlot"."branchId" = app_current_branch_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "AppointmentSlot"."branchId" = "Branch"."id") AND (app_is_admin() OR "AppointmentSlot"."branchId" IS NULL OR "AppointmentSlot"."branchId" = app_current_branch_id())));

-- ServiceType
ALTER TABLE "ServiceType" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_servicetype ON "ServiceType";
CREATE POLICY tenant_isolation_servicetype ON "ServiceType" FOR ALL USING (("ServiceType"."organisationId" = app_current_org_id())) WITH CHECK (("ServiceType"."organisationId" = app_current_org_id()));

-- JobStatusHistory
ALTER TABLE "JobStatusHistory" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_jobstatushistory ON "JobStatusHistory";
CREATE POLICY tenant_isolation_jobstatushistory ON "JobStatusHistory" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" JOIN "ServiceJob" ON "ServiceJob"."branchId" = "Branch"."id" WHERE "JobStatusHistory"."jobId" = "ServiceJob"."id"))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" JOIN "ServiceJob" ON "ServiceJob"."branchId" = "Branch"."id" WHERE "JobStatusHistory"."jobId" = "ServiceJob"."id")));

-- ServiceHistory
ALTER TABLE "ServiceHistory" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_servicehistory ON "ServiceHistory";
CREATE POLICY tenant_isolation_servicehistory ON "ServiceHistory" FOR ALL USING (("ServiceHistory"."organisationId" = app_current_org_id() AND (app_is_admin() OR "ServiceHistory"."branchId" IS NULL OR "ServiceHistory"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "ServiceHistory"."customerId" = app_current_customer_id()))) WITH CHECK (("ServiceHistory"."organisationId" = app_current_org_id() AND (app_is_admin() OR "ServiceHistory"."branchId" IS NULL OR "ServiceHistory"."branchId" = app_current_branch_id()) AND (app_is_staff() OR "ServiceHistory"."customerId" = app_current_customer_id())));

-- InventoryLocation
ALTER TABLE "InventoryLocation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_inventorylocation ON "InventoryLocation";
CREATE POLICY tenant_isolation_inventorylocation ON "InventoryLocation" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "InventoryLocation"."branchId" = "Branch"."id") AND (app_is_admin() OR "InventoryLocation"."branchId" IS NULL OR "InventoryLocation"."branchId" = app_current_branch_id()))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "Branch" ON "Branch"."organisationId" = o."id" WHERE "InventoryLocation"."branchId" = "Branch"."id") AND (app_is_admin() OR "InventoryLocation"."branchId" IS NULL OR "InventoryLocation"."branchId" = app_current_branch_id())));

-- AutomationRule
ALTER TABLE "AutomationRule" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_automationrule ON "AutomationRule";
CREATE POLICY tenant_isolation_automationrule ON "AutomationRule" FOR ALL USING (("AutomationRule"."organisationId" = app_current_org_id())) WITH CHECK (("AutomationRule"."organisationId" = app_current_org_id()));

-- AutomationExecution
ALTER TABLE "AutomationExecution" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_automationexecution ON "AutomationExecution";
CREATE POLICY tenant_isolation_automationexecution ON "AutomationExecution" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "AutomationRule" ON "AutomationRule"."organisationId" = o."id" WHERE "AutomationExecution"."ruleId" = "AutomationRule"."id"))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "AutomationRule" ON "AutomationRule"."organisationId" = o."id" WHERE "AutomationExecution"."ruleId" = "AutomationRule"."id")));

-- MessageTemplate
ALTER TABLE "MessageTemplate" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_messagetemplate ON "MessageTemplate";
CREATE POLICY tenant_isolation_messagetemplate ON "MessageTemplate" FOR ALL USING (("MessageTemplate"."organisationId" = app_current_org_id())) WITH CHECK (("MessageTemplate"."organisationId" = app_current_org_id()));

-- LoyaltyTier
ALTER TABLE "LoyaltyTier" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_loyaltytier ON "LoyaltyTier";
CREATE POLICY tenant_isolation_loyaltytier ON "LoyaltyTier" FOR ALL USING (("LoyaltyTier"."organisationId" = app_current_org_id())) WITH CHECK (("LoyaltyTier"."organisationId" = app_current_org_id()));

-- LoyaltyAccount
ALTER TABLE "LoyaltyAccount" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_loyaltyaccount ON "LoyaltyAccount";
CREATE POLICY tenant_isolation_loyaltyaccount ON "LoyaltyAccount" FOR ALL USING (("LoyaltyAccount"."organisationId" = app_current_org_id() AND (app_is_staff() OR "LoyaltyAccount"."customerId" = app_current_customer_id()))) WITH CHECK (("LoyaltyAccount"."organisationId" = app_current_org_id() AND (app_is_staff() OR "LoyaltyAccount"."customerId" = app_current_customer_id())));

-- LoyaltyTransaction
ALTER TABLE "LoyaltyTransaction" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_loyaltytransaction ON "LoyaltyTransaction";
CREATE POLICY tenant_isolation_loyaltytransaction ON "LoyaltyTransaction" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "LoyaltyAccount" ON "LoyaltyAccount"."organisationId" = o."id" WHERE "LoyaltyTransaction"."accountId" = "LoyaltyAccount"."id"))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "LoyaltyAccount" ON "LoyaltyAccount"."organisationId" = o."id" WHERE "LoyaltyTransaction"."accountId" = "LoyaltyAccount"."id")));

-- Reward
ALTER TABLE "Reward" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_reward ON "Reward";
CREATE POLICY tenant_isolation_reward ON "Reward" FOR ALL USING (("Reward"."organisationId" = app_current_org_id())) WITH CHECK (("Reward"."organisationId" = app_current_org_id()));

-- RewardRedemption
ALTER TABLE "RewardRedemption" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_rewardredemption ON "RewardRedemption";
CREATE POLICY tenant_isolation_rewardredemption ON "RewardRedemption" FOR ALL USING ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "LoyaltyAccount" ON "LoyaltyAccount"."organisationId" = o."id" WHERE "RewardRedemption"."accountId" = "LoyaltyAccount"."id"))) WITH CHECK ((EXISTS (SELECT 1 FROM "Organisation" o JOIN "LoyaltyAccount" ON "LoyaltyAccount"."organisationId" = o."id" WHERE "RewardRedemption"."accountId" = "LoyaltyAccount"."id")));

-- Referral
ALTER TABLE "Referral" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_referral ON "Referral";
CREATE POLICY tenant_isolation_referral ON "Referral" FOR ALL USING (("Referral"."organisationId" = app_current_org_id())) WITH CHECK (("Referral"."organisationId" = app_current_org_id()));

-- Attachment
ALTER TABLE "Attachment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_attachment ON "Attachment";
CREATE POLICY tenant_isolation_attachment ON "Attachment" FOR ALL USING (("Attachment"."organisationId" = app_current_org_id())) WITH CHECK (("Attachment"."organisationId" = app_current_org_id()));

-- AuditLog
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_auditlog ON "AuditLog";
CREATE POLICY tenant_isolation_auditlog ON "AuditLog" FOR ALL USING (("AuditLog"."organisationId" = app_current_org_id() AND (app_is_admin() OR "AuditLog"."branchId" IS NULL OR "AuditLog"."branchId" = app_current_branch_id()))) WITH CHECK (("AuditLog"."organisationId" = app_current_org_id() AND (app_is_admin() OR "AuditLog"."branchId" IS NULL OR "AuditLog"."branchId" = app_current_branch_id())));

-- IntegrationConfig
ALTER TABLE "IntegrationConfig" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_integrationconfig ON "IntegrationConfig";
CREATE POLICY tenant_isolation_integrationconfig ON "IntegrationConfig" FOR ALL USING (("IntegrationConfig"."organisationId" = app_current_org_id())) WITH CHECK (("IntegrationConfig"."organisationId" = app_current_org_id()));
