-- P1a 补充：ChecklistTemplate(organisationId) 索引。
--
-- 2026-09-30：上一份迁移（20260930120000）建表时 schema 还没声明这个索引，
-- 但生产侧的 DDL 脚本（scripts/apply-p1a-production.mjs）给四张租户表都建了
-- organisationId 索引 —— 于是 schema 与生产出现漂移，`sync-prod-schema.mjs --check`
-- 会认为该索引多余并想把它 DROP 掉（而它遇到 DROP 就 exit 1，会拦住下一次部署）。
--
-- 两种修法里选了"把索引补进 schema"而不是"从生产删掉索引"：模板按租户过滤是常态查询，
-- 这个索引本来就该有。
CREATE INDEX "ChecklistTemplate_organisationId_idx" ON "ChecklistTemplate"("organisationId");
