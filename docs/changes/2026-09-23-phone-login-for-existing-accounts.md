---
date: 2026-09-23
title: 手机验证码登录对所有已有客户开放（把号码挂到既有账号，而不是拒绝）
branch: fix/phone-login-existing-accounts
---

## 背景：我原来的保守策略把真人挡在门外

Supabase 的手机验证码默认会给新号码建一个独立身份。因此当客户已经有邮箱账号时
（Customer.authId 指向一个 email 用户），如果他改用手机号登录，Supabase 会造出第二个 auth 用户——
同一个人两个账号，而 Customer.authId 只能指向其中一个。

我当初的应对是"已有邮箱账号就拒绝短信登录"。线上实测这个决定是错的：

    有手机号的客户共 4 个，其中 3 个被这条策略挡在门外：
      ❌ Ahmad Danial        012-345 6789    (auth email: ahmad.danial@dz.my)
      ❌ JYTest              +601127322148   (auth email: jytest@gmail.com)
      ❌ Muhammad binti Zain 018-492 8009    (auth email: muhammad.zain@dz.my)
      ✅ DashOilTest         60102032797     (手机账号，本来就能登)

用户的原话：「我要目前全部手机号都可以 sms login，未必要选择 email or password」。

## 改动：发码前把号码挂到他已有的账号上

新增 src/lib/auth/phone-login.ts 的 planPhoneLogin()（纯函数、有单测）回答「该怎么挂」：

- 客户已绑定账号：
  - 号码没人占 / 就挂在他自己账号上 → attach
  - 号码被「孤儿」账号占着（早期流程留下的、没有任何客户指向它）→ 删掉孤儿再 attach
    （不删的话号码唯一性会挡住挂载）
  - 号码已被另一个客户的账号绑定 → conflict：绝不动别人的账号，报错让人工处理
- 客户尚未绑定账号（authId 为空）→ create（走原来的「建号 + 验码后认领档案」）

preparePhoneIdentity() 负责执行：admin.updateUserById(authId, { phone, phone_confirm: true })
——不会发短信（admin 直接确认），随后 signInWithOtp / verifyOtp 命中的就是他本人。

顺带三处收紧：

1. 新增 customersByPhone()：Customer.phone 没有唯一约束，同一号码命中多个档案时显式拒绝
   （「请先在后台合并」），而不是静默挑第一个——否则就是「登进谁」的随机性。
2. preparePhoneIdentity 失败时先写一条 REJECTED 审计行再返回（沿用上次的教训：
   不留痕的失败，线上只剩第三方的笼统文案）。
3. 限流放在挂载之前：preparePhoneIdentity 会改 Supabase 身份，不该被滥用触发。

## 影响

- 三个真实客户现在都能用手机验证码登录；他们原来的邮箱 + 密码登录照旧可用
  （是同一个 auth 用户，不是新身份）。
- 第一次请求时若号码还被孤儿账号占着，会自动清理掉那个孤儿（早期测试留下的）。
- verify 阶段原本的「号码属于另一个登录身份」错误保留为兜底，但文案改成可行动的
  "Please request a new code and try again."——因为正常路径下走不到这里，走到只说明验证码是旧代码下请求的。

## 交接说明

验证：pnpm exec vitest run 595 测试全绿（新增 7 条 planPhoneLogin / sameMsisdn 断言，正反两个方向都钉住：
判太严会挡真客户、判太松等于账号接管——特别是「别人的账号绝对不能删也不能改」这条）；
tsc / eslint 干净。

放行前实测的实事：生产库里没有重复手机号，所以自动绑定不会选错人。
