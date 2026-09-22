---
date: 2026-09-22
title: hook payload 的号码缺 "+" 导致每次回调 400（真根因）
branch: fix/otp-hook-phone
---

## 改动

上一轮（PR #35）给"payload 校验失败"加了审计留痕，这一次真实回调立刻把真根因写了出来：

    status: REJECTED
    error : invalid phone; top=metadata|sms|user sms=otp|phone otp=string(6)
            sms.phone=string user=...|phone|... user.phone=string

关键在**号码本身**（该行 phoneE164 列）：**60111111111 —— 没有 "+"**。

即 GoTrue 传给 hook 的号码是**不带国际前缀符号**的形态（sms.phone 与 user.phone 都是），
而号段白名单 isAllowedPhone() 与 Twilio 都要求带 "+" 的 E.164。于是每次回调都在
"非法号码"这一关返回 400，Supabase 那边只显示一句 "Invalid payload sent to hook"。

改动：
1. src/lib/otp.ts 新增 toE164FromHook()：补 "+" 前缀 + 位数校验（7–15 位），不做任何"猜国家"的处理。
2. hook 路由先归一化再进白名单；落库/日志用归一化后的值。
3. 形状诊断补上"有没有 +"这一位（sms.phone=string+ / no+），下次同类问题一眼可见。
4. 上一轮我猜的"user.phone 缺失"被这次诊断**证伪**：两处都有值且都是字符串。

## 影响

- 这是线上 OTP 一直 400 的**真根因**，修掉后链路的第 3 段（Supabase → 我们的端点）才算真正打通。
- 仍然无法发出短信：Twilio 账号 Trial、余额 0.00 USD、名下 0 个号码。修好后下一次回调预期
  会走到 provider 并在审计行留下 twilio credentials are not configured —— 那正是"链路已通、只差账号"的证据。
- 形状诊断这一轮证明了自己的价值：一次就把"缺 +"暴露出来，而不用再去读一遍源码猜字段。

## 交接说明

验证：pnpm exec vitest run 582 测试全绿（新增 4 条：无 + 号补前缀、位数校验、归一化后过白名单、
以及 hook 路由对无 + 号码必须返回 200 且落库为 E.164）；tsc / eslint 干净。

排查链回顾（可复用）：第三方一句笼统文案 → 反查它对应的代码分支 → 推出"400 只可能来自验签之后的校验"
→ 把"拒绝必须留痕"当成产品能力做进去 → 一次真实回调拿到字段级真相。
