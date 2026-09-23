---
date: 2026-09-23
title: 修掉 verifiedAt 的假标注（验证成功会把同号码的失败投递也标成"已验证"）
branch: fix/verified-at-false-stamp
---

## 怎么发现的

手机验证码全链路验收通过后我去复核生产审计行，三条 SENT 都正常，但有一条对不上：

    2026-09-23T00:33:59 | FAILED | provider: textbee | verified: True
    error: No enabled device found. Enable a device or pass a deviceId.

那条**根本没发出去**（网关里没有启用的设备），却带着 verifiedAt。

## 根因

src/actions/auth-supabase.ts 里验证成功后的标注：

    await db.otpAttempt.updateMany({
      where: { phoneE164: e164, verifiedAt: null },   // ← 少了状态过滤
      data: { verifiedAt: new Date() },
    });

updateMany 加上「只要号码相同、还没标注过」这个条件，效果是：用户验证成功的那一刻，
**该号码下所有尚未标注的行都被盖上"已验证"**——不管那行是 SENT、FAILED 还是被我们拒绝的。

危害不在功能（verifiedAt 不参与鉴权，也不参与限流计数），而在**审计真相**：这条链路的每一轮
排障都建立在「审计行说的是真的」之上——一行假标注足以让下一次事故的归因彻底跑偏。

## 改动

新增 src/lib/otp-attempt.ts 的 markOtpVerified()，把规则写死并用测试钉住：

- 只有**确实投递出去的那一行**才配被标注：状态必须是 SENT 或 REQUESTED；
- FAILED（没发出去）与 BLOCKED / THROTTLED / REJECTED（被我们自己拒绝）**一律不标**；
- 只标注**最近的那一行**：连发两次验证码时用户用的是哪一个无从得知，把两行都标成已验证更是错的。

## 验证（含反向验证）

- tests/otp-attempt.test.ts 新增 5 条断言，覆盖上述三个规则的正反两面。
- **反向验证做了两次**，确认这些断言真的会失败（不是摆设）：
  - 只去掉状态过滤（保留"只标最近一行"）→ 2 条变红；
  - 完整退回原来的 updateMany 写法 → **5 条全红**。
- 生产数据修正：把 status 属于 FAILED/BLOCKED/THROTTLED/REJECTED 却带着 verifiedAt 的行清空，
  实测修正 1 行（就是上面那条 00:33:59 的 FAILED）。
- 全量：pnpm exec vitest run 600 测试全绿；tsc / eslint 干净。

## 交接说明

顺带记录本轮验收的正面证据（都在生产审计行里）：+601127322148 的 LOGIN 请求 SENT + verified，
而它是之前被「号码属于另一个登录身份」拒绝过的客户；其 auth 账号同时保有手机号与邮箱，
说明是**同一个账号**而不是第二个身份；孤儿账号 0 个、重复身份 0 个。
