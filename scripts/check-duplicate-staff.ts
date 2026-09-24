/**
 * 员工重复身份：检查 + 合并。
 *
 *   # 只报告（默认，不动任何数据）
 *   DATABASE_URL="$(grep '^DST_DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')" pnpm exec tsx scripts/check-duplicate-staff.ts
 *   # 真正合并（把幽灵行名下的工单挪到保留行，然后尝试删掉幽灵行）
 *   ... pnpm exec tsx scripts/check-duplicate-staff.ts --merge
 *
 * 背景：生产上出现过同一个邮箱两条 User 行 —— provision 脚本的「按 email 幂等」
 * 用的是大小写敏感匹配（库里 MechanicDemo@gmail.com / 脚本里 mechanicdemo@gmail.com），
 * 于是又建了一行；同一个技师的两张工单被拆到两个身份，登录后只看得到一半。
 *
 * 合并原则（纯函数在 src/lib/staff-identity.ts，有测试）：
 *   保留**已绑定登录（authId）**的那一行（那是大家实际登录进来的身份），
 *   把幽灵行的工单挪过去，然后删掉幽灵行。
 *   删除如果被外键挡住 → **打印出来并停下**，不硬来（说明还有别的表引用它，需要人判断）。
 */

import { db } from "@/lib/db";
import { groupDuplicates, normalizeEmail, pickCanonicalRow } from "@/lib/staff-identity";

const MERGE = process.argv.includes("--merge");

async function main() {
  const users = await db.user.findMany({
    select: { id: true, name: true, email: true, authId: true, active: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  console.log("用户总数: " + users.length);
  const groups = groupDuplicates(users);
  console.log("同邮箱多行: " + groups.length + " 组");

  if (groups.length === 0) {
    console.log("没有重复身份 ✓");
    await db.$disconnect();
    return;
  }

  let merged = 0;
  let blocked = 0;
  for (const g of groups) {
    const keep = pickCanonicalRow(g.rows);
    const ghosts = g.rows.filter((r) => r.id !== keep.id);
    console.log("");
    console.log("● " + g.email + " —— 保留 " + keep.id + " (" + (keep.authId ? "已绑定登录" : "未绑定") + ")");
    const jobsOf = async (id: string) => db.serviceJob.count({ where: { mechanicId: id } });
    for (const r of g.rows) {
      console.log("    " + r.id + " | " + (r.authId ? "authId " + r.authId.slice(0, 8) : "未绑定") + " | active " + r.active + " | 工单 " + (await jobsOf(r.id)));
    }
    for (const ghost of ghosts) {
      const jobs = await jobsOf(ghost.id);
      if (!MERGE) {
        console.log("    → 合并时会把 " + jobs + " 张工单改派到保留行，然后删除 " + ghost.id + "（现在只报告，不改）");
        continue;
      }
      if (jobs > 0) {
        await db.serviceJob.updateMany({ where: { mechanicId: ghost.id }, data: { mechanicId: keep.id } });
        console.log("    → 已把 " + jobs + " 张工单改派到 " + keep.id);
      }
      try {
        await db.user.delete({ where: { id: ghost.id } });
        console.log("    → 已删除幽灵行 " + ghost.id);
        merged++;
      } catch (e) {
        blocked++;
        console.log("    ✗ 删不掉（还有别的表引用它，需要人判断）: " + (e as Error).message.split("\n")[0]);
      }
    }
  }

  console.log("");
  console.log(MERGE ? "合并完成：处理 " + merged + " 行，受阻 " + blocked + " 行" : "（这是报告模式；加 --merge 才会真的合并）");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("失败:", (e as Error).message);
  await db.$disconnect();
  process.exit(1);
});
