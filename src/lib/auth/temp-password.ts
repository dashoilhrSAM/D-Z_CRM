import "server-only";
import { randomInt } from "node:crypto";

// 柜台重置骑手密码时用的**一次性密码**生成器。
//
// 为什么不能随便生成一串：这个密码的交付方式是"柜台同事念给骑手听 / 写在服务单据上"，
// 所以必须避开**视觉与听觉都容易混**的字符：
//   · 0 与 O、1 与 l 与 I  —— 手抄/口述时的经典错误，写错一个字符骑手就登不进去；
//   · 大小写同形或近形的组合也一并排除（去掉 i/l/o 后小写集里不再有混淆对）。
// 生成用 node:crypto 的 randomInt（不是 Math.random——密码不能被预测）。

const LOWER = "abcdefghjkmnpqrstuvwxyz"; // 去掉 i l o
const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ"; // 去掉 I L O
const DIGITS = "23456789"; // 去掉 0 1
const ALL = LOWER + UPPER + DIGITS;

/** 易混字符集合（供测试与文案复用）。 */
export const AMBIGUOUS_CHARS = ["0", "O", "o", "1", "l", "I", "i", "L"];

/**
 * 生成一个临时密码：默认 10 位，**保证**至少含一个大写、一个小写、一个数字
 * （Supabase 的密码策略与人的直觉都要求这样，而纯随机有概率生成不合规的串）。
 */
export function generateTempPassword(length = 10): string {
  if (length < 6) throw new Error("temp password must be at least 6 characters");
  const pick = (set: string) => set[randomInt(0, set.length)];
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  while (chars.length < length) chars.push(pick(ALL));
  // Fisher–Yates：否则前三位永远是"大写+小写+数字"的固定顺序（一眼看穿且模式化）。
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
