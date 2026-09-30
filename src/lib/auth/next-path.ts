/**
 * 登录回跳路径（`?next=`）的白名单式校验 —— **防开放重定向**。
 *
 * 为什么必须校验：`?next=` 直接喂给 `router.push()` 就是一个开放重定向 ——
 * 攻击者可以构造 `/login?next=https://evil.example`（或用 `//evil.example`
 * 这种"协议相对 URL"）把用户带走，而且是在**刚刚输完密码**、警惕性最低的那一刻。
 * 这类入口在本项目已经有三个（`/qr/rider/[id]`、`/qr/motorcycle/[id]`、`/qr/workshop/[id]`），
 * 只要登录页开始消费 `next`，它们就同时变成可被利用的入口 —— 所以规则写在这里，只写一遍。
 *
 * 规则只有一条：**只接受站内绝对路径**（单个 `/` 开头，且不含协议、不含控制字符）。
 * 拿不准就回退到调用方给的默认落点 —— 失败方向是"回到首页"，不是"跳到别人的站点"。
 */
export function safeNextPath(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  const s = raw.trim();
  if (!s.startsWith("/")) return fallback; // 相对路径、绝对 URL 一律不认
  if (s.startsWith("//") || s.startsWith("/\\")) return fallback; // 协议相对 URL
  if (s.includes("://")) return fallback;
  if (/[\s\u0000-\u001f\u007f]/.test(s)) return fallback; // 空白/控制字符（浏览器会做奇怪归一化）
  return s;
}
