// 只读报告：现有工单行的"目录归因"情况 —— 佣金按 SKU / 服务 / 套餐配置之前，先知道有多少钱
// 是能归因的、多少不能。**不修数据**（不猜、不自动匹配），只报告，因为猜错会让佣金算错且没人发现。
//
// 用法：pnpm exec tsx scripts/commission/attribution-report.ts [--db=./prisma/dev.db]
//
// 三块信息：
//   ① 覆盖率：工单行里有多少已经带上目录身份（P0 之后新建的行应该 100% 带）
//   ② 无法归因的构成：按 kind/source 分组 + 金额最大的描述（这些将走 LEGACY 规则）
//   ③ 目录缺口：柜台实际在卖的源码目录（lib/service-catalog，12 项）里，有多少还没有对应的
//      ServiceType 数据库行 —— 这是"每个服务都能配佣金"这句话能否成立的前提（P0b）

import { PrismaClient } from "@prisma/client";
import { SERVICE_CATALOG } from "../../src/lib/service-catalog";

const db = new PrismaClient();

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

async function main() {
  const items = await db.serviceJobItem.findMany({
    select: { id: true, description: true, kind: true, source: true, lineTotalSen: true, productId: true, serviceTypeId: true, packageId: true, jobId: true },
  });
  const total = items.length;
  const linked = items.filter((i) => i.productId || i.serviceTypeId || i.packageId);
  const money = items.reduce((s, i) => s + i.lineTotalSen, 0);
  const linkedMoney = linked.reduce((s, i) => s + i.lineTotalSen, 0);

  console.log("=== ① 目录归因覆盖率（工单行）===");
  console.log("  总行数:", total, "| 已带目录身份:", linked.length, total ? "(" + Math.round((linked.length / total) * 100) + "%)" : "");
  const byKind = new Map<string, { n: number; sen: number }>();
  for (const i of items) {
    const k = i.kind + " / " + i.source;
    const cur = byKind.get(k) ?? { n: 0, sen: 0 };
    byKind.set(k, { n: cur.n + 1, sen: cur.sen + i.lineTotalSen });
  }
  for (const [k, v] of [...byKind.entries()].sort((a, b) => b[1].sen - a[1].sen)) {
    console.log("   ", k.padEnd(28), "行数", String(v.n).padStart(5), " 金额 RM", (v.sen / 100).toFixed(2));
  }
  console.log("  总金额 RM", (money / 100).toFixed(2), "| 已可归因 RM", (linkedMoney / 100).toFixed(2));

  console.log("");
  console.log("=== ② 无法归因的行（将走 LEGACY 规则）——按金额取前 10 个描述 ===");
  const unlinked = items.filter((i) => !i.productId && !i.serviceTypeId && !i.packageId);
  const byDesc = new Map<string, { n: number; sen: number }>();
  for (const i of unlinked) {
    const cur = byDesc.get(i.description) ?? { n: 0, sen: 0 };
    byDesc.set(i.description, { n: cur.n + 1, sen: cur.sen + i.lineTotalSen });
  }
  if (unlinked.length === 0) console.log("   （无：全部行都带目录身份）");
  for (const [d, v] of [...byDesc.entries()].sort((a, b) => b[1].sen - a[1].sen).slice(0, 10)) {
    console.log("   RM", (v.sen / 100).toFixed(2).padStart(10), " x", String(v.n).padStart(3), " ", d.slice(0, 60));
  }

  console.log("");
  console.log("=== ③ 目录缺口：柜台在卖的源码目录 vs 数据库 ServiceType ===");
  const types = await db.serviceType.findMany({ select: { id: true, name: true, code: true, priceSen: true, active: true } });
  const byName = new Map(types.map((t) => [norm(t.name), t]));
  const byCode = new Map(types.filter((t) => t.code).map((t) => [norm(t.code), t]));
  let missing = 0;
  for (const c of SERVICE_CATALOG) {
    const hit = byCode.get(norm(c.key)) ?? byName.get(norm(c.label));
    if (!hit) {
      missing++;
      console.log("   ✗ 无对应 ServiceType:", c.key.padEnd(18), c.label);
    } else if (!hit.code || hit.priceSen == null) {
      console.log("   ⚠ 命中了但没有 code/价格:", hit.name, "(code:", hit.code ?? "-", "priceSen:", hit.priceSen ?? "-", ")");
    }
  }
  console.log("   源码目录共", SERVICE_CATALOG.length, "项，其中", missing, "项目前没有对应的 ServiceType 行");
  console.log("   （缺一个就意味着一项服务配不了佣金 —— 这正是 P0b 要统一的目录）");
}

main()
  .catch((e) => {
    console.error("报告失败:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
