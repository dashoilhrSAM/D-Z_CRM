-- P0b：一个 code 对应一行 ServiceType。
--
-- 为什么需要它：同步脚本（src/lib/service-catalogue.ts）按 code 做幂等 upsert，
-- 没有唯一约束时"先查再插"在并发下会造出重复服务行（而重复的目录行会让佣金配置指向错误的那一行）。
-- code 可空（历史行都是空），SQLite/Postgres 的唯一索引允许多个 NULL，因此不影响旧数据。
CREATE UNIQUE INDEX "ServiceType_organisationId_code_key" ON "ServiceType"("organisationId", "code");
