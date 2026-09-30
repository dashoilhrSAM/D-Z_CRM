/**
 * 租户列回填（**幂等**，默认只报告不写）。
 *
 * 用法
 *   pnpm exec tsx scripts/backfill-tenant-columns.ts            # 只报告（默认）
 *   pnpm exec tsx scripts/backfill-tenant-columns.ts --apply    # 执行
 *
 * 历史（很重要，别把这里当成"没写完"）
 * ------------------------------------
 * P1a 时这个脚本负责给 Motorcycle / ServiceJob / Invoice / ChecklistTemplate 四张表
 * 从父行推导 organisationId —— 新表加列那天、以及发票是导入进来的时候，这一步必须能跑。
 *
 * **P1b 之后那四列已经收紧为 NOT NULL**：于是"查出 organisationId 为 NULL 的行"
 * 在**类型上就已经不成立**（Prisma 会直接拒绝 `where: { organisationId: null }`）。
 * 这不是脚本坏了，而是它要防的那个状态已经不可能出现 —— 数据库自己会拦住。
 * 所以那部分代码**已被删除**，不是被注释掉：留着会让人以为还能回填。
 *
 * 现在这里只剩一件事：`Organisation.slug`（运营句柄）。
 * 它是后加的列、当前仍可空，需要给历史组织补值。
 */
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const db = new PrismaClient();

/** 把店名变成运营句柄：小写、非字母数字转 '-'、去掉首尾 '-'。与 seed-core 的规则一致。 */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "workshop";
}

async function main() {
  console.log("模式:", APPLY ? "APPLY（会写库）" : "只报告（不写库）");

  const orgs = await db.organisation.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { createdAt: "asc" },
  });
  if (orgs.length === 0) {
    console.log("没有 Organisation，无需回填。");
    return;
  }

  const missing = orgs.filter((o) => !o.slug);
  console.log("Organisation:", orgs.length, "| 缺 slug:", missing.length);

  const taken = new Set(orgs.map((o) => o.slug).filter((s): s is string => !!s));
  for (const org of missing) {
    let candidate = slugify(org.name);
    let n = 2;
    while (taken.has(candidate)) candidate = slugify(org.name) + "-" + n++;
    taken.add(candidate);
    if (APPLY) {
      await db.organisation.update({ where: { id: org.id }, data: { slug: candidate } });
      console.log("  已回填 slug:", org.name, "→", candidate);
    } else {
      console.log("  待回填 slug:", org.name, "→", candidate);
    }
  }

  /* ---------- AuthLink：把既有的 User.authId / Customer.authId 收进映射表（P3） ---------- */
  // 幂等：按 (authId, organisationId) upsert。现在两列都还是全局唯一，所以是 1:1，不会歧义。
  const staffWithAuth = await db.user.findMany({
    where: { authId: { not: null } },
    select: { id: true, authId: true, organisationId: true },
  });
  const customersWithAuth = await db.customer.findMany({
    where: { authId: { not: null } },
    select: { id: true, authId: true, organisationId: true },
  });
  const wanted = [
    ...staffWithAuth.map((u) => ({ authId: u.authId as string, organisationId: u.organisationId, kind: "STAFF", userId: u.id, customerId: null })),
    ...customersWithAuth.map((c) => ({ authId: c.authId as string, organisationId: c.organisationId, kind: "CUSTOMER", userId: null, customerId: c.id })),
  ];
  console.log("\nAuthLink 待映射:", wanted.length, "条（员工", staffWithAuth.length, "+ 客户", customersWithAuth.length, "）");
  if (APPLY) {
    for (const w of wanted) {
      await db.authLink.upsert({
        where: { authId_organisationId: { authId: w.authId, organisationId: w.organisationId } },
        create: w,
        update: { kind: w.kind, userId: w.userId, customerId: w.customerId },
      });
    }
    console.log("  已写入 AuthLink:", await db.authLink.count());
  }

  if (!APPLY) {
    console.log("\n（只报告模式：加 --apply 执行）");
    return;
  }

  // AuthLink 的对照：凡是有 authId 的员工/客户，都必须能在映射表里找到 ——
  // 否则他们下次登录时解析不到身份（而解析失败表现为"登不进去"，很难查）。
  const staffMissing = (await db.user.count({ where: { authId: { not: null } } })) - (await db.authLink.count({ where: { kind: "STAFF" } }));
  const custMissing = (await db.customer.count({ where: { authId: { not: null } } })) - (await db.authLink.count({ where: { kind: "CUSTOMER" } }));
  console.log("有 authId 但缺 AuthLink：员工", staffMissing, "客户", custMissing);
  if (staffMissing > 0 || custMissing > 0) {
    console.error("❌ 有账号没有映射 —— 他们下次登录会解析不到身份。");
    process.exitCode = 1;
  }

  const left = await db.organisation.count({ where: { slug: null } });
  console.log("\n回填后缺 slug 的组织:", left);
  if (left > 0) {
    // 注意：**不再**断言"四张表的 organisationId 没有 NULL" —— 那四列已是 NOT NULL，
    // 数据库层面不可能存在这种行。留着那句等于把"类型上不可能"写成"运行时检查"，
    // 反而让人以为还有一条需要长期维护的路径。
    console.error("❌ 仍有组织没有 slug —— 平台台 / 备份命名 / 日志都靠它指认租户。");
    process.exitCode = 1;
  } else {
    console.log("✅ slug 已补齐。");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
