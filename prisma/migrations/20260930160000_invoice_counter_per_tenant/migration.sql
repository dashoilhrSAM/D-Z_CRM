-- P1b：发票号计数器改为「按租户 + 年份」。
--
-- 为什么**先清空**这张表：它是纯派生数据 —— 唯一的读法是
-- 「有这个 (org, year) 的行就用它的 value，没有就从该租户当年已发发票的最大号重新起步」
-- （见 src/services/completion.ts 的 nextInvoiceNumber）。所以删掉行不会丢任何业务事实，
-- 下一次取号会自动从该租户当年的最大号接上，且**绝不回退**。
-- 反过来，若把历史的全局计数器行硬套给某一家店，才会真的把号段弄错。
DELETE FROM "InvoiceCounter";

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InvoiceCounter" (
    "organisationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    PRIMARY KEY ("organisationId", "year"),
    CONSTRAINT "InvoiceCounter_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
DROP TABLE "InvoiceCounter";
ALTER TABLE "new_InvoiceCounter" RENAME TO "InvoiceCounter";
CREATE INDEX "InvoiceCounter_organisationId_idx" ON "InvoiceCounter"("organisationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
