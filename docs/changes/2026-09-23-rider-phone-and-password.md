---
date: 2026-09-23
title: 骑手自助更换手机号（验证码核验）+ 柜台重置骑手密码
branch: feat/rider-phone-and-password
---

## 背景

手机号+密码上线后剩下两个缺口，都是"骑手自己解决不了"的：

1. **换号只能找柜台**：手机号是登录标识，但个人资料页当时有一个**可直接编辑的手机号输入框**
   （rider-profile.ts 里直接写 phone）——既能随手改错，也等于"谁拿到会话谁就能把账号挪走"。
2. **忘了密码且没有邮箱的骑手无路可走**：changeRiderPassword 要求先验当前密码，而它是按**邮箱**验的，
   于是没有邮箱的骑手连自己的密码都改不了。柜台是唯一兜底，但柜台当时没有任何重置入口。

## 改动

### 一、骑手更换/绑定手机号（Settings → 手机号码）

两步流程，验证的是**新号码**（这才叫证明"新号码归他"）：

- requestRiderPhoneChange：校验格式/号段 → 新号码不能属于别的客户 → 限流 → 写 OtpAttempt(purpose=CHANGE)
  → 发码；
- verifyRiderPhoneChange：验码 → 走 **preparePhoneIdentity** 把号码挂到**他本人的**账号上
  （孤儿临时账号会被清掉，别人的账号绝不触碰）→ 更新 Customer.phone + phoneVerified → 标注 verifiedAt。

三个关键点：

- **发码/验码必须用非持久化 client**：Supabase 会给新号码建一个临时账号，若用 cookie client，
  骑手验证完登录态就被换成那个临时账号（等于被顶掉）。所以新加了 ephemeralAuth()
  （persistSession:false，不动浏览器 session）。
- **挂载逻辑只有一份实现**：为让两个 action 共用，把 customersByPhone / preparePhoneIdentity /
  createAdminClient 抽到 lib/auth/phone-identity.ts，把限流抽到 lib/otp-rate.ts。
  不能把"use server"文件里的函数导出——**那会让它变成客户端可调用的 server action**
  （等于给全世界一个"把任意号码挂到任意账号"的接口）。
- **堵住绕过口**：updateRiderProfile 不再接受改号（传了不一致的号码就明确报错并指路），
  个人资料页的手机号改为只读。

### 二、柜台重置骑手密码（客户详情页）

- 新动作 resetRiderPassword（src/actions/workshop.ts，与 resetStaffPassword 并列）；
- 新密码由 lib/auth/temp-password.ts 生成：**剔除 0/O、1/l/I 等口述/手抄易混字符**，
  保证含大小写与数字（纯随机会有概率不合密码策略），用 node:crypto 而非 Math.random；
- 只回显一次（服务端返回给柜台，页面醒目标注"现在就告诉骑手"），**绝不写进审计**——
  审计里只记"谁重置的、是否自动生成"。

三道自己把的门（Server Action 不受路由级中间件覆盖）：

1. 权限走**矩阵**（CUSTOMERS 模块 edit），不是手写角色清单；
2. 目标必须是**客户**，且其 authId **不能是员工账号**——否则这条"骑手重置"的路就成了
   绕过员工管理权限、直接拿员工账号的后门；
3. 密码长度下限 8，生成器有守卫。

## 验证

- 新增 11 条断言：
  · tests/temp-password.test.ts（5 条：长度、无易混字符、三类字符、随机性、下限守卫）；
  · tests/rider-phone-password-guards.test.ts（6 条**源码级护栏**，专钉"某个动作没有做某件事"这类
    集成测试难覆盖的风险：个人资料不得再写 phone、两个 action 不得用 cookie client、
    验码后必须走 preparePhoneIdentity、重置必须查员工账号、审计里不得出现密码）。
- 全量：47 文件 / **611 测试全绿**；tsc / eslint 干净。
- 顺带记录一处修正：护栏测试第一版把 return 里的密码回显也算进"审计里不能有密码"，误报了一次——
  断言范围收窄到 audit 调用本身（这类误报不修就会让人开始怀疑护栏本身）。

## 交接说明

未做（明确留给后续）：改号后给**旧号码**发一条通知短信（安全上的加分项，但要新增一种短信文案与一次发送）；
骑手侧自助设置密码（目前无邮箱骑手只能靠柜台重置）。
