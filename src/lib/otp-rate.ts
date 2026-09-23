import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { evaluateOtpRate, snapshotOtpUse } from "@/lib/otp";

// 验证码的**请求侧限流**（读数据库 + 交给纯函数判定）。
// 独立成模块的原因与 phone-identity 相同：两个 action（登录/注册、更换手机号）都要用，
// 而 "use server" 文件里不能导出这种东西。

/** 来源 IP 的哈希（加盐）。审计表里存哈希不存原文：那张表已经有手机号，
 *  再落一份原始 IP 就能直接拼出可画像的数据集，而限流只需要"是不是同一个人"。 */
export async function clientIpHash(): Promise<string | null> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "";
  if (!ip) return null;
  const crypto = (await import("node:crypto")).default;
  return crypto.createHash("sha256").update((process.env.AUTH_SECRET ?? "") + "|" + ip).digest("hex").slice(0, 32);
}

/** 读最近窗口内的事件时间戳 → 纯函数判定（判定逻辑在 lib/otp，可单测）。 */
export async function otpRateCheck(phoneE164: string, ipHash: string | null) {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const hourAgo = new Date(now.getTime() - 3600 * 1000);
  const [phoneRows, ipRows] = await Promise.all([
    db.otpAttempt.findMany({ where: { phoneE164, createdAt: { gte: dayAgo } }, select: { createdAt: true } }),
    ipHash
      ? db.otpAttempt.findMany({ where: { ipHash, createdAt: { gte: hourAgo } }, select: { createdAt: true } })
      : Promise.resolve([] as { createdAt: Date }[]),
  ]);
  return evaluateOtpRate(snapshotOtpUse(phoneRows.map((r) => r.createdAt), ipRows.map((r) => r.createdAt), now));
}
