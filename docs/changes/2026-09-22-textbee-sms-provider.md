---
date: 2026-09-22
title: 用自己的安卓手机 + SIM 卡发短信（TextBee provider）
branch: feat/textbee-sms-provider
---

## 背景

短信通道一直卡在钱与资质上：Twilio 要按条付费、马来西亚还要号码或 Sender ID 报备；Meta 的
WhatsApp Business API 要走企业验证。而 D&Z 手上有一台手机和一张 SIM 卡。

textbee.dev（开源、可自建）把安卓手机变成短信网关：它提供 REST API，实际发送由手机上的 App
用本机 SIM 完成。官方免费档：**50 条/天、300 条/月、1 台设备、含 webhook 通知**，没有平台费；
短信费就是套餐内的本地短信。因为是从马来西亚本地号码发出，收件人看到的还是门店自己的号码。

## 改动

新增 src/providers/sms/textbee.ts，并在 providers/index.ts 里把选型顺序改为
**TextBee → Twilio → mock**（先免平台费的，再按条计费的，最后本地 mock）。

这与 Twilio 实现遵守同一套规矩：

- 缺 API key 一律 FAILED，**绝不回落 mock**——"显示已发送但没人收到"是本项目最忌讳的静默失败；
- 超时 3.5 秒（Supabase hook 只给 5 秒，必须在它放弃之前给出结果）；
- 失败原因只保留上游技术信息并截断，**绝不回显请求体**（那里面有验证码）。

端点与载荷依官方文档：POST https://api.textbee.dev/api/v1/gateway/send-sms，
头 x-api-key，体 { recipients: [E.164], message, deviceId? }。

## 影响

- 新增 env：TEXTBEE_API_KEY（必填才会选中）、TEXTBEE_DEVICE_ID（可选）。
- **不需要改 Supabase、不需要改 hook、不需要改限流与审计**——这正是 provider 抽象的意义：
  hook 端点、Standard Webhooks 验签、OtpAttempt 审计、三段限流、号码归一化全部与通道无关。
- 语义提醒：网关返回成功只代表"已交给网关"，真实送达由那台手机完成。审计行的 SENT 因此是
  "网关已接受"；要拿真实送达回执需要接 textbee 的 webhook（后续可做，我们已有 webhook 验签的先例）。
- 可靠性取舍（必须知道）：手机关机/断网就发不出。免费档还有 50/天、300/月 的上限。
  因此它适合当前的注册量，不适合当量级增长的唯一通道；量大了再接专业网关（换 provider 仍是改一个文件）。

## 交接说明

验证：pnpm exec vitest run 588 测试全绿（新增 6 条 provider 出口契约断言：缺 key 即失败、
端点/头部/请求体正确、deviceId 可选、HTTP 错误带出上游原因、网络异常不抛、**错误信息里不含验证码**）；
tsc / eslint 干净。

上线步骤（用户侧）：
1. 准备一台常插电、连 WiFi 的安卓手机 + 门店的 SIM 卡；
2. textbee.dev 注册 → 装它的安卓 App → 注册设备（官方称约 3 分钟）→ 拿 API key 与 device id；
3. Vercel 加 TEXTBEE_API_KEY（+ 可选 TEXTBEE_DEVICE_ID）→ Redeploy；
4. Supabase 保持 Send SMS hook 开启、Phone provider 开启 → 发一次验证码，审计行应出现 SENT + externalId。
