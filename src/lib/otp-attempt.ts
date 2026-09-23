// OtpAttempt 的收尾标注（纯 DB 访问，独立成模块以便单测）。
//
// 为什么单独一个文件：这段逻辑曾经写错，而且错得很隐蔽——
//
//   await db.otpAttempt.updateMany({
//     where: { phoneE164: e164, verifiedAt: null },   // ← 少了状态过滤
//     data: { verifiedAt: new Date() },
//   });
//
// 于是一个客户验证成功时，**该号码下所有还没标注的行都被盖上"已验证"**，
// 包括那条因为网关设备离线而**根本没发出去**的 FAILED 记录。线上实测抓到了：
// 00:33:59 的 FAILED 行带着 verified: True。
//
// 危害不在功能（verifiedAt 不参与鉴权与限流），而在**审计真相**：这条线整轮的排障
// 都建立在"审计行说的是真的"之上——一行假标注会让下一次事故的归因彻底跑偏。
// 所以规则要写死：只有**确实投递出去的那一行**才配被标注为已验证。
//
// 拒绝类（BLOCKED/THROTTLED/REJECTED）与发送失败（FAILED）都不属于"用户收到的验证码"。
// 另外只标注**最近的那一行**：连发两次验证码时，用户用的是哪一个我们无从得知，
// 把两行都标成已验证更是错的。

import { db } from "@/lib/db";

/** 可以承载 verifiedAt 的状态：我们受理了（REQUESTED）或已交给网关（SENT）。 */
const VERIFIABLE = ["REQUESTED", "SENT"];

/**
 * 把"这个号码最近一次确实投递出去的验证码"标注为已验证。
 * 返回被标注的行 id；没有可标注的行（例如只剩拒绝/失败记录）时返回 null。
 */
export async function markOtpVerified(phoneE164: string): Promise<string | null> {
  const target = await db.otpAttempt.findFirst({
    where: { phoneE164, verifiedAt: null, status: { in: VERIFIABLE } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!target) return null;
  await db.otpAttempt.update({ where: { id: target.id }, data: { verifiedAt: new Date() } });
  return target.id;
}
