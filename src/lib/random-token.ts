import { randomBytes } from "node:crypto";

/**
 * 生成 16 字符 URL-safe 随机 token（不可枚举）。
 *
 * 为什么单独成模块、且**不带 `server-only`**：这是一行纯函数，而"开一家店"必须能由 CLI 跑
 * （管理台之前的唯一入口是运维在终端执行）。带 `server-only` 的模块在纯 Node 里直接抛错，
 * 于是脚本 import 不了 —— 与其在脚本里**重写一遍同样的格式**（两边迟早漂移），
 * 不如把它提出来：`lib/qr-token.ts` 保留 `server-only` 标记并复用它，脚本侧用这个纯函数。
 *
 * 注意这不是"放松守卫"：QR token 的安全性来自**服务端签发 + 库里比对**，
 * 任何人在客户端生成一个随机串都不会获得任何权限（它只是"看起来像 token"）。
 */
export function randomToken(bytes = 12, length = 16): string {
  return randomBytes(bytes).toString("base64url").slice(0, length);
}
