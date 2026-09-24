-- 员工邮箱唯一（生产事故：同一个邮箱出现两条 User 行，同一个技师的两张工单被拆到两个身份）
-- 生产 PG 已先手工建好同名索引，这里同步 sqlite（本地 dev/e2e）与迁移历史。
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
