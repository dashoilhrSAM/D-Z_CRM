/**
 * "这个数据库连接串指向本地吗？" —— 纯函数，CLI 与测试共用。
 *
 * 为什么需要它：本仓的 `.env` 里就放着**生产** Supabase 的连接串，所以在本地终端
 * 跑开通脚本时 `NODE_ENV` 是 development、但 `--yes` 会直接写生产。
 * 只看 NODE_ENV 的护栏拦不住这种手滑，判据必须是**目标主机**。
 */
export function isLocalDatabaseTarget(url: string | undefined | null): boolean {
  const s = (url ?? "").trim();
  if (s === "") return true; // 没配就是本地 SQLite（Prisma 默认 file:./dev.db）
  if (s.startsWith("file:")) return true;
  try {
    const host = new URL(s).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
  } catch {
    return false; // 连不上/看不懂的一律当远端（失败方向是"拒绝执行"）
  }
}
