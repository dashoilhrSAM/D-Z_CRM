/* eslint-disable no-console */
/**
 * P4 · 授予/撤销**平台管理员**（`PlatformAdmin` 表）。
 *
 * 为什么必须有这个 CLI：平台台自己需要管理员，而"第一个管理员"不可能由平台台产生
 * （先有鸡还是先有蛋）。所以授予权限这件事**只走终端**，页面里没有、也不该有入口。
 *
 * 用法：
 *   pnpm exec tsx scripts/grant-platform-admin.ts --list
 *   pnpm exec tsx scripts/grant-platform-admin.ts --email owner@dz.my --note "创始人"
 *   pnpm exec tsx scripts/grant-platform-admin.ts --auth-id <supabase-user-id> --note "运维"
 *   pnpm exec tsx scripts/grant-platform-admin.ts --revoke --email owner@dz.my
 *
 * 护栏（与开通脚本同一套）：
 *   · 目标库不是本地库 → 必须显式 `PLATFORM_ALLOWED=1`（本仓 .env 里就是生产连接串）
 *   · `--email` 走"**只找不建**"：打错一个字母会被拒绝，而不是悄悄造出一个新账号
 */
import { platformService } from "../src/modules/platform/service";
import { isLocalDatabaseTarget } from "../src/modules/platform/target";

const argv = process.argv.slice(2);
const arg = (n: string) => {
  const i = argv.indexOf("--" + n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (n: string) => argv.includes("--" + n);

async function main() {
  const email = arg("email");
  const authId = arg("auth-id");
  const note = arg("note");
  const revoke = flag("revoke");
  const list = flag("list");

  if (flag("help") || (!email && !authId && !list)) {
    console.log(`用法：
  --list                                 列出当前平台管理员
  --email <登录邮箱> [--note 理由]        授予（**只找不建**：没有这个账号会被拒绝）
  --auth-id <supabase-user-id> [--note]  授予（auth 服务不可用时的兜底）
  --revoke --email <邮箱>                 撤销
  --revoke --auth-id <id>                 撤销

生产/远端库需要 PLATFORM_ALLOWED=1。`);
    process.exit(email || authId || list ? 2 : 0);
  }

  const dbUrl = process.env.DST_DATABASE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  const local = isLocalDatabaseTarget(dbUrl);
  const host = (() => {
    try { return new URL(dbUrl).host || "(sqlite)"; } catch { return dbUrl.startsWith("file:") ? "(sqlite: " + dbUrl + ")" : "(unknown)"; }
  })();
  console.log("[platform-admin] 目标库:", host);
  if (!local && process.env.PLATFORM_ALLOWED !== "1") {
    console.error("❌ 目标库不是本地库（" + host + "）—— 真要改远端权限，请显式设置 PLATFORM_ALLOWED=1。");
    process.exit(1);
  }

  if (list) {
    const admins = await platformService.listAdmins();
    if (!admins.length) console.log("（还没有平台管理员）");
    for (const a of admins) {
      console.log(`  · ${a.email ?? "(无邮箱)"}  authId=${a.authId.slice(0, 8)}…  ${a.note ?? ""}  ${a.createdBy ? "by " + a.createdBy : ""}  created=${a.createdAt.toISOString().slice(0, 16)}`);
    }
    process.exit(0);
  }

  // 撤销
  if (revoke) {
    let target = authId;
    if (!target && email) {
      const found = await platformService.adminForEmailLookup(email);
      if (!found) { console.error("❌ 名单里没有这个邮箱"); process.exit(1); }
      target = found.authId;
    }
    const removed = await platformService.revokeAdmin(target!);
    console.log(removed ? "✅ 已撤销 " + (email ?? target) : "❌ 名单里没有这个 authId");
    process.exit(removed ? 0 : 1);
  }

  // 授予
  if (authId) {
    const res = await platformService.grantAdminByAuthId(authId, { email: email ?? undefined, note, createdBy: process.env.USER });
    console.log("✅ 已授予 authId=" + res.admin.authId.slice(0, 8) + "…  note=" + (res.admin.note ?? "-"));
    process.exit(0);
  }
  const res = await platformService.grantAdminByEmail(email!, { note, createdBy: process.env.USER });
  if (!res.ok) { console.error("❌ " + res.error); process.exit(1); }
  console.log("✅ 已授予 " + res.admin.email + "（authId=" + res.admin.authId.slice(0, 8) + "…）");
  console.log("   他登录后访问 /platform 即可。撤销：--revoke --email " + res.admin.email);
}

main().catch((e) => {
  console.error("❌ " + String((e as Error)?.message ?? e));
  process.exit(1);
});
