/* eslint-disable no-console */
/**
 * P4 · 开一家新店（CLI）。
 *
 * 用法：
 *   pnpm exec tsx scripts/provision-tenant.ts --name "KL Bike Works" --slug kl-bike-works \
 *     --owner-email owner@klbike.my [--owner-name "Ah Seng"] [--city "Kuala Lumpur"] \
 *     [--address "..."] [--phone "+60..."] [--trial-days 30] [--password '...'] [--dry-run] [--yes]
 *
 * 为什么先有 CLI 而不是网页：建租户是**平台级能力**（不是任何一家店里的角色能做的是），
 * 而平台管理员的身份模型（`PLATFORM_ADMIN` 放哪、谁能有）还没定 —— 在那之前，
 * 任何"网页点一下就能建店"的入口都是白送的攻击面。CLI 由运维在自己机器上跑，
 * 走的是 service role 与生产库连接，不经过 HTTP。
 *
 * 护栏（与 `provision-demo-branch.ts` 一致）：
 *   · 生产环境默认拒绝，除非 `PROVISION_ALLOWED=1`；脚本还会打印它连的是哪个库（主机名）
 *   · 默认 **dry-run**：只做校验与冲突检查，不写任何东西；确认无误加 `--yes` 才真建
 *   · 建完把"开通链接 / 门店码 / 店主邮箱 / 临时密码"打成一段可直接转发的文本
 */
import { platformService, validateProvisionInput } from "../src/modules/platform/service";
import { isLocalDatabaseTarget } from "../src/modules/platform/target";
import { PrismaClient } from "@prisma/client";

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf("--" + name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name: string) => argv.includes("--" + name);

const name = arg("name");
const slug = arg("slug");
const ownerEmail = arg("owner-email");
const APPLY = flag("yes");

if (flag("help") || !name || !slug || !ownerEmail) {
  console.log(`用法：
  pnpm exec tsx scripts/provision-tenant.ts --name "店名" --slug 店铺句柄 --owner-email 店主邮箱 \\
      [--owner-name 姓名] [--city 城市] [--address 地址] [--phone 电话] [--trial-days 30]
      [--password 指定密码] [--yes]

默认 **dry-run**（只校验，不写库）。确认后加 --yes 真建。
生产环境需要 PROVISION_ALLOWED=1（防手滑）。`);
  process.exit(name || slug || ownerEmail ? 2 : 0);
}

async function main() {
  const input = {
    name: name!,
    slug: slug!,
    ownerEmail: ownerEmail!,
    ownerName: arg("owner-name"),
    city: arg("city"),
    address: arg("address"),
    phone: arg("phone"),
    email: arg("email"),
    ownerPassword: arg("password"),
    trialDays: arg("trial-days") ? Number(arg("trial-days")) : undefined,
  };

  // 先报"参数哪里不对"，再谈目标库 —— 顺序影响可用性：参数写错时最该看到的是那一行
  const invalid = validateProvisionInput(input);
  if (invalid) {
    console.error("❌ " + invalid.error);
    process.exit(2);
  }

  // —— 生产护栏 ——
  // ⚠️ 判据是**目标主机**，不是 NODE_ENV：本仓的 `.env` 里就放着生产 Supabase 的连接串，
  // 在本地终端跑这个脚本时 NODE_ENV 是 development，但 `--yes` 会**直接写生产**。
  // （开发时 dry-run 打印出 `db.<ref>.supabase.co` 就是活生生的例子。）
  const dbUrl = process.env.DST_DATABASE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  const isLocalTarget = isLocalDatabaseTarget(dbUrl);
  const host = (() => {
    try { return new URL(dbUrl).host || "(sqlite)"; } catch { return dbUrl.startsWith("file:") ? "(sqlite: " + dbUrl + ")" : "(unknown)"; }
  })();

  if (!isLocalTarget && process.env.PROVISION_ALLOWED !== "1") {
    console.error("❌ 目标库不是本地库（" + host + "）—— 真要在远端建店，请显式设置 PROVISION_ALLOWED=1。");
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production" && process.env.PROVISION_ALLOWED !== "1") {
    console.error("❌ Refusing to provision in production (NODE_ENV=production). Set PROVISION_ALLOWED=1 to override.");
    process.exit(1);
  }

  console.log("[provision-tenant] 目标库:", host);
  console.log("[provision-tenant] 输入:", JSON.stringify({ ...input, ownerPassword: input.ownerPassword ? "***" : undefined }));

  if (!APPLY) {
    // dry-run：只做只读检查（slug 是否被占），不碰 auth、不写库
    const prisma = new PrismaClient();
    const taken = await prisma.organisation.findUnique({ where: { slug: input.slug }, select: { name: true } });
    await prisma.$disconnect();
    if (taken) {
      console.error(`❌ slug "${input.slug}" 已被「${taken.name}」占用`);
      process.exit(1);
    }
    console.log("✅ 校验通过（slug 可用）。这是 dry-run：**没有写任何东西**。确认后加 --yes。");
    process.exit(0);
  }

  const res = await platformService.provisionTenant(input);
  if (!res.ok) {
    console.error("❌ 开通失败 [" + res.code + "] " + res.error);
    process.exit(1);
  }

  console.log("\n✅ 开店成功\n");
  console.log(`  店名      ${input.name}（${res.slug}）`);
  console.log(`  状态      ${res.status}`);
  console.log(`  门店 ID   ${res.organisationId}`);
  console.log(`  主店 ID   ${res.branchId}`);
  console.log(`  店主      ${res.ownerEmail}${res.reusedAuthAccount ? "（复用了已有账号，密码不变）" : ""}`);
  if (res.tempPassword) console.log(`  临时密码  ${res.tempPassword}   ← 只显示这一次，请让店主登录后立即修改`);
  console.log(`  开通链接  ${res.entryUrl}`);
  if (res.workshopQrUrl) console.log(`  门店码    ${res.workshopQrUrl}`);
  console.log(`  默认配置  服务 ${res.counts.serviceTypes} · 来源 ${res.counts.leadSources} · 阶段 ${res.counts.leadStages} · 模板 ${res.counts.messageTemplates} · 时段 ${res.counts.slots}`);
  for (const w of res.warnings) console.log("  ⚠️  " + w);
  console.log("\n下一步：把开通链接发给店主（他点进去登录即可进店）；门店码打印后贴在店里。");
}

main().catch((e) => {
  console.error("❌ " + String((e as Error)?.message ?? e));
  process.exit(1);
});
