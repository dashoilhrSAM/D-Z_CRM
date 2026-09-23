// 把服务目录对齐成一份：源码目录（lib/service-catalog，柜台实际在卖的 12 项）→ ServiceType。
//
// 幂等：可以反复跑。按 code upsert；存量同名行只补 code 与**为空**的价格，
// 管理员手工设过的价格不会被覆盖。决策：源码 12 项 + 数据库独有的 6 项全部保留（共 18 项）。
//
// 用法：DATABASE_URL="file:./dev.db" pnpm exec tsx scripts/commission/sync-service-catalogue.ts
import { syncServiceCatalogue, catalogueDrift } from "../../src/lib/service-catalogue";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const res = await syncServiceCatalogue();
  console.log("同步完成:", JSON.stringify(res));
  const drift = await catalogueDrift();
  console.log("漂移检查（源码目录里在数据库找不到对应的项）:", drift.length === 0 ? "无 ✅" : drift);

  const rows = await db.serviceType.findMany({ orderBy: [{ code: "asc" }], select: { name: true, code: true, priceSen: true, active: true } });
  console.log("");
  console.log("=== ServiceType 现状（" + rows.length + " 行）===");
  for (const r of rows) {
    console.log("  ", (r.code ?? "(无 code)").padEnd(18), (r.name ?? "").padEnd(26), r.priceSen == null ? "(无价)" : "RM " + (r.priceSen / 100).toFixed(2));
  }
}

main()
  .catch((e) => {
    console.error("同步失败:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
