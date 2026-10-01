import "server-only";
import { randomToken } from "./random-token";

/** 生成 16 字符 URL-safe 随机 token（QR-001..003 扫码用，不可枚举）。
 *  实现是纯函数 `randomToken`（那个模块不带 server-only，脚本可用）；
 *  这里保留 server-only 标记：QR token 属于服务端签发的东西，不该被客户端代码引用。 */
export function generateQrToken(): string {
  return randomToken();
}
