---
date: 2026-09-22
title: Send SMS hook 的 payload 形状修正 + 拒绝必须留痕
branch: fix/otp-hook-payload
---

## 改动

线上第一次真实回调（Supabase 生成验证码后调我们的端点）失败，Supabase 侧只显示：

    {"code":500,"error_code":"unexpected_failure","msg":"Invalid payload sent to hook"}

读 GoTrue 源码定位：这句话**只对应「hook 返回 HTTP 400」**（internal/hooks/hookshttp/hookshttp.go 里
的 http.StatusBadRequest 分支），而我们的 400 只出现在**验签通过之后**的 payload 校验里——
也就是说密钥是配对成功的，问题在我对字段形状的假设。

依 internal/hooks/v0hooks/v0hooks.go 确认真实结构：

    type SMS struct {
        OTP     string   // json: otp,omitempty
        SMSType string   // json: sms_type,omitempty
        Phone   string   // json: phone,omitempty
    }
    type SendSMSInput struct {
        Metadata *Metadata    // json: metadata
        User     *models.User // json: user,omitempty
        SMS      SMS          // json: sms,omitempty
    }

**两处都带号码**（sms.phone 是本次投递目标，user.phone 是 models.User 上的字段），第一版只读 user.phone。改动：

1. targetPhone()：优先 sms.phone，退回 user.phone，非字符串一律当作没有；otpOf() 只接受字符串
   （数字型说明结构又变了，宁可拒绝也不猜）。
2. **拒绝必须留痕**：新增 payloadShape()，把「哪些键存在、类型是什么、验证码有几位」写进 OtpAttempt
   （status=REJECTED）。**绝不含验证码本身**。此前这类拒绝发生在写审计之前，线上表现为
   「Supabase 说 payload 有问题、我们这边一片空白」，只能靠读源码猜。
3. findLatestAttempt 的 notIn 加入 REJECTED：拒绝记录不再被后续投递改写（与 BLOCKED/THROTTLED 同理）。

## 影响

- 只影响 /api/hooks/send-sms 的入参解析与拒绝记账；发送链路、限流、验签均未改。
- **真凶尚未被证实**：本次修的是最可能的形状问题（user.phone 缺失/非字符串）。下一次真实回调无论
  成功失败都会在 OtpAttempt 留下一行——如果连 REJECTED 行都没有，说明请求根本没到我们的代码
  （那就是 URL/平台层的问题，而不是校验层）。
- Twilio 侧的阻塞仍在（账号名下 0 个号码、余额 0.00 USD），所以下一次尝试预期会走到 provider 再失败，
  并在审计行里留下 twilio credentials are not configured —— 这本身就是当前最需要的诊断。

## 交接说明

验证：pnpm exec vitest run 578 测试全绿（含 20 条真签名打 hook 路由的断言，其中 4 条覆盖本次形状问题）；
tsc、eslint 干净。

排查方法（值得复用）：从第三方的一句笼统错误文案反查到它对应的代码分支，再由状态码映射关系推出
「400 只可能来自验签之后的校验」，把范围从「整条链路」缩到「payload 字段形状」。
遗留教训：**任何拒绝都要先落痕再返回**，否则错误现场只剩第三方的一句文案。
